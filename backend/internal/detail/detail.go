// Package detail 实现「使用明细导出」：按时间自适应分段拉取全站调用明细（避开 New API 单次查询上限），
// 落盘后生成与「Token账单_含明细」一致格式的 Excel（超过单文件行数自动拆分并打包）。
package detail

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"icloud99/internal/newapi"
	"icloud99/internal/usage"
)

// 引擎参数（可在测试中通过 Params 覆盖）。
const (
	// WindowCap 单个时间段最多行数；段内总数超过则按时间二分，直到不超过为止。
	WindowCap = 5000
	// Concurrency 同时拉取的时间段数。
	Concurrency = 3
	// MaxTotalRows 单次导出行数上限（保护磁盘与上游）。
	MaxTotalRows = 2_000_000
	// MaxUsers 指定用户数上限。
	MaxUsers   = 50
	segRetries = 2
	// DefaultRowsPerFile 单个 Excel 文件默认行数（与参考附件同量级）。
	DefaultRowsPerFile = 300_000
)

// Fetch 查询一页明细：返回当页数据与该查询条件下的总数。
type Fetch func(ctx context.Context, o newapi.LogOpt) ([]newapi.LogItem, int, error)

// Params 一次导出的参数。
type Params struct {
	Start, End     string // CST 日期，仅用于文件名与展示
	StartTs, EndTs int64
	Users          []string // 为空 = 全站所有用户
	MaxRowsPerFile int
	WindowCap      int
	Concurrency    int
	MaxTotalRows   int
	QuotaPerUnit   float64
}

func (p Params) cap() int {
	if p.WindowCap > 0 {
		return p.WindowCap
	}
	return WindowCap
}

func (p Params) conc() int {
	if p.Concurrency > 0 {
		return p.Concurrency
	}
	return Concurrency
}

func (p Params) maxTotal() int {
	if p.MaxTotalRows > 0 {
		return p.MaxTotalRows
	}
	return MaxTotalRows
}

// Progress 进度（并发安全）。
type Progress struct {
	mu       sync.Mutex
	segTotal int
	segDone  int
	splits   int
	rows     int64
	phase    string
	warns    []string
}

// Snapshot 读取进度快照。
func (g *Progress) Snapshot() (segTotal, segDone, splits int, rows int64, phase string, warns []string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.segTotal, g.segDone, g.splits, g.rows, g.phase, append([]string(nil), g.warns...)
}

func (g *Progress) set(f func()) { g.mu.Lock(); f(); g.mu.Unlock() }

func (g *Progress) warn(msg string) {
	g.set(func() {
		if len(g.warns) < 20 {
			g.warns = append(g.warns, msg)
		}
	})
}

type seg struct {
	user string
	s, e int64
	rows []newapi.LogItem
	done bool
}

type segResult struct {
	rows  []newapi.LogItem
	split bool
	err   error
}

// initialSegments 每个目标（指定用户或全站）按自然日（CST）切成初始时间段。
func initialSegments(p Params) []seg {
	targets := p.Users
	if len(targets) == 0 {
		targets = []string{""}
	}
	var out []seg
	for _, u := range targets {
		for ds := p.StartTs; ds <= p.EndTs; {
			de := dayEnd(ds)
			if de > p.EndTs {
				de = p.EndTs
			}
			out = append(out, seg{user: u, s: ds, e: de})
			ds = de + 1
		}
	}
	return out
}

// dayEnd 返回 ts 所在 CST 自然日的最后一秒。
func dayEnd(ts int64) int64 {
	t := time.Unix(ts, 0).In(usage.CST)
	next := time.Date(t.Year(), t.Month(), t.Day()+1, 0, 0, 0, 0, usage.CST)
	return next.Unix() - 1
}

// retryDelay 段内请求失败后的退避基数（测试中缩短）。
var retryDelay = 2 * time.Second

func retry(ctx context.Context, f func() error) error {
	var err error
	for i := 0; i <= segRetries; i++ {
		if err = f(); err == nil || ctx.Err() != nil {
			return err
		}
		select {
		case <-time.After(time.Duration(i+1) * retryDelay):
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return err
}

// fetchSeg 先探测第一页拿总数：超过 cap 且还能再切则返回 split；否则翻页拉全。
func fetchSeg(ctx context.Context, fetch Fetch, sg seg, cap int, prog *Progress) segResult {
	var first []newapi.LogItem
	var total int
	if err := retry(ctx, func() (e error) {
		first, total, e = fetch(ctx, newapi.LogOpt{Page: 1, PageSize: newapi.PageSize, Start: sg.s, End: sg.e, Username: sg.user})
		return e
	}); err != nil {
		return segResult{err: err}
	}
	if total > cap && sg.e > sg.s {
		return segResult{split: true}
	}
	seen := make(map[int64]bool, total)
	rows := make([]newapi.LogItem, 0, total)
	add := func(items []newapi.LogItem) {
		for _, it := range items {
			if it.ID != 0 && seen[it.ID] {
				continue
			}
			seen[it.ID] = true
			rows = append(rows, it)
		}
	}
	add(first)
	per := len(first)
	if per == 0 {
		per = 1
	}
	maxPage := total/per + 3
	for page := 2; len(rows) < total && page <= maxPage; page++ {
		var items []newapi.LogItem
		if err := retry(ctx, func() (e error) {
			items, _, e = fetch(ctx, newapi.LogOpt{Page: page, PageSize: newapi.PageSize, Start: sg.s, End: sg.e, Username: sg.user})
			return e
		}); err != nil {
			return segResult{err: err}
		}
		if len(items) == 0 {
			break
		}
		add(items)
	}
	if len(rows) != total {
		prog.warn(fmt.Sprintf("时间段 %s ~ %s%s 应有 %d 条，实际取到 %d 条（拉取期间数据有变动）",
			usage.TsToDateTime(sg.s), usage.TsToDateTime(sg.e), userSuffix(sg.user), total, len(rows)))
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].CreatedAt != rows[j].CreatedAt {
			return rows[i].CreatedAt < rows[j].CreatedAt
		}
		return rows[i].ID < rows[j].ID
	})
	return segResult{rows: rows}
}

func userSuffix(u string) string {
	if u == "" {
		return ""
	}
	return "（用户 " + u + "）"
}

// Collect 分段拉取并按时间升序依次交给 emit。段结果按队列顺序输出，保证整体有序。
func Collect(ctx context.Context, fetch Fetch, p Params, prog *Progress, emit func([]newapi.LogItem) error) error {
	queue := initialSegments(p)
	prog.set(func() { prog.segTotal, prog.phase = len(queue), "fetch" })
	var total int
	for len(queue) > 0 {
		for len(queue) > 0 && queue[0].done {
			if total += len(queue[0].rows); total > p.maxTotal() {
				return fmt.Errorf("明细超过单次导出上限 %d 行，请缩短周期或指定用户后分批导出", p.maxTotal())
			}
			if err := emit(queue[0].rows); err != nil {
				return err
			}
			n := int64(len(queue[0].rows))
			queue = queue[1:]
			prog.set(func() { prog.segDone++; prog.rows += n })
		}
		if len(queue) == 0 {
			break
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		var idx []int
		for i := range queue {
			if !queue[i].done {
				if idx = append(idx, i); len(idx) == p.conc() {
					break
				}
			}
		}
		res := make([]segResult, len(idx))
		var wg sync.WaitGroup
		for k, i := range idx {
			wg.Add(1)
			go func(k int, sg seg) {
				defer wg.Done()
				res[k] = fetchSeg(ctx, fetch, sg, p.cap(), prog)
			}(k, queue[i])
		}
		wg.Wait()
		byIdx := make(map[int]segResult, len(idx))
		for k, i := range idx {
			if res[k].err != nil {
				sg := queue[i]
				if errors.Is(res[k].err, context.Canceled) {
					return res[k].err
				}
				return fmt.Errorf("拉取 %s ~ %s%s 失败：%w", usage.TsToDateTime(sg.s), usage.TsToDateTime(sg.e), userSuffix(sg.user), res[k].err)
			}
			byIdx[i] = res[k]
		}
		nq := make([]seg, 0, len(queue)+len(idx))
		for i, sg := range queue {
			r, ok := byIdx[i]
			switch {
			case !ok:
				nq = append(nq, sg)
			case r.split:
				mid := sg.s + (sg.e-sg.s)/2
				nq = append(nq, seg{user: sg.user, s: sg.s, e: mid}, seg{user: sg.user, s: mid + 1, e: sg.e})
				prog.set(func() { prog.segTotal++; prog.splits++ })
			default:
				sg.rows, sg.done = r.rows, true
				nq = append(nq, sg)
			}
		}
		queue = nq
	}
	return nil
}

// Row 与参考附件一致的 21 列。
type Row struct {
	Time        string
	LogID       int64
	UserID      int64
	Username    string
	TokenName   string
	Group       string
	Model       string
	Prompt      int64
	Completion  int64
	Total       int64
	Quota       int64
	CostUSD     float64
	LogType     int
	Channel     int64
	ChannelName string
	RequestID   string
	UpstreamID  string
	UseTime     int64
	IsStream    int
	IP          string
	Content     string
}

// Headers 表头（与附件逐列一致）。
var Headers = []string{"time", "log_id", "user_id", "username", "token_name", "group", "model", "prompt_tokens", "completion_tokens",
	"total_tokens", "quota", "cost_usd", "log_type", "channel", "channel_name", "request_id", "upstream_request_id", "use_time", "is_stream", "ip", "content"}

// ToRow 把 New API 日志转换为导出行。
func ToRow(it newapi.LogItem, qpu float64) Row {
	if qpu <= 0 {
		qpu = 500000
	}
	var ch int64
	switch v := it.Channel.(type) {
	case float64:
		ch = int64(v)
	case json.Number:
		ch, _ = v.Int64()
	}
	stream := 0
	if it.IsStream {
		stream = 1
	}
	return Row{
		Time: usage.TsToDateTime(it.CreatedAt), LogID: it.ID, UserID: it.UserID, Username: it.Username, TokenName: it.TokenName,
		Group: it.Group, Model: it.ModelName, Prompt: it.PromptTokens, Completion: it.CompletionTokens,
		Total: it.PromptTokens + it.CompletionTokens, Quota: it.Quota, CostUSD: float64(it.Quota) / qpu, LogType: 2,
		Channel: ch, ChannelName: it.ChannelName, RequestID: it.RequestID, UpstreamID: upstreamID(it.Other),
		UseTime: it.UseTime, IsStream: stream, IP: it.IP, Content: it.Content,
	}
}

// upstreamID 从 other（JSON 对象或「内含 JSON 的字符串」）中提取上游请求 ID，没有则为空。
func upstreamID(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil {
		var s string
		if json.Unmarshal(raw, &s) != nil || !strings.HasPrefix(strings.TrimSpace(s), "{") || json.Unmarshal([]byte(s), &m) != nil {
			return ""
		}
	}
	for _, k := range []string{"upstream_request_id", "upstream_id"} {
		if v, ok := m[k].(string); ok && v != "" {
			return v
		}
	}
	return ""
}
