// Package newapi 是 New API 管理端客户端（适配 v0.13.x）。
//
// 实测约束：
//  1. /api/user/login 的 body 不含 access_token，鉴权靠 Set-Cookie: session=...
//  2. 所有管理接口必须带 `New-Api-User: <uid>` 头
//  3. 分页从 p=1 开始，page_size 上限 100
//  4. 明细用 /api/log/，汇总用 /api/log/stat；/api/data/ 为小时×模型预聚合
package newapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"math/rand"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Cfg 连接配置（均来自页面录入，密码已解密）。
type Cfg struct{ URL, Username, Password string }

// Kind 错误分类。
type Kind string

// 错误分类常量。
const (
	KAuth   Kind = "auth"
	KRate   Kind = "rate"
	KServer Kind = "server"
	KAPI    Kind = "api"
	KNet    Kind = "net"
)

// Error New API 调用错误。
type Error struct {
	Kind Kind
	Msg  string
}

func (e *Error) Error() string { return e.Msg }

const (
	sessionTTL = 20 * time.Minute
	// PageSize New API 分页上限。
	PageSize  = 100
	firstPage = 1
)

type session struct {
	url, cookie string
	uid         int64
	expires     time.Time
	key         string
}

// Client 带会话缓存的客户端，可并发使用。
type Client struct {
	HTTP *http.Client
	mu   sync.Mutex
	s    *session
	sf   chan struct{}
}

// New 创建客户端。
func New() *Client {
	return &Client{HTTP: &http.Client{Timeout: 60 * time.Second}, sf: make(chan struct{}, 1)}
}

func cfgKey(c Cfg) string { return c.URL + "|" + c.Username + "|" + c.Password }

// Clear 清空会话（配置变更后调用）。
func (c *Client) Clear() { c.mu.Lock(); c.s = nil; c.mu.Unlock() }

var cookieRe = regexp.MustCompile(`session=([^;]+)`)

func (c *Client) login(ctx context.Context, cfg Cfg) (*session, error) {
	base := strings.TrimRight(cfg.URL, "/")
	body, _ := json.Marshal(map[string]string{"username": cfg.Username, "password": cfg.Password})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, base+"/api/user/login", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, &Error{KNet, fmt.Sprintf("无法连接 New API (%s): %v", base, err)}
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, &Error{KRate, "登录被限流 (429)，请 1~2 分钟后再试"}
	}
	var out struct {
		Success *bool           `json:"success"`
		Message string          `json:"message"`
		Data    json.RawMessage `json:"data"`
	}
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	_ = json.Unmarshal(raw, &out)
	if resp.StatusCode >= 300 || (out.Success != nil && !*out.Success) {
		m := out.Message
		if m == "" {
			m = "HTTP " + strconv.Itoa(resp.StatusCode)
		}
		return nil, &Error{KAuth, "登录失败: " + m}
	}
	var d struct {
		ID          int64  `json:"id"`
		Role        *int   `json:"role"`
		AccessToken string `json:"access_token"`
		Token       string `json:"token"`
		User        struct {
			ID int64 `json:"id"`
		} `json:"user"`
	}
	_ = json.Unmarshal(out.Data, &d)
	uid := d.ID
	if uid == 0 {
		uid = d.User.ID
	}
	if d.Role != nil && *d.Role < 10 {
		return nil, &Error{KAuth, "该账号不是 New API 管理员（role < 10），无法查询全站用量"}
	}
	cookie := ""
	for _, sc := range resp.Header.Values("Set-Cookie") {
		if m := cookieRe.FindStringSubmatch(sc); m != nil {
			cookie = "session=" + m[1]
			break
		}
	}
	tok := d.AccessToken
	if tok == "" {
		tok = d.Token
	}
	if cookie == "" && tok != "" {
		cookie = "Bearer " + tok
	}
	if cookie == "" {
		return nil, &Error{KAuth, "登录成功但未拿到 session cookie / access_token"}
	}
	if uid == 0 {
		return nil, &Error{KAuth, "登录成功但未拿到用户 id（New-Api-User 头必需）"}
	}
	return &session{url: base, cookie: cookie, uid: uid, expires: time.Now().Add(sessionTTL), key: cfgKey(cfg)}, nil
}

func (c *Client) get(ctx context.Context, cfg Cfg, force bool) (*session, error) {
	c.mu.Lock()
	if !force && c.s != nil && c.s.expires.After(time.Now()) && c.s.key == cfgKey(cfg) {
		s := c.s
		c.mu.Unlock()
		return s, nil
	}
	c.mu.Unlock()
	// 串行登录，避免并发触发限流
	select {
	case c.sf <- struct{}{}:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	defer func() { <-c.sf }()
	c.mu.Lock()
	if !force && c.s != nil && c.s.expires.After(time.Now()) && c.s.key == cfgKey(cfg) {
		s := c.s
		c.mu.Unlock()
		return s, nil
	}
	c.mu.Unlock()
	s, err := c.login(ctx, cfg)
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	c.s = s
	c.mu.Unlock()
	return s, nil
}

var authMsg = regexp.MustCompile(`(?i)未登录|access token|Unauthorized|无权`)
var rateMsg = regexp.MustCompile(`(?i)rate|限流|频繁`)

// Get 带鉴权、限流重试、会话过期自动重登的 GET，返回 data 字段原文。
func (c *Client) Get(ctx context.Context, cfg Cfg, path string, params map[string]string) (json.RawMessage, error) {
	qs := url.Values{}
	for k, v := range params {
		if v != "" {
			qs.Set(k, v)
		}
	}
	const maxRetry = 4
	relogged := false
	var last error
	for attempt := 0; attempt < maxRetry; attempt++ {
		s, err := c.get(ctx, cfg, false)
		if err != nil {
			var ne *Error
			if errors.As(err, &ne) && ne.Kind != KRate && ne.Kind != KNet {
				return nil, err
			}
			last = err
			sleepBackoff(ctx, attempt)
			continue
		}
		u := s.url + path
		if len(qs) > 0 {
			u += "?" + qs.Encode()
		}
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
		req.Header.Set("Accept", "application/json")
		req.Header.Set("New-Api-User", strconv.FormatInt(s.uid, 10))
		if strings.HasPrefix(s.cookie, "Bearer ") {
			req.Header.Set("Authorization", s.cookie)
		} else {
			req.Header.Set("Cookie", s.cookie)
		}
		resp, err := c.HTTP.Do(req)
		if err != nil {
			last = &Error{KNet, "请求失败: " + err.Error()}
			sleepBackoff(ctx, attempt)
			continue
		}
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
		resp.Body.Close()
		var body struct {
			Success *bool           `json:"success"`
			Message string          `json:"message"`
			Data    json.RawMessage `json:"data"`
		}
		_ = json.Unmarshal(raw, &body)
		authFail := resp.StatusCode == 401 || resp.StatusCode == 403 ||
			(body.Success != nil && !*body.Success && authMsg.MatchString(body.Message))
		if authFail {
			if relogged {
				return nil, &Error{KAuth, fmt.Sprintf("鉴权失败: %s", firstNonEmpty(body.Message, strconv.Itoa(resp.StatusCode)))}
			}
			relogged = true
			c.Clear()
			attempt--
			continue
		}
		if resp.StatusCode == 429 || rateMsg.MatchString(body.Message) {
			last = &Error{KRate, "请求被限流 (429)"}
			sleepBackoff(ctx, attempt)
			continue
		}
		if resp.StatusCode >= 500 {
			last = &Error{KServer, fmt.Sprintf("服务器错误 HTTP %d", resp.StatusCode)}
			sleepBackoff(ctx, attempt)
			continue
		}
		if resp.StatusCode >= 300 {
			return nil, &Error{KAPI, fmt.Sprintf("HTTP %d: %s", resp.StatusCode, body.Message)}
		}
		if body.Success != nil && !*body.Success {
			return nil, &Error{KAPI, firstNonEmpty(body.Message, "接口返回失败")}
		}
		return body.Data, nil
	}
	if last == nil {
		last = &Error{KNet, "请求失败"}
	}
	return nil, last
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

func sleepBackoff(ctx context.Context, attempt int) {
	d := time.Duration(math.Min(15000, 1000*math.Pow(2, float64(attempt)))+rand.Float64()*500) * time.Millisecond
	select {
	case <-time.After(d):
	case <-ctx.Done():
	}
}

// ---- 业务接口 ----

// User New API 用户。
type User struct {
	ID           int64  `json:"id"`
	Username     string `json:"username"`
	DisplayName  string `json:"display_name"`
	Group        string `json:"group"`
	Role         int    `json:"role"`
	Status       int    `json:"status"`
	Quota        int64  `json:"quota"`
	UsedQuota    int64  `json:"used_quota"`
	RequestCount int64  `json:"request_count"`
}

// TestConnection 强制重登并读取用户总数。
func (c *Client) TestConnection(ctx context.Context, cfg Cfg) (uid int64, total int, err error) {
	c.Clear()
	s, err := c.get(ctx, cfg, true)
	if err != nil {
		return 0, 0, err
	}
	raw, err := c.Get(ctx, cfg, "/api/user/", map[string]string{"p": "1", "page_size": "1"})
	if err != nil {
		return 0, 0, err
	}
	var d struct {
		Total int `json:"total"`
	}
	_ = json.Unmarshal(raw, &d)
	return s.uid, d.Total, nil
}

// Status 读取站点状态（货币设置），失败返回空 map。
func (c *Client) Status(ctx context.Context, cfg Cfg) map[string]any {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(cfg.URL, "/")+"/api/status", nil)
	cctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	resp, err := c.HTTP.Do(req.WithContext(cctx))
	if err != nil {
		return map[string]any{}
	}
	defer resp.Body.Close()
	var b struct {
		Data map[string]any `json:"data"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&b)
	if b.Data == nil {
		return map[string]any{}
	}
	return b.Data
}

// ListAllUsers 拉取全部用户（p 从 1 开始，按 id 去重）。
func (c *Client) ListAllUsers(ctx context.Context, cfg Cfg) ([]User, error) {
	seen := map[int64]bool{}
	var out []User
	for p := firstPage; p < firstPage+1000; p++ {
		raw, err := c.Get(ctx, cfg, "/api/user/", map[string]string{"p": strconv.Itoa(p), "page_size": strconv.Itoa(PageSize)})
		if err != nil {
			return nil, err
		}
		items, total, ps := decodePage[User](raw)
		if len(items) == 0 {
			break
		}
		added := 0
		for _, u := range items {
			if !seen[u.ID] {
				seen[u.ID] = true
				out = append(out, u)
				added++
			}
		}
		if added == 0 || (total > 0 && len(out) >= total) {
			break
		}
		if ps == 0 {
			ps = PageSize
		}
		if len(items) < ps {
			break
		}
	}
	return out, nil
}

// decodePage 兼容 {items,total,page_size} 与纯数组两种返回。
func decodePage[T any](raw json.RawMessage) (items []T, total, pageSize int) {
	var d struct {
		Items    []T `json:"items"`
		Total    int `json:"total"`
		PageSize int `json:"page_size"`
	}
	if json.Unmarshal(raw, &d) == nil && d.Items != nil {
		return d.Items, d.Total, d.PageSize
	}
	var arr []T
	if json.Unmarshal(raw, &arr) == nil {
		return arr, len(arr), 0
	}
	return nil, 0, 0
}

// LogStat 区间消费 quota（type=2）。
func (c *Client) LogStat(ctx context.Context, cfg Cfg, start, end int64, username string) (int64, error) {
	raw, err := c.Get(ctx, cfg, "/api/log/stat", map[string]string{
		"type": "2", "start_timestamp": i64(start), "end_timestamp": i64(end), "username": username,
	})
	if err != nil {
		return 0, err
	}
	var d struct {
		Quota float64 `json:"quota"`
	}
	_ = json.Unmarshal(raw, &d)
	return int64(d.Quota), nil
}

// QuotaRow /api/data/ 的一行（小时×模型）。
type QuotaRow struct {
	Username  string  `json:"username"`
	ModelName string  `json:"model_name"`
	Quota     float64 `json:"quota"`
	Count     float64 `json:"count"`
	TokenUsed float64 `json:"token_used"`
	CreatedAt int64   `json:"created_at"`
}

// QuotaData 小时级×模型预聚合数据。
func (c *Client) QuotaData(ctx context.Context, cfg Cfg, start, end int64, username string) ([]QuotaRow, error) {
	raw, err := c.Get(ctx, cfg, "/api/data/", map[string]string{
		"start_timestamp": i64(start), "end_timestamp": i64(end), "username": username,
	})
	if err != nil {
		return nil, err
	}
	var rows []QuotaRow
	_ = json.Unmarshal(raw, &rows)
	return rows, nil
}

// LogItem 调用明细。
type LogItem struct {
	ID               int64  `json:"id"`
	UserID           int64  `json:"user_id"`
	Username         string `json:"username"`
	CreatedAt        int64  `json:"created_at"`
	ModelName        string `json:"model_name"`
	TokenName        string `json:"token_name"`
	Group            string `json:"group"`
	PromptTokens     int64  `json:"prompt_tokens"`
	CompletionTokens int64  `json:"completion_tokens"`
	Quota            int64  `json:"quota"`
	UseTime          int64  `json:"use_time"`
	IsStream         bool   `json:"is_stream"`
	IP               string `json:"ip"`
	Channel          any    `json:"channel"`
	ChannelName      string `json:"channel_name"`
	RequestID        string `json:"request_id"`
}

// LogOpt 明细查询参数。
type LogOpt struct {
	Page, PageSize int
	Start, End     int64
	Username       string
	Model          string
}

// ListLogs 消费明细分页。
func (c *Client) ListLogs(ctx context.Context, cfg Cfg, o LogOpt) ([]LogItem, int, error) {
	ps := o.PageSize
	if ps <= 0 || ps > PageSize {
		ps = PageSize
	}
	if o.Page < firstPage {
		o.Page = firstPage
	}
	raw, err := c.Get(ctx, cfg, "/api/log/", map[string]string{
		"p": strconv.Itoa(o.Page), "page_size": strconv.Itoa(ps), "type": "2",
		"start_timestamp": i64(o.Start), "end_timestamp": i64(o.End),
		"username": o.Username, "model_name": o.Model,
	})
	if err != nil {
		return nil, 0, err
	}
	items, total, _ := decodePage[LogItem](raw)
	return items, total, nil
}

func i64(n int64) string { return strconv.FormatInt(n, 10) }

// MapPool 简易并发池。
func MapPool[T any](items []T, limit int, fn func(i int, x T)) {
	if limit < 1 {
		limit = 1
	}
	var wg sync.WaitGroup
	ch := make(chan int)
	for w := 0; w < limit && w < len(items); w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range ch {
				fn(i, items[i])
			}
		}()
	}
	for i := range items {
		ch <- i
	}
	close(ch)
	wg.Wait()
}
