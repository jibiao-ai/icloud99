package usage

import (
	"context"
	"fmt"
	"sync"
	"time"

	"icloud99/internal/newapi"
)

const (
	userConcurrency = 3
	cacheTTLRecent  = 5 * time.Minute
	cacheTTLHistory = time.Hour
	cacheMax        = 50
)

type cacheEntry struct {
	at   time.Time
	data Summary
}

// Service 周期汇总服务（带缓存与并发合并）。
type Service struct {
	API      *newapi.Client
	mu       sync.Mutex
	cache    map[string]cacheEntry
	inflight map[string]chan struct{}
	results  map[string]result
}

type result struct {
	s   Summary
	err error
}

// NewService 创建服务。
func NewService(api *newapi.Client) *Service {
	return &Service{API: api, cache: map[string]cacheEntry{}, inflight: map[string]chan struct{}{}, results: map[string]result{}}
}

// Invalidate 清空缓存（配置变更后）。
func (s *Service) Invalidate() {
	s.mu.Lock()
	s.cache = map[string]cacheEntry{}
	s.mu.Unlock()
	s.API.Clear()
}

// Currency 读取站点货币。
func (s *Service) Currency(ctx context.Context, cfg newapi.Cfg) Currency {
	return CurrencyFromStatus(s.API.Status(ctx, cfg))
}

func build(ctx context.Context, api *newapi.Client, cfg newapi.Cfg, p Period) (Summary, error) {
	t0 := time.Now()
	cur := CurrencyFromStatus(api.Status(ctx, cfg))
	users, err := api.ListAllUsers(ctx, cfg)
	if err != nil {
		return Summary{}, err
	}
	aggs := make([]*UserAgg, len(users))
	var cand []*UserAgg
	for i, u := range users {
		aggs[i] = NewUserAgg(u)
		// 只有历史上产生过请求的用户才可能在周期内有消费
		if u.RequestCount > 0 || u.UsedQuota > 0 {
			cand = append(cand, aggs[i])
		}
	}
	var emu sync.Mutex
	var errs []string
	addErr := func(m string) { emu.Lock(); errs = append(errs, m); emu.Unlock() }

	newapi.MapPool(cand, userConcurrency, func(_ int, a *UserAgg) {
		rows, err := api.QuotaData(ctx, cfg, p.StartTs, p.EndTs, a.Username)
		if err != nil {
			addErr(fmt.Sprintf("%s: %v", a.Username, err))
			return
		}
		a.AddRows(rows, p)
	})

	site := float64(-1)
	if q, err := api.LogStat(ctx, cfg, p.StartTs, p.EndTs, ""); err != nil {
		addErr("site stat: " + err.Error())
	} else {
		site = float64(q)
	}
	var sum float64
	for _, a := range aggs {
		sum += a.Quota
	}
	source := "quota_data"
	// quota_data 未开启或数据不全时，回退逐用户 /api/log/stat 校正金额
	if site >= 0 && !Reconciled(site, sum) {
		source = "log_stat_fallback"
		newapi.MapPool(cand, userConcurrency, func(_ int, a *UserAgg) {
			q, err := api.LogStat(ctx, cfg, p.StartTs, p.EndTs, a.Username)
			if err != nil {
				addErr(fmt.Sprintf("stat %s: %v", a.Username, err))
				return
			}
			a.Quota = float64(q)
		})
	}
	out := Assemble(p, cur, aggs, site)
	out.Meta = Meta{Source: source, Candidates: len(cand), Errors: append([]string{}, errs...),
		ElapsedMs: time.Since(t0).Milliseconds(), GeneratedAt: time.Now().UnixMilli()}
	return out, nil
}

// Get 返回周期汇总；包含今天的周期缓存 5 分钟，纯历史周期缓存 1 小时；同键并发请求合并。
func (s *Service) Get(ctx context.Context, cfg newapi.Cfg, p Period, refresh bool) (Summary, error) {
	key := fmt.Sprintf("%s|%d|%d", cfg.URL, p.StartTs, p.EndTs)
	ttl := cacheTTLHistory
	if p.EndTs >= time.Now().Unix()-86400 {
		ttl = cacheTTLRecent
	}
	for {
		s.mu.Lock()
		if e, ok := s.cache[key]; ok && !refresh && time.Since(e.at) < ttl {
			s.mu.Unlock()
			d := e.data
			d.Meta.Cached = true
			return d, nil
		}
		if ch, ok := s.inflight[key]; ok {
			s.mu.Unlock()
			select {
			case <-ch:
			case <-ctx.Done():
				return Summary{}, ctx.Err()
			}
			s.mu.Lock()
			r, ok := s.results[key]
			s.mu.Unlock()
			if ok {
				return r.s, r.err
			}
			refresh = false
			continue
		}
		ch := make(chan struct{})
		s.inflight[key] = ch
		s.mu.Unlock()

		// 后台任务不随单个请求取消，避免合并等待者被连带失败
		bctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Minute)
		data, err := build(bctx, s.API, cfg, p)
		cancel()

		s.mu.Lock()
		if err == nil {
			s.cache[key] = cacheEntry{at: time.Now(), data: data}
			if len(s.cache) > cacheMax {
				var oldK string
				var oldT time.Time
				for k, v := range s.cache {
					if oldK == "" || v.at.Before(oldT) {
						oldK, oldT = k, v.at
					}
				}
				delete(s.cache, oldK)
			}
		}
		s.results[key] = result{data, err}
		delete(s.inflight, key)
		close(ch)
		s.mu.Unlock()
		time.AfterFunc(5*time.Second, func() { s.mu.Lock(); delete(s.results, key); s.mu.Unlock() })
		return data, err
	}
}

// UserDetail 单用户周期详情。
type UserDetail struct {
	Username string        `json:"username"`
	Period   Period        `json:"period"`
	Currency Currency      `json:"currency"`
	Totals   DetailTotals  `json:"totals"`
	Daily    []DetailDaily `json:"daily"`
	Models   []DetailModel `json:"models"`
}

// DetailTotals 用户总览。
type DetailTotals struct {
	Quota  float64 `json:"quota"`
	Amount float64 `json:"amount"`
	Count  float64 `json:"count"`
	Tokens float64 `json:"tokens"`
}

// DetailDaily 用户每日。
type DetailDaily struct {
	Day    string  `json:"day"`
	Quota  float64 `json:"quota"`
	Count  float64 `json:"count"`
	Tokens float64 `json:"tokens"`
	Amount float64 `json:"amount"`
}

// DetailModel 用户模型分布。
type DetailModel struct {
	Model  string  `json:"model"`
	Quota  float64 `json:"quota"`
	Count  float64 `json:"count"`
	Tokens float64 `json:"tokens"`
	Amount float64 `json:"amount"`
}

// BuildDetail 把 /api/data/ 行装配成单用户详情（纯函数）。
func BuildDetail(username string, p Period, cur Currency, rows []newapi.QuotaRow) UserDetail {
	days := map[string]*DetailDaily{}
	order := p.ListDays()
	for _, d := range order {
		days[d] = &DetailDaily{Day: d}
	}
	models := map[string]*DetailModel{}
	var t DetailTotals
	for _, r := range rows {
		if r.Username != "" && r.Username != username {
			continue
		}
		t.Quota += r.Quota
		t.Count += r.Count
		t.Tokens += r.TokenUsed
		if d := days[TsToDay(r.CreatedAt)]; d != nil {
			d.Quota += r.Quota
			d.Count += r.Count
			d.Tokens += r.TokenUsed
		}
		name := r.ModelName
		if name == "" {
			name = "unknown"
		}
		m := models[name]
		if m == nil {
			m = &DetailModel{Model: name}
			models[name] = m
		}
		m.Quota += r.Quota
		m.Count += r.Count
		m.Tokens += r.TokenUsed
	}
	t.Amount = cur.Money(t.Quota)
	out := UserDetail{Username: username, Period: p, Currency: cur, Totals: t}
	for _, d := range order {
		x := *days[d]
		x.Amount = cur.Money(x.Quota)
		out.Daily = append(out.Daily, x)
	}
	for _, m := range models {
		x := *m
		x.Amount = cur.Money(x.Quota)
		out.Models = append(out.Models, x)
	}
	for i := 1; i < len(out.Models); i++ {
		for j := i; j > 0 && out.Models[j].Quota > out.Models[j-1].Quota; j-- {
			out.Models[j], out.Models[j-1] = out.Models[j-1], out.Models[j]
		}
	}
	return out
}

// FetchDetailRows 按时间倒序取最新 maxRows 行明细（导出用）。
func FetchDetailRows(ctx context.Context, api *newapi.Client, cfg newapi.Cfg, p Period, maxRows int) ([]newapi.LogItem, int, error) {
	first, total, err := api.ListLogs(ctx, cfg, newapi.LogOpt{Page: 1, Start: p.StartTs, End: p.EndTs})
	if err != nil {
		return nil, 0, err
	}
	want := total
	if want > maxRows {
		want = maxRows
	}
	pages := (want + newapi.PageSize - 1) / newapi.PageSize
	chunks := make([][]newapi.LogItem, pages)
	if pages > 0 {
		chunks[0] = first
	}
	var pg []int
	for i := 2; i <= pages; i++ {
		pg = append(pg, i)
	}
	var emu sync.Mutex
	var ferr error
	newapi.MapPool(pg, 2, func(_ int, page int) {
		items, _, err := api.ListLogs(ctx, cfg, newapi.LogOpt{Page: page, Start: p.StartTs, End: p.EndTs})
		emu.Lock()
		defer emu.Unlock()
		if err != nil {
			ferr = err
			return
		}
		chunks[page-1] = items
	})
	if ferr != nil {
		return nil, 0, ferr
	}
	seen := map[int64]bool{}
	var rows []newapi.LogItem
	for _, c := range chunks {
		for _, it := range c {
			if !seen[it.ID] {
				seen[it.ID] = true
				rows = append(rows, it)
			}
		}
	}
	if len(rows) > maxRows {
		rows = rows[:maxRows]
	}
	return rows, total, nil
}
