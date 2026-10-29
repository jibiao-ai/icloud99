package detail

import (
	"context"
	"errors"
	"testing"
	"time"

	"icloud99/internal/newapi"
)

func rateErr(ra time.Duration) error {
	return &newapi.Error{Kind: newapi.KRate, Msg: "请求被限流 (429)", RetryAfter: ra}
}

func withShortPause(t *testing.T, base, max, giveUp time.Duration) {
	ob, om, og := PauseBase, PauseMax, RateGiveUp
	PauseBase, PauseMax, RateGiveUp = base, max, giveUp
	t.Cleanup(func() { PauseBase, PauseMax, RateGiveUp = ob, om, og })
}

func TestThrottleHitBackoffAndRetryAfter(t *testing.T) {
	withShortPause(t, 20*time.Millisecond, 80*time.Millisecond, time.Minute)
	th := NewThrottle(6000)
	base := th.Interval()
	th.Hit(0)
	if d := th.PausedFor(); d <= 0 || d > 20*time.Millisecond {
		t.Fatalf("首次暂停应为 PauseBase，实际 %v", d)
	}
	if th.Hits() != 1 {
		t.Fatal("hits")
	}
	// 暂停期内重复上报不叠加退避（间隔只翻倍一次）
	th.Hit(0)
	if th.Hits() != 2 || th.Interval() != base*2 {
		t.Fatalf("hits=%d interval=%v base=%v", th.Hits(), th.Interval(), base)
	}
	time.Sleep(30 * time.Millisecond)
	th.Hit(0) // 第二次，翻倍
	if d := th.PausedFor(); d <= 20*time.Millisecond || d > 40*time.Millisecond {
		t.Fatalf("第二次暂停应翻倍，实际 %v", d)
	}
	time.Sleep(50 * time.Millisecond)
	th.Hit(time.Hour) // Retry-After 过大，被 PauseMax 截断
	if d := th.PausedFor(); d > 80*time.Millisecond {
		t.Fatalf("应被 PauseMax 截断，实际 %v", d)
	}
}

func TestThrottleOKSpeedsUpToBase(t *testing.T) {
	withShortPause(t, time.Millisecond, 5*time.Millisecond, time.Minute)
	th := NewThrottle(6000)
	base := th.Interval()
	th.Hit(0)
	if th.Interval() <= base {
		t.Fatal("命中 429 应降速")
	}
	for i := 0; i < 400; i++ {
		th.OK()
	}
	if th.Interval() != base {
		t.Fatalf("连续成功应恢复到基础间隔，实际 %v base %v", th.Interval(), base)
	}
}

func TestThrottleWaitCancel(t *testing.T) {
	th := NewThrottle(6000)
	th.Hit(time.Hour)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	if err := th.Wait(ctx); err == nil {
		t.Fatal("暂停期内取消应返回错误")
	}
}

func TestWrapRetriesAfter429ThenSucceeds(t *testing.T) {
	withShortPause(t, 10*time.Millisecond, 20*time.Millisecond, time.Minute)
	th := NewThrottle(60000)
	calls := 0
	f := th.Wrap(func(ctx context.Context, o newapi.LogOpt) ([]newapi.LogItem, int, error) {
		calls++
		if calls <= 3 {
			return nil, 0, rateErr(0)
		}
		return []newapi.LogItem{{ID: 1}}, 1, nil
	})
	items, total, err := f(context.Background(), newapi.LogOpt{})
	if err != nil || len(items) != 1 || total != 1 || calls != 4 {
		t.Fatalf("items=%v total=%d err=%v calls=%d", items, total, err, calls)
	}
	if th.Hits() != 3 {
		t.Fatalf("hits=%d", th.Hits())
	}
}

func TestWrapGivesUpAfterRateGiveUp(t *testing.T) {
	withShortPause(t, 5*time.Millisecond, 10*time.Millisecond, 60*time.Millisecond)
	th := NewThrottle(60000)
	f := th.Wrap(func(ctx context.Context, o newapi.LogOpt) ([]newapi.LogItem, int, error) {
		return nil, 0, rateErr(0)
	})
	_, _, err := f(context.Background(), newapi.LogOpt{})
	if err == nil || !IsRate(err) {
		t.Fatalf("应返回可识别的限流错误: %v", err)
	}
}

func TestWrapNonRateErrorReturnsImmediately(t *testing.T) {
	th := NewThrottle(60000)
	calls := 0
	boom := errors.New("boom")
	f := th.Wrap(func(ctx context.Context, o newapi.LogOpt) ([]newapi.LogItem, int, error) {
		calls++
		return nil, 0, boom
	})
	if _, _, err := f(context.Background(), newapi.LogOpt{}); !errors.Is(err, boom) || calls != 1 {
		t.Fatalf("err=%v calls=%d", err, calls)
	}
}

func TestWrapRespectsCancelWhilePaused(t *testing.T) {
	withShortPause(t, time.Hour, time.Hour, time.Hour)
	th := NewThrottle(60000)
	ctx, cancel := context.WithCancel(context.Background())
	f := th.Wrap(func(ctx context.Context, o newapi.LogOpt) ([]newapi.LogItem, int, error) {
		return nil, 0, rateErr(0)
	})
	go func() { time.Sleep(30 * time.Millisecond); cancel() }()
	_, _, err := f(ctx, newapi.LogOpt{})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("取消应立即返回 context.Canceled: %v", err)
	}
}
