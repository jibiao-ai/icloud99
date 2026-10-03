package api

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"time"

	"cloudwatch/internal/auth"
	"cloudwatch/internal/bootstrap"
	"cloudwatch/internal/httpx"
	"cloudwatch/internal/monitor"
)

const (
	historyBars = 60
	testRounds  = 60
	testGap     = time.Minute
)

type testPoint struct {
	Time       time.Time `json:"time"`
	Response   int       `json:"responseTime"`
	Ping       int       `json:"ping"`
	Success    bool      `json:"success"`
	Speed      string    `json:"speed"`
	ChannelID  int64     `json:"-"`
	RawSuccess int       `json:"-"`
}

type channelOut struct {
	ID         int64       `json:"id"`
	Name       string      `json:"name"`
	Provider   string      `json:"provider"`
	Tier       string      `json:"tier"`
	ModelID    string      `json:"modelId"`
	Icon       string      `json:"icon"`
	Rate       float64     `json:"rateMultiplier"`
	Latest     *testPoint  `json:"latest"`
	Speed      string      `json:"speed"`
	SuccessPct int         `json:"successRate"`
	Total      int         `json:"totalTests"`
	History    []testPoint `json:"history"`
}

// channelList 渠道列表：每个渠道最近 60 次检测（按时间正序）。
func (s *Server) channelList(w http.ResponseWriter, r *http.Request, _ *auth.Principal) error {
	days, _ := strconv.Atoi(r.URL.Query().Get("range"))
	if days < 1 || days > 90 {
		days = 7
	}
	ctx := r.Context()
	rows, err := s.DB.QueryContext(ctx, `SELECT id,name,provider,tier,model_id,icon,rate_multiplier FROM channels WHERE is_active=1 ORDER BY provider,tier,sort_order,id`)
	if err != nil {
		return err
	}
	var chs []*channelOut
	idx := map[int64]*channelOut{}
	for rows.Next() {
		c := &channelOut{History: []testPoint{}}
		if err := rows.Scan(&c.ID, &c.Name, &c.Provider, &c.Tier, &c.ModelID, &c.Icon, &c.Rate); err != nil {
			rows.Close()
			return err
		}
		chs = append(chs, c)
		idx[c.ID] = c
	}
	rows.Close()

	// 一次查询取回所有渠道最近 60 条（窗口函数），避免 N+1
	hr, err := s.DB.QueryContext(ctx, `SELECT channel_id,response_time_ms,ping_ms,success,tested_at FROM (
		SELECT t.channel_id,t.response_time_ms,t.ping_ms,t.success,t.tested_at,
		       ROW_NUMBER() OVER (PARTITION BY t.channel_id ORDER BY t.tested_at DESC, t.id DESC) rn
		FROM channel_tests t JOIN channels c ON c.id=t.channel_id
		WHERE c.is_active=1 AND t.tested_at > UTC_TIMESTAMP() - INTERVAL ? DAY) x
		WHERE rn <= ? ORDER BY channel_id, tested_at DESC`, days, historyBars)
	if err != nil {
		return err
	}
	defer hr.Close()
	for hr.Next() {
		var cid int64
		var p testPoint
		var ok int
		if err := hr.Scan(&cid, &p.Response, &p.Ping, &ok, &p.Time); err != nil {
			return err
		}
		p.Success = ok == 1
		p.Speed = string(monitor.Grade(p.Response, p.Ping, p.Success))
		if c := idx[cid]; c != nil {
			c.History = append(c.History, p) // 倒序
		}
	}
	if err := hr.Err(); err != nil {
		return err
	}
	for _, c := range chs {
		c.Total = len(c.History)
		if c.Total > 0 {
			l := c.History[0]
			c.Latest = &l
			c.Speed = l.Speed
			okN := 0
			for _, h := range c.History {
				if h.Success {
					okN++
				}
			}
			c.SuccessPct = int(float64(okN)/float64(c.Total)*100 + 0.5)
		} else {
			c.Speed = string(monitor.SpeedUnknown)
		}
		for i, j := 0, len(c.History)-1; i < j; i, j = i+1, j-1 { // 转为时间正序
			c.History[i], c.History[j] = c.History[j], c.History[i]
		}
	}
	httpx.OK(w, chs)
	return nil
}

func (s *Server) rangeStats(r *http.Request, id int64, days int) (monitor.RangeStats, error) {
	var st monitor.RangeStats
	var ok sql.NullInt64
	err := s.DB.QueryRowContext(r.Context(), `SELECT COUNT(*), SUM(success) FROM channel_tests WHERE channel_id=? AND tested_at > UTC_TIMESTAMP() - INTERVAL ? DAY`, id, days).Scan(&st.Total, &ok)
	st.Success = int(ok.Int64)
	return st, err
}

func (s *Server) channelDetail(w http.ResponseWriter, r *http.Request, _ *auth.Principal) error {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		return httpx.Err(http.StatusBadRequest, "渠道 ID 无效")
	}
	var c channelOut
	err = s.DB.QueryRowContext(r.Context(), `SELECT id,name,provider,tier,model_id,icon,rate_multiplier FROM channels WHERE id=?`, id).
		Scan(&c.ID, &c.Name, &c.Provider, &c.Tier, &c.ModelID, &c.Icon, &c.Rate)
	if errors.Is(err, sql.ErrNoRows) {
		return httpx.Err(http.StatusNotFound, "渠道不存在")
	}
	if err != nil {
		return err
	}
	out := map[string]any{"channel": c}
	var lat testPoint
	var ok int
	e := s.DB.QueryRowContext(r.Context(), `SELECT response_time_ms,ping_ms,success,tested_at FROM channel_tests WHERE channel_id=? ORDER BY tested_at DESC, id DESC LIMIT 1`, id).
		Scan(&lat.Response, &lat.Ping, &ok, &lat.Time)
	if e == nil {
		lat.Success = ok == 1
		lat.Speed = string(monitor.Grade(lat.Response, lat.Ping, lat.Success))
		out["latest"] = lat
	} else if !errors.Is(e, sql.ErrNoRows) {
		return e
	}
	for _, d := range []int{7, 15, 30} {
		st, err := s.rangeStats(r, id, d)
		if err != nil {
			return err
		}
		out["availability"+strconv.Itoa(d)+"d"] = st.Rate() // -1 表示无数据
		out["samples"+strconv.Itoa(d)+"d"] = st.Total
	}
	var avg sql.NullFloat64
	if err := s.DB.QueryRowContext(r.Context(), `SELECT AVG(response_time_ms) FROM channel_tests WHERE channel_id=? AND success=1 AND tested_at > UTC_TIMESTAMP() - INTERVAL 7 DAY`, id).Scan(&avg); err != nil {
		return err
	}
	out["avgLatency7d"] = int(avg.Float64 + 0.5)
	httpx.OK(w, out)
	return nil
}

func (s *Server) channelTestStatus(w http.ResponseWriter, _ *http.Request, _ *auth.Principal) error {
	httpx.OK(w, s.Runner.Status())
	return nil
}

func (s *Server) channelTestStart(w http.ResponseWriter, r *http.Request, p *auth.Principal) error {
	t0 := time.Now()
	var in struct {
		Rounds int    `json:"rounds"`
		Tier   string `json:"tier"`
	}
	_ = httpx.Decode(r, &in)
	if in.Rounds < 1 {
		in.Rounds = testRounds
	}
	if in.Rounds > 120 {
		in.Rounds = 120
	}
	err := s.Runner.Start(in.Rounds, testGap, in.Tier)
	s.rec(r, p, "channel", "test_start", "渠道检测", "/channels", map[string]any{"rounds": in.Rounds, "tier": in.Tier}, err, t0)
	if errors.Is(err, monitor.ErrBusy) {
		return httpx.Conflict("检测任务进行中，请等待完成或先停止")
	}
	if err != nil {
		return err
	}
	httpx.OK(w, s.Runner.Status())
	return nil
}

func (s *Server) channelTestStop(w http.ResponseWriter, r *http.Request, p *auth.Principal) error {
	t0 := time.Now()
	s.Runner.Stop()
	s.rec(r, p, "channel", "test_stop", "渠道检测", "/channels", nil, nil, t0)
	httpx.OK(w, s.Runner.Status())
	return nil
}

func (s *Server) channelSeed(w http.ResponseWriter, r *http.Request, p *auth.Principal) error {
	t0 := time.Now()
	n, err := bootstrap.SeedChannels(r.Context(), s.DB)
	s.rec(r, p, "channel", "seed", "渠道目录", "/channels", map[string]any{"added": n}, err, t0)
	if err != nil {
		return err
	}
	httpx.OK(w, map[string]any{"added": n})
	return nil
}

func (s *Server) channelCleanup(w http.ResponseWriter, r *http.Request, p *auth.Principal) error {
	t0 := time.Now()
	n, err := bootstrap.RemoveModel(r.Context(), s.DB, "gpt-image-2")
	s.rec(r, p, "channel", "cleanup", "gpt-image-2", "/channels", map[string]any{"removed": n}, err, t0)
	if err != nil {
		return err
	}
	httpx.OK(w, map[string]any{"removed": n})
	return nil
}
