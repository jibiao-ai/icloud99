package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	"cloudwatch/internal/auth"
	"cloudwatch/internal/bootstrap"
	"cloudwatch/internal/httpx"
	"cloudwatch/internal/iq"
	"cloudwatch/internal/store"
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

// RunIQ 执行一次检测并落库（手动与定时任务共用，不依赖 HTTP 请求）。
func (s *Server) RunIQ(ctx context.Context, tier string) (map[string]any, error) {
	model := s.Store.Setting(ctx, "iq.model", "gpt-6-astra")
	key, err := s.Store.GetChannelKey(ctx, "openai", tier)
	if err != nil {
		if errors.Is(err, store.ErrNotConfigured) {
			return nil, httpx.NotConfigured("未配置 openai/" + tier + " 分组的 API 密钥，请先在「管理设置 → API 密钥」中配置")
		}
		return nil, err
	}
	res := iq.Run(ctx, s.HTTP, key.BaseURL, key.APIKey, model)
	_, err = s.DB.ExecContext(ctx, `INSERT INTO iq_tests(provider,tier,model,test_type,result,score,raw_response,reasoning_tokens,input_tokens,output_tokens,response_time_ms,image_url,svg_code,tested_at)
		VALUES('openai',?,?,'pelican',?,?,?,?,?,?,?,'',?,UTC_TIMESTAMP())`,
		tier, model, res.Result, res.Score, res.RawResponse, res.ReasoningTokens, res.InputTokens, res.OutputTokens, res.ResponseTimeMs, res.SVG)
	if err != nil {
		return nil, err
	}
	return map[string]any{"result": res.Result, "score": res.Score, "responseTimeMs": res.ResponseTimeMs, "hasSvg": res.HasSVG, "rawResponse": res.RawResponse}, nil
}

func (s *Server) iqRun(w http.ResponseWriter, r *http.Request, p *auth.Principal) error {
	t0 := time.Now()
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
	out, err := s.RunIQ(r.Context(), in.Tier)
	s.rec(r, p, "iq", "run", in.Tier, "/iq", out, err, t0)
	if err != nil {
		return err
	}
	httpx.OK(w, out)
	return nil
}
