package detail

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"icloud99/internal/newapi"
)

// 限速参数（测试中可缩短）。
var (
	// PauseBase 首次遇到 429 后全局暂停的时长；连续命中则翻倍，直到 PauseMax。
	PauseBase = 15 * time.Second
	PauseMax  = 3 * time.Minute
	// RateGiveUp 单个请求持续被限流超过该时长才放弃（期间一直按全局暂停等待重试）。
	RateGiveUp = 45 * time.Minute
)

// IsRate 判断是否上游限流错误（429）。
func IsRate(err error) bool {
	var ne *newapi.Error
	return errors.As(err, &ne) && ne.Kind == newapi.KRate
}

// Throttle 全局请求限速器（所有并发段共享）：
//   - 按 perMinute 匀速放行请求；
//   - 命中 429 时全局暂停（指数退避）并把间隔放大一倍（降速）；
//   - 连续成功后缓慢提速，最多恢复到初始速率。
type Throttle struct {
	mu          sync.Mutex
	base, cur   time.Duration
	max         time.Duration
	next        time.Time
	pauseUntil  time.Time
	consecutive int
	okStreak    int
	hits        int
	perMin      int
}

// NewThrottle perMinute 为每分钟最多请求数（<=0 取 60）。
func NewThrottle(perMinute int) *Throttle {
	t := &Throttle{}
	t.SetRate(perMinute)
	return t
}

// SetRate 调整基础速率（同时重置降速状态）。
func (t *Throttle) SetRate(perMinute int) {
	if perMinute <= 0 {
		perMinute = 60
	}
	t.mu.Lock()
	if t.perMin == perMinute {
		t.mu.Unlock()
		return
	}
	t.perMin = perMinute
	t.base = time.Minute / time.Duration(perMinute)
	t.cur = t.base
	t.max = 20 * time.Second
	if t.max < t.base {
		t.max = t.base
	}
	t.mu.Unlock()
}

// Wait 阻塞到允许发起下一次请求。
func (t *Throttle) Wait(ctx context.Context) error {
	for {
		t.mu.Lock()
		now := time.Now()
		start := t.next
		if t.pauseUntil.After(start) {
			start = t.pauseUntil
		}
		if !start.After(now) {
			t.next = now.Add(t.cur)
			t.mu.Unlock()
			return ctx.Err()
		}
		d := start.Sub(now)
		t.mu.Unlock()
		select {
		case <-time.After(d):
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

// Hit 记录一次 429：全局暂停并降速。暂停期内重复上报不再叠加退避。
// retryAfter > 0 时按上游给出的时长暂停（至少 1 秒），否则指数退避。
func (t *Throttle) Hit(retryAfter time.Duration) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.hits++
	t.okStreak = 0
	now := time.Now()
	if now.Before(t.pauseUntil) {
		return
	}
	pause := PauseBase << uint(min(t.consecutive, 6))
	if retryAfter > 0 {
		pause = max(retryAfter, time.Second)
	}
	if pause > PauseMax || pause <= 0 {
		pause = PauseMax
	}
	t.consecutive++
	t.pauseUntil = now.Add(pause)
	t.cur *= 2
	if t.cur > t.max {
		t.cur = t.max
	}
}

// OK 记录一次成功：连续 20 次成功后提速 20%（不快于初始速率）。
func (t *Throttle) OK() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.consecutive = 0
	if t.okStreak++; t.okStreak >= 20 {
		t.okStreak = 0
		if t.cur = t.cur * 8 / 10; t.cur < t.base {
			t.cur = t.base
		}
	}
}

// Hits 累计命中限流次数。
func (t *Throttle) Hits() int { t.mu.Lock(); defer t.mu.Unlock(); return t.hits }

// PausedFor 当前全局暂停还剩多久（0 表示未暂停）。
func (t *Throttle) PausedFor() time.Duration {
	t.mu.Lock()
	defer t.mu.Unlock()
	if d := time.Until(t.pauseUntil); d > 0 {
		return d
	}
	return 0
}

// Interval 当前放行间隔（便于展示/测试）。
func (t *Throttle) Interval() time.Duration { t.mu.Lock(); defer t.mu.Unlock(); return t.cur }

// Wrap 给 Fetch 套上限速与限流反馈：命中 429 不立即失败，而是全局暂停后重试，直到成功或超过 RateGiveUp。
func (t *Throttle) Wrap(f Fetch) Fetch {
	return func(ctx context.Context, o newapi.LogOpt) ([]newapi.LogItem, int, error) {
		first := time.Time{}
		for {
			if err := t.Wait(ctx); err != nil {
				return nil, 0, err
			}
			items, total, err := f(newapi.NoRateRetry(ctx), o)
			switch {
			case err == nil:
				t.OK()
				return items, total, nil
			case IsRate(err):
				var ne *newapi.Error
				errors.As(err, &ne)
				t.Hit(ne.RetryAfter)
				if first.IsZero() {
					first = time.Now()
				}
				if time.Since(first) > RateGiveUp {
					return nil, 0, fmt.Errorf("上游持续限流超过 %d 分钟，已放弃本次请求：%w", int(RateGiveUp.Minutes()), err)
				}
			default:
				return nil, 0, err
			}
		}
	}
}
