package usage

import (
	"context"
	"sync/atomic"
	"testing"

	"icloud99/internal/newapi"
)

func TestRefreshCooldown(t *testing.T) {
	var n int32
	s := NewService(newapi.New())
	s.builder = func(context.Context, *newapi.Client, newapi.Cfg, Period) (Summary, error) {
		atomic.AddInt32(&n, 1)
		return Summary{}, nil
	}
	cfg := newapi.Cfg{URL: "http://x"}
	p := Period{StartTs: 1, EndTs: 2}
	ctx := context.Background()

	if _, err := s.Get(ctx, cfg, p, true); err != nil || n != 1 {
		t.Fatalf("首次应计算一次, n=%d err=%v", n, err)
	}
	for i := 0; i < 5; i++ {
		d, _ := s.Get(ctx, cfg, p, true)
		if !d.Meta.RefreshDenied || !d.Meta.Cached || d.Meta.NextRefreshAt == 0 {
			t.Fatalf("冷却期内强刷应被拒绝并返回缓存: %+v", d.Meta)
		}
	}
	if n != 1 {
		t.Fatalf("冷却期内不应触达上游, n=%d", n)
	}
	p2 := Period{StartTs: 3, EndTs: 4}
	_, _ = s.Get(ctx, cfg, p2, false)
	if n != 2 {
		t.Fatalf("新周期首次加载应计算, n=%d", n)
	}
	d, _ := s.Get(ctx, cfg, p2, true)
	if !d.Meta.RefreshDenied || n != 2 {
		t.Fatalf("新周期强刷应被拒绝, n=%d denied=%v", n, d.Meta.RefreshDenied)
	}
}
