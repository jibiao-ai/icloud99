package api

import (
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"icloud99/internal/auth"
	"icloud99/internal/httpx"
	"icloud99/internal/newapi"
	"icloud99/internal/store"
	"icloud99/internal/usage"
)

// newapiCfg 读取已保存的 New API 管理员配置；未配置返回 40002，前端据此引导到设置页。
func (s *Server) newapiCfg(r *http.Request) (newapi.Cfg, error) {
	cfg, err := s.Store.NewAPICfg(r.Context())
	if errors.Is(err, store.ErrNotConfigured) {
		return cfg, httpx.NotConfigured("未配置 New API 管理员账号，请在「管理设置 → New API」中配置")
	}
	return cfg, err
}

// upstream 把 New API 错误映射为 502/429，并保留可读信息。
func upstream(err error) error {
	var ne *newapi.Error
	if errors.As(err, &ne) {
		switch ne.Kind {
		case newapi.KRate:
			return httpx.Err(http.StatusTooManyRequests, ne.Msg)
		case newapi.KAuth:
			return httpx.Err(http.StatusBadGateway, ne.Msg)
		}
		return httpx.Err(http.StatusBadGateway, ne.Msg)
	}
	return err
}

func (s *Server) period(r *http.Request) (usage.Period, error) {
	q := r.URL.Query()
	p, err := usage.ParsePeriod(q.Get("start"), q.Get("end"), q.Get("month"), time.Now())
	if err != nil {
		return p, httpx.Invalid(err.Error(), map[string]string{"start": err.Error()})
	}
	return p, nil
}

func (s *Server) usageSummary(w http.ResponseWriter, r *http.Request, _ *auth.Principal) error {
	cfg, err := s.newapiCfg(r)
	if err != nil {
		return err
	}
	p, err := s.period(r)
	if err != nil {
		return err
	}
	sum, err := s.Usage.Get(r.Context(), cfg, p, r.URL.Query().Get("refresh") == "1")
	if err != nil {
		return upstream(err)
	}
	httpx.OK(w, sum)
	return nil
}

func (s *Server) usageUser(w http.ResponseWriter, r *http.Request, _ *auth.Principal) error {
	cfg, err := s.newapiCfg(r)
	if err != nil {
		return err
	}
	p, err := s.period(r)
	if err != nil {
		return err
	}
	name := r.PathValue("username")
	rows, err := s.NewAPI.QuotaData(r.Context(), cfg, p.StartTs, p.EndTs, name)
	if err != nil {
		return upstream(err)
	}
	httpx.OK(w, usage.BuildDetail(name, p, s.Usage.Currency(r.Context(), cfg), rows))
	return nil
}

func (s *Server) usageUserLogs(w http.ResponseWriter, r *http.Request, _ *auth.Principal) error {
	cfg, err := s.newapiCfg(r)
	if err != nil {
		return err
	}
	p, err := s.period(r)
	if err != nil {
		return err
	}
	q := httpx.ParseListQuery(r, 50, 100)
	if q.PageSize < 10 {
		q.PageSize = 10
	}
	items, total, err := s.NewAPI.ListLogs(r.Context(), cfg, newapi.LogOpt{
		Page: q.Page, PageSize: q.PageSize, Start: p.StartTs, End: p.EndTs,
		Username: r.PathValue("username"), Model: r.URL.Query().Get("model")})
	if err != nil {
		return upstream(err)
	}
	cur := s.Usage.Currency(r.Context(), cfg)
	type row struct {
		ID               int64   `json:"id"`
		Time             string  `json:"time"`
		Model            string  `json:"model"`
		Group            string  `json:"group"`
		TokenName        string  `json:"tokenName"`
		PromptTokens     int64   `json:"promptTokens"`
		CompletionTokens int64   `json:"completionTokens"`
		Quota            int64   `json:"quota"`
		Amount           float64 `json:"amount"`
		UseTime          int64   `json:"useTime"`
		IsStream         bool    `json:"isStream"`
		IP               string  `json:"ip"`
		Channel          string  `json:"channel"`
	}
	list := make([]row, 0, len(items))
	for _, x := range items {
		ch := x.ChannelName
		if ch == "" {
			if v, ok := x.Channel.(float64); ok {
				ch = strconv.Itoa(int(v))
			}
		}
		list = append(list, row{x.ID, usage.TsToDateTime(x.CreatedAt), x.ModelName, x.Group, x.TokenName, x.PromptTokens, x.CompletionTokens,
			x.Quota, cur.Money(float64(x.Quota)), x.UseTime, x.IsStream, x.IP, ch})
	}
	res := httpx.NewPageResult(list, total, q.Page, q.PageSize)
	httpx.OK(w, map[string]any{"page": res, "currency": cur})
	return nil
}

// usageExport 导出 = 当前筛选结果（分组/关键字/零消费开关由前端传入）。
func (s *Server) usageExport(w http.ResponseWriter, r *http.Request, p *auth.Principal) error {
	t0 := time.Now()
	cfg, err := s.newapiCfg(r)
	if err != nil {
		return err
	}
	per, err := s.period(r)
	if err != nil {
		return err
	}
	q := r.URL.Query()
	maxRows, _ := strconv.Atoi(q.Get("maxRows"))
	if maxRows < 100 {
		maxRows = 10000
	}
	if maxRows > 50000 {
		maxRows = 50000
	}
	opt := usage.ExportOpts{
		IncludeZero: q.Get("includeZero") != "0", Details: q.Get("details") == "1", MaxRows: maxRows,
		Group: q.Get("group"), Keyword: q.Get("keyword"), SourceURL: cfg.URL,
	}
	link := "/usage?" + url.Values{"start": {per.Start}, "end": {per.End}}.Encode()
	fail := func(e error) error {
		s.rec(r, p, "usage", "export", per.Label, link, map[string]any{"group": opt.Group, "keyword": opt.Keyword, "details": opt.Details}, e, t0)
		return upstream(e)
	}
	sum, err := s.Usage.Get(r.Context(), cfg, per, false)
	if err != nil {
		return fail(err)
	}
	if opt.Details {
		rows, total, err := usage.FetchDetailRows(r.Context(), s.NewAPI, cfg, per, maxRows)
		if err != nil {
			return fail(err)
		}
		opt.Rows, opt.DetailTotal = rows, total
	}
	buf, err := usage.BuildWorkbook(sum, opt)
	if err != nil {
		return fail(err)
	}
	s.rec(r, p, "usage", "export", per.Label, link, map[string]any{"group": opt.Group, "keyword": opt.Keyword, "details": opt.Details, "includeZero": opt.IncludeZero}, nil, t0)
	name := "用户用量账单_" + per.Start + "_" + per.End + ".xlsx"
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", "attachment; filename=\"usage_"+per.Start+"_"+per.End+".xlsx\"; filename*=UTF-8''"+url.PathEscape(name))
	_, _ = w.Write(buf.Bytes())
	return nil
}
