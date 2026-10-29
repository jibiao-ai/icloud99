package api

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"icloud99/internal/auth"
	"icloud99/internal/detail"
	"icloud99/internal/httpx"
	"icloud99/internal/monitor"
	"icloud99/internal/newapi"
	"icloud99/internal/store"
	"icloud99/internal/usage"
)

// syncGate 保证同一时刻只有一个任务在向 New API 同步明细（后台预同步 / 手动导出 / 仅同步共用）。
type syncGate struct {
	once sync.Once
	ch   chan struct{}
}

func (g *syncGate) init() { g.once.Do(func() { g.ch = make(chan struct{}, 1) }) }

func (g *syncGate) acquire(ctx context.Context) error {
	g.init()
	select {
	case g.ch <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (g *syncGate) try() bool {
	g.init()
	select {
	case g.ch <- struct{}{}:
		return true
	default:
		return false
	}
}

func (g *syncGate) release() { <-g.ch }

// autoSync 后台预同步的最近状态（仅内存，用于页面展示）。
type autoSync struct {
	mu      sync.Mutex
	running bool
	startAt time.Time
	lastAt  time.Time
	lastErr string
	days    int
	state   detail.SyncState
	cancel  context.CancelFunc
}

// stop 取消正在运行的后台预同步（手动导出需要同步闸门时调用；已完成的天已落库，不会丢）。
func (a *autoSync) stop() {
	a.mu.Lock()
	if a.cancel != nil {
		a.cancel()
	}
	a.mu.Unlock()
}

func (s *Server) local() *detail.Local { return &detail.Local{DB: s.DB} }

// thr 返回全局限速器，并按页面配置的「每分钟请求数」更新速率。
func (s *Server) thr(ctx context.Context) *detail.Throttle {
	s.thrOnce.Do(func() { s.throttle = detail.NewThrottle(50) })
	s.throttle.SetRate(s.Store.SettingInt(ctx, "detail.rate_limit", 50))
	return s.throttle
}

// syncer 构造带限速的同步器。
func (s *Server) syncer(ctx context.Context, cfg newapi.Cfg) *detail.Syncer {
	fetch := s.thr(ctx).Wrap(func(ctx context.Context, o newapi.LogOpt) ([]newapi.LogItem, int, error) {
		return s.NewAPI.ListLogs(ctx, cfg, o)
	})
	return &detail.Syncer{Store: s.local(), Fetch: fetch, Concurrency: detail.Concurrency}
}

// tickDetailSync 定时把最近几天的明细同步到本地库（已完整的天直接跳过，只补当天增量）。
func (s *Server) tickDetailSync(ctx context.Context, now time.Time, last *time.Time) {
	if s.Store.Setting(ctx, "detail.sync_enabled", "1") != "1" {
		return
	}
	interval := time.Duration(s.Store.SettingInt(ctx, "detail.sync_interval_minutes", 30)) * time.Minute
	if !monitor.ShouldRun(*last, now, interval) {
		return
	}
	cfg, err := s.Store.NewAPICfg(ctx)
	if err != nil {
		if !errors.Is(err, store.ErrNotConfigured) {
			log.Printf("[detail-sync] 读取 New API 配置失败: %v", err)
		}
		return
	}
	if !s.gate.try() { // 有导出/同步在跑，下个 tick 再试
		return
	}
	*last = now
	days := s.Store.SettingInt(ctx, "detail.sync_days", 3)
	go func() {
		defer s.gate.release()
		s.autoSyncRun(ctx, cfg, days)
	}()
}

func (s *Server) autoSyncRun(parent context.Context, cfg newapi.Cfg, days int) {
	a := &s.auto
	ctx, cancel := context.WithTimeout(parent, 2*time.Hour)
	defer cancel()
	a.mu.Lock()
	a.running, a.startAt, a.days, a.state, a.cancel = true, time.Now(), days, detail.SyncState{}, cancel
	a.mu.Unlock()
	now := time.Now()
	st, en := detail.RecentRange(now, days)
	prog := &detail.Progress{}
	_, err := s.syncer(ctx, cfg).Sync(ctx, st, en, now.Unix(), prog, func(x detail.SyncState) {
		a.mu.Lock()
		a.state = x
		a.mu.Unlock()
	})
	a.mu.Lock()
	a.running, a.lastAt, a.cancel = false, time.Now(), nil
	a.lastErr = ""
	if err != nil && !errors.Is(err, context.Canceled) {
		a.lastErr = err.Error()
	}
	a.mu.Unlock()
	if err != nil && !errors.Is(err, context.Canceled) {
		log.Printf("[detail-sync] 后台同步失败: %v", err)
		s.autoAudit("detail", "auto_sync", fmt.Sprintf("最近 %d 天", days), "/detail-export", map[string]any{"error": err.Error()})
	}
}

// pruneDetail 清理超过保留期的本地明细。
func (s *Server) pruneDetail(ctx context.Context) {
	days := s.Store.SettingInt(ctx, "detail.retention_days", 180)
	if days <= 0 {
		return
	}
	cut := time.Now().In(usage.CST).AddDate(0, 0, -days)
	day := time.Date(cut.Year(), cut.Month(), cut.Day(), 0, 0, 0, 0, usage.CST)
	n, err := s.local().Prune(ctx, day.Unix(), day.Format("2006-01-02"))
	if err != nil {
		log.Printf("[detail-sync] 清理本地明细失败: %v", err)
		return
	}
	if n > 0 {
		log.Printf("[detail-sync] 已清理 %d 条超过 %d 天的本地明细", n, days)
	}
}

// detailLocal 本地明细库概况 + 后台同步状态 + 上游限流状态。
func (s *Server) detailLocal(w http.ResponseWriter, r *http.Request, _ *auth.Principal) error {
	ctx := r.Context()
	st, err := s.local().Stats(ctx)
	if err != nil {
		return err
	}
	t := s.thr(ctx)
	a := &s.auto
	a.mu.Lock()
	auto := map[string]any{"running": a.running, "lastError": a.lastErr, "days": a.days, "day": a.state.Day}
	if !a.lastAt.IsZero() {
		auto["lastAt"] = a.lastAt.UTC().Format(time.RFC3339)
	}
	a.mu.Unlock()
	httpx.OK(w, map[string]any{
		"stats": st,
		"auto":  auto,
		"config": map[string]any{
			"enabled":         s.Store.Setting(ctx, "detail.sync_enabled", "1") == "1",
			"intervalMinutes": s.Store.SettingInt(ctx, "detail.sync_interval_minutes", 30),
			"syncDays":        s.Store.SettingInt(ctx, "detail.sync_days", 3),
			"retentionDays":   s.Store.SettingInt(ctx, "detail.retention_days", 180),
			"ratePerMinute":   s.Store.SettingInt(ctx, "detail.rate_limit", 50),
		},
		"throttle": map[string]any{"pausedSec": int(t.PausedFor().Seconds()) + btoi(t.PausedFor() > 0 && t.PausedFor() < time.Second), "hits": t.Hits(), "intervalMs": t.Interval().Milliseconds()},
	})
	return nil
}

func btoi(b bool) int {
	if b {
		return 1
	}
	return 0
}
