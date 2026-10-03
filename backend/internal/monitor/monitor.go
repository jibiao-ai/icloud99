// Package monitor 渠道可用性检测：评级、历史统计与定时调度。
package monitor

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"icloud99/internal/store"
)

// Speed 速度评级。
type Speed string

// 速度评级常量（阈值与历史版本一致）。
const (
	SpeedUnknown Speed = "unknown"
	SpeedFast    Speed = "fast"
	SpeedSlow    Speed = "slow"
	SpeedJam     Speed = "jam"
)

// Grade 按延迟与 ping 评级：<=25s 且 ping<=1.5s 极速；>=50s 或 ping>=3s 拥堵；其余较慢。
func Grade(responseMs, pingMs int, success bool) Speed {
	if !success || responseMs <= 0 {
		return SpeedUnknown
	}
	if responseMs <= 25000 && pingMs <= 1500 {
		return SpeedFast
	}
	if responseMs >= 50000 || pingMs >= 3000 {
		return SpeedJam
	}
	return SpeedSlow
}

// RangeStats 区间可用率。
type RangeStats struct {
	Total   int
	Success int
}

// Rate 可用率百分比（保留 2 位），无数据返回 -1。
func (r RangeStats) Rate() float64 {
	if r.Total == 0 {
		return -1
	}
	return float64(int(float64(r.Success)/float64(r.Total)*10000+0.5)) / 100
}

// Result 单次检测结果。
type Result struct {
	Success    bool
	ResponseMs int
	PingMs     int
	Err        string
}

// Probe 对上游做一次检测：GET /v1/models 测 ping，再 POST chat 测响应。
func Probe(ctx context.Context, hc *http.Client, baseURL, key, model string) Result {
	base := strings.TrimRight(baseURL, "/")
	ping := -1
	{
		cctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		t0 := time.Now()
		req, _ := http.NewRequestWithContext(cctx, http.MethodGet, base+"/v1/models", nil)
		req.Header.Set("Authorization", "Bearer "+key)
		if resp, err := hc.Do(req); err == nil {
			_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
			resp.Body.Close()
			ping = int(time.Since(t0).Milliseconds())
		}
		cancel()
	}
	body, _ := json.Marshal(map[string]any{"model": model, "messages": []map[string]string{{"role": "user", "content": "Hi"}}, "max_tokens": 5, "stream": false})
	cctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	t0 := time.Now()
	req, _ := http.NewRequestWithContext(cctx, http.MethodPost, base+"/v1/chat/completions", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	resp, err := hc.Do(req)
	if err != nil {
		return Result{PingMs: ping, Err: err.Error()}
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
	ms := int(time.Since(t0).Milliseconds())
	if resp.StatusCode != 200 {
		return Result{ResponseMs: ms, PingMs: ping, Err: fmt.Sprintf("HTTP %d", resp.StatusCode)}
	}
	return Result{Success: true, ResponseMs: ms, PingMs: ping}
}

// ErrBusy 已有检测任务在运行。
var ErrBusy = errors.New("检测任务进行中")

// Runner 检测执行与调度（服务端后台任务，不依赖浏览器常开）。
type Runner struct {
	DB    *sql.DB
	Store *store.Store
	HTTP  *http.Client

	mu      sync.Mutex
	running bool
	done    int
	total   int
	tier    string
	cancel  context.CancelFunc
}

// Status 当前任务进度。
type Status struct {
	Running bool   `json:"running"`
	Done    int    `json:"done"`
	Total   int    `json:"total"`
	Tier    string `json:"tier"`
}

// Status 返回进度快照。
func (r *Runner) Status() Status {
	r.mu.Lock()
	defer r.mu.Unlock()
	return Status{Running: r.running, Done: r.done, Total: r.total, Tier: r.tier}
}

// Stop 停止当前任务（已完成的轮次保留）。
func (r *Runner) Stop() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cancel != nil {
		r.cancel()
	}
}

// Start 后台执行 rounds 轮检测，轮间隔 interval；已在运行返回 ErrBusy。
func (r *Runner) Start(rounds int, interval time.Duration, tier string) error {
	if rounds < 1 {
		rounds = 1
	}
	r.mu.Lock()
	if r.running {
		r.mu.Unlock()
		return ErrBusy
	}
	ctx, cancel := context.WithCancel(context.Background())
	r.running, r.done, r.total, r.tier, r.cancel = true, 0, rounds, tier, cancel
	r.mu.Unlock()

	go func() {
		defer func() {
			cancel()
			r.mu.Lock()
			r.running, r.cancel = false, nil
			r.mu.Unlock()
		}()
		for i := 0; i < rounds; i++ {
			if err := r.round(ctx, tier); err != nil {
				log.Printf("[monitor] 检测轮次失败: %v", err)
			}
			r.mu.Lock()
			r.done = i + 1
			r.mu.Unlock()
			if i == rounds-1 {
				return
			}
			select {
			case <-time.After(interval):
			case <-ctx.Done():
				return
			}
		}
	}()
	return nil
}

// ChannelRow 待检测渠道。
type ChannelRow struct {
	ID       int64
	Name     string
	Provider string
	Tier     string
	ModelID  string
}

// round 对全部启用渠道（可按 tier 过滤）检测一轮并写库。
func (r *Runner) round(ctx context.Context, tier string) error {
	q := `SELECT id,name,provider,tier,model_id FROM channels WHERE is_active=1`
	var args []any
	if tier != "" {
		q += ` AND tier=?`
		args = append(args, tier)
	}
	q += ` ORDER BY provider,tier,sort_order`
	rows, err := r.DB.QueryContext(ctx, q, args...)
	if err != nil {
		return err
	}
	var chs []ChannelRow
	for rows.Next() {
		var c ChannelRow
		if err := rows.Scan(&c.ID, &c.Name, &c.Provider, &c.Tier, &c.ModelID); err != nil {
			rows.Close()
			return err
		}
		chs = append(chs, c)
	}
	rows.Close()

	for _, c := range chs {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		var res Result
		key, kerr := r.Store.GetChannelKey(ctx, c.Provider, c.Tier)
		if kerr != nil {
			res = Result{Err: "未配置密钥", PingMs: -1}
		} else {
			res = Probe(ctx, r.HTTP, key.BaseURL, key.APIKey, c.ModelID)
		}
		ok := 0
		if res.Success {
			ok = 1
		}
		ping := res.PingMs
		if ping < 0 {
			ping = 0
		}
		if _, e := r.DB.ExecContext(ctx, `INSERT INTO channel_tests(channel_id,response_time_ms,ping_ms,success,tested_at) VALUES(?,?,?,?,UTC_TIMESTAMP())`,
			c.ID, res.ResponseMs, ping, ok); e != nil {
			log.Printf("[monitor] 写入检测结果失败: %v", e)
		}
	}
	return nil
}

// ShouldRun 判断是否到了下一次执行时间。
func ShouldRun(last, now time.Time, interval time.Duration) bool {
	return last.IsZero() || now.Sub(last) >= interval
}

// PruneBefore 清理过旧检测记录（保留 N 天）。
func (r *Runner) PruneBefore(ctx context.Context, days int) {
	if days <= 0 {
		return
	}
	if _, err := r.DB.ExecContext(ctx, `DELETE FROM channel_tests WHERE tested_at < UTC_TIMESTAMP() - INTERVAL ? DAY`, days); err != nil {
		log.Printf("[monitor] 清理历史失败: %v", err)
	}
}
