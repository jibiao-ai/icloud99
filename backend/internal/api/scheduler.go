package api

import (
	"context"
	"log"
	"time"

	"cloudwatch/internal/iq"
	"cloudwatch/internal/monitor"
)

// StartScheduler 启动后台调度：定时渠道检测、智力自动检测、历史清理。参数均来自页面可配置的 settings。
func (s *Server) StartScheduler(ctx context.Context) {
	go func() {
		var lastMonitor time.Time
		lastIQHour := -1
		lastPrune := time.Time{}
		tick := time.NewTicker(time.Minute)
		defer tick.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-tick.C:
				s.tickMonitor(ctx, now, &lastMonitor)
				s.tickIQ(ctx, now, &lastIQHour)
				if now.Sub(lastPrune) > 6*time.Hour {
					lastPrune = now
					s.Runner.PruneBefore(ctx, s.Store.SettingInt(ctx, "monitor.retention_days", 90))
				}
			}
		}
	}()
}

func (s *Server) tickMonitor(ctx context.Context, now time.Time, last *time.Time) {
	if s.Store.Setting(ctx, "monitor.enabled", "1") != "1" {
		return
	}
	interval := time.Duration(s.Store.SettingInt(ctx, "monitor.interval_minutes", 60)) * time.Minute
	if !monitor.ShouldRun(*last, now, interval) {
		return
	}
	if err := s.Runner.Start(1, 0, ""); err != nil {
		return // 已有任务在跑，下个 tick 再试
	}
	*last = now
	s.autoAudit("channel", "auto_test", "定时渠道检测", "/channels", nil)
}

func (s *Server) tickIQ(ctx context.Context, now time.Time, lastHour *int) {
	if s.Store.Setting(ctx, "iq.enabled", "1") != "1" {
		return
	}
	start := s.Store.SettingInt(ctx, "iq.start_hour", 2)
	end := s.Store.SettingInt(ctx, "iq.end_hour", 8)
	h := now.In(s.CST).Hour()
	tier, ok := iq.TierAt(h, start, end)
	if !ok || h == *lastHour {
		return
	}
	*lastHour = h
	go func() {
		cctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		t0 := time.Now()
		out, err := s.RunIQ(cctx, tier)
		if err != nil {
			log.Printf("[iq] 自动检测 %s 失败: %v", tier, err)
		}
		s.Audit.Record(auditEntry("iq", "auto_run", tier, "/iq", out, err, t0))
	}()
}
