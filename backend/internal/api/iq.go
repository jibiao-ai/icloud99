package api

import (
	"context"
	"errors"
	"log"
	"net/http"
	"sync"
	"time"

	"icloud99/internal/audit"
	"icloud99/internal/auth"
	"icloud99/internal/bootstrap"
	"icloud99/internal/httpx"
	"icloud99/internal/iq"
	"icloud99/internal/store"
)

type iqRow struct {
	ID              int64     `json:"id"`
	Provider        string    `json:"provider"`
	Tier            string    `json:"tier"`
	Model           string    `json:"model"`
	TestType        string    `json:"testType"`
	Result          string    `json:"result"`
	Score           float64   `json:"score"`
	ReasoningTokens int       `json:"reasoningTokens"`
	InputTokens     int       `json:"inputTokens"`
	OutputTokens    int       `json:"outputTokens"`
	ResponseTimeMs  int       `json:"responseTimeMs"`
	ImageURL        string    `json:"imageUrl"`
	SVG             string    `json:"svgCode"`
	TestedAt        time.Time `json:"testedAt"`
}

func (s *Server) iqList(w http.ResponseWriter, r *http.Request, _ *auth.Principal) error {
	q := httpx.ParseListQuery(r, 12, 60)
	tier := r.URL.Query().Get("tier")
	where, args := ` WHERE 1=1`, []any{}
	if tier != "" {
		where += ` AND tier=?`
		args = append(args, tier)
	}
	var total int
	if err := s.DB.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM iq_tests`+where, args...).Scan(&total); err != nil {
		return err
	}
	pages := (total + q.PageSize - 1) / q.PageSize
	if pages < 1 {
		pages = 1
	}
	if q.Page > pages {
		q.Page = pages
	}
	rows, err := s.DB.QueryContext(r.Context(), `SELECT id,provider,tier,model,test_type,result,score,reasoning_tokens,input_tokens,output_tokens,response_time_ms,
		COALESCE(image_url,''),COALESCE(svg_code,''),tested_at FROM iq_tests`+where+` ORDER BY tested_at DESC,id DESC LIMIT ? OFFSET ?`,
		append(args, q.PageSize, q.Offset())...)
	if err != nil {
		return err
	}
	defer rows.Close()
	list := []iqRow{}
	for rows.Next() {
		var x iqRow
		if err := rows.Scan(&x.ID, &x.Provider, &x.Tier, &x.Model, &x.TestType, &x.Result, &x.Score, &x.ReasoningTokens, &x.InputTokens,
			&x.OutputTokens, &x.ResponseTimeMs, &x.ImageURL, &x.SVG, &x.TestedAt); err != nil {
			return err
		}
		list = append(list, x)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	httpx.OK(w, httpx.NewPageResult(list, total, q.Page, q.PageSize))
	return nil
}

func (s *Server) iqStats(w http.ResponseWriter, r *http.Request, _ *auth.Principal) error {
	rows, err := s.DB.QueryContext(r.Context(), `SELECT tier,result,COUNT(*) FROM iq_tests GROUP BY tier,result`)
	if err != nil {
		return err
	}
	defer rows.Close()
	out := map[string]map[string]int{}
	for _, t := range iq.Tiers {
		out[t] = map[string]int{"pass": 0, "works": 0, "degraded": 0, "total": 0}
	}
	for rows.Next() {
		var tier, res string
		var n int
		if err := rows.Scan(&tier, &res, &n); err != nil {
			return err
		}
		if out[tier] == nil {
			out[tier] = map[string]int{"pass": 0, "works": 0, "degraded": 0, "total": 0}
		}
		out[tier][res] += n
		out[tier]["total"] += n
	}
	httpx.OK(w, out)
	return rows.Err()
}

// iqWindow 读取自动检测窗口（页面可配置）。
func (s *Server) iqWindow(r *http.Request) (start, end int, model string, enabled bool) {
	ctx := r.Context()
	start = s.Store.SettingInt(ctx, "iq.start_hour", 2)
	end = s.Store.SettingInt(ctx, "iq.end_hour", 8)
	model = s.Store.Setting(ctx, "iq.model", "gpt-6-astra")
	enabled = s.Store.Setting(ctx, "iq.enabled", "1") == "1"
	return
}

func (s *Server) iqSchedule(w http.ResponseWriter, r *http.Request, _ *auth.Principal) error {
	start, end, model, enabled := s.iqWindow(r)
	next := map[string]any{}
	for _, t := range iq.Tiers {
		if n, ok := iq.NextRun(time.Now(), t, start, end, s.CST); ok && enabled {
			next[t] = n.UTC().Format(time.RFC3339)
		} else {
			next[t] = nil
		}
	}
	hours := []map[string]any{}
	for h := start; h < end; h++ {
		if t, ok := iq.TierAt(h, start, end); ok {
			hours = append(hours, map[string]any{"hour": h, "tier": t})
		}
	}
	httpx.OK(w, map[string]any{"model": model, "enabled": enabled, "startHour": start, "endHour": end, "hours": hours, "next": next, "tiers": bootstrap.Tiers})
	return nil
}

// iqJob 当前/最近一次检测任务状态（单实例内存态，结果以 iq_tests 与审计日志为准）。
type iqJob struct {
	mu       sync.Mutex
	running  bool
	tier     string
	started  time.Time
	finished time.Time
	result   string
	errMsg   string
	lastTier string
}

// RunIQ 执行一次检测并落库（手动与定时任务共用，不依赖 HTTP 请求）。
// 上游失败时同样落一条降智记录（含错误原因），并返回错误以便审计标记失败。
func (s *Server) RunIQ(ctx context.Context, tier string) (map[string]any, error) {
	model := s.Store.Setting(ctx, "iq.model", "gpt-6-astra")
	key, err := s.Store.GetChannelKey(ctx, "openai", tier)
	if err != nil {
		if errors.Is(err, store.ErrNotConfigured) {
			return nil, httpx.NotConfigured("未配置 openai/" + tier + " 分组的 API 密钥，请先在「管理设置 → API 密钥」中配置")
		}
		return nil, err
	}
	res := iq.Run(ctx, &http.Client{}, key.BaseURL, key.APIKey, model)
	// 入库使用独立上下文，避免上游超时后 ctx 已过期导致记录丢失
	wctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
	defer cancel()
	_, err = s.DB.ExecContext(wctx, `INSERT INTO iq_tests(provider,tier,model,test_type,result,score,raw_response,reasoning_tokens,input_tokens,output_tokens,response_time_ms,image_url,svg_code,tested_at)
		VALUES('openai',?,?,'pelican',?,?,?,?,?,?,?,'',?,UTC_TIMESTAMP())`,
		tier, model, res.Result, res.Score, res.RawResponse, res.ReasoningTokens, res.InputTokens, res.OutputTokens, res.ResponseTimeMs, res.SVG)
	if err != nil {
		return nil, err
	}
	out := map[string]any{"tier": tier, "model": model, "result": res.Result, "score": res.Score, "responseTimeMs": res.ResponseTimeMs, "hasSvg": res.HasSVG}
	if res.Err != nil {
		out["error"] = res.Err.Error()
		return out, res.Err
	}
	return out, nil
}

// startIQ 在后台启动一次检测（SVG 生成需 2~3 分钟，不能占用 HTTP 请求）。
// 已有任务运行时返回 false。完成后写审计日志，失败原因写入 detail。
func (s *Server) startIQ(tier, user, ip string) bool {
	j := &s.iqJob
	j.mu.Lock()
	if j.running {
		j.mu.Unlock()
		return false
	}
	j.running, j.tier, j.started, j.errMsg, j.result = true, tier, time.Now(), "", ""
	j.mu.Unlock()
	go func() {
		t0 := time.Now()
		ctx, cancel := context.WithTimeout(context.Background(), iq.ChatTimeout+30*time.Second)
		defer cancel()
		out, err := s.RunIQ(ctx, tier)
		if err != nil {
			log.Printf("[iq] %s 检测失败: %v", tier, err)
			if out == nil {
				out = map[string]any{}
			}
			out["error"] = err.Error()
		}
		action := "run"
		if user == "" {
			action = "auto_run"
		}
		s.Audit.Record(audit.Entry{Module: "iq", Action: action, Target: tier, Link: "/iq", Detail: out, IP: ip, Username: user, Err: err, Started: t0})
		j.mu.Lock()
		j.running, j.finished, j.lastTier = false, time.Now(), tier
		if err != nil {
			j.errMsg = err.Error()
		}
		if v, ok := out["result"].(string); ok {
			j.result = v
		}
		j.mu.Unlock()
	}()
	return true
}

func (s *Server) iqRun(w http.ResponseWriter, r *http.Request, p *auth.Principal) error {
	var in struct {
		Tier string `json:"tier"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	ok := false
	for _, t := range iq.Tiers {
		ok = ok || t == in.Tier
	}
	if !ok {
		return httpx.Invalid("分组无效", map[string]string{"tier": "请选择 lite / standard / ultra"})
	}
	if _, err := s.Store.GetChannelKey(r.Context(), "openai", in.Tier); err != nil {
		if errors.Is(err, store.ErrNotConfigured) {
			return httpx.NotConfigured("未配置 openai/" + in.Tier + " 分组的 API 密钥，请先在「管理设置 → API 密钥」中配置")
		}
		return err
	}
	user := ""
	if p != nil {
		user = p.Username
	}
	if !s.startIQ(in.Tier, user, clientIP(r)) {
		return httpx.Conflict("已有检测任务正在运行，请等待完成后再试")
	}
	httpx.OK(w, map[string]any{"started": true, "tier": in.Tier})
	return nil
}

func (s *Server) iqRunStatus(w http.ResponseWriter, _ *http.Request, _ *auth.Principal) error {
	j := &s.iqJob
	j.mu.Lock()
	defer j.mu.Unlock()
	out := map[string]any{"running": j.running, "tier": j.tier, "result": j.result, "error": j.errMsg}
	if j.running {
		out["elapsedSec"] = int(time.Since(j.started).Seconds())
	}
	if !j.finished.IsZero() {
		out["finishedAt"] = j.finished.UTC().Format(time.RFC3339)
	}
	httpx.OK(w, out)
	return nil
}
