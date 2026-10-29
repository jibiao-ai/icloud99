package detail

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"icloud99/internal/newapi"
	"icloud99/internal/usage"
)

// memStore 内存版本地库。
type memStore struct {
	mu    sync.Mutex
	rows  map[int64]newapi.LogItem
	marks map[string]int64
}

func newMem() *memStore {
	return &memStore{rows: map[int64]newapi.LogItem{}, marks: map[string]int64{}}
}

func (m *memStore) Upsert(_ context.Context, items []newapi.LogItem) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, it := range items {
		m.rows[it.ID] = it
	}
	return nil
}

func (m *memStore) DayState(_ context.Context, from, to string) (map[string]int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := map[string]int64{}
	for d, v := range m.marks {
		if d >= from && d <= to {
			out[d] = v
		}
	}
	return out, nil
}

func (m *memStore) MarkDay(_ context.Context, day string, until, _, _ int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if until > m.marks[day] {
		m.marks[day] = until
	}
	return nil
}

func day0(day string) int64 {
	t, _ := time.ParseInLocation("2006-01-02", day, usage.CST)
	return t.Unix()
}

// 三天，每天 30 条
func threeDays() (*fakeStore, int64, int64) {
	fs := &fakeStore{}
	base := day0("2026-09-10")
	id := int64(0)
	for d := 0; d < 3; d++ {
		for i := 0; i < 30; i++ {
			id++
			fs.rows = append(fs.rows, newapi.LogItem{ID: id, CreatedAt: base + int64(d)*86400 + int64(i)*600, Username: "u"})
		}
	}
	return fs, base, base + 3*86400 - 1
}

func TestSyncFillsAndSkipsCachedDays(t *testing.T) {
	fs, st, en := threeDays()
	ms := newMem()
	sy := &Syncer{Store: ms, Fetch: fs.fetch, Concurrency: 2}
	now := en + 3600
	res, err := sy.Sync(context.Background(), st, en, now, &Progress{}, nil)
	if err != nil || res.DaysTotal != 3 || res.DaysDone != 3 || res.DaysCached != 0 || len(ms.rows) != 90 {
		t.Fatalf("res=%+v err=%v rows=%d", res, err, len(ms.rows))
	}
	calls := fs.calls
	res, err = sy.Sync(context.Background(), st, en, now, &Progress{}, nil)
	if err != nil || res.DaysTotal != 0 || res.DaysCached != 3 || fs.calls != calls {
		t.Fatalf("已缓存的天不应再请求上游: res=%+v calls %d->%d err=%v", res, calls, fs.calls, err)
	}
	if n, c, _ := sy.Count(context.Background(), st, en, now); n != 0 || c != 3 {
		t.Fatalf("count %d %d", n, c)
	}
}

func TestSyncIncrementalOverlapForToday(t *testing.T) {
	fs, st, _ := threeDays()
	ms := newMem()
	sy := &Syncer{Store: ms, Fetch: fs.fetch, Concurrency: 1}
	// 现在是第 3 天中午：当天只同步到 now
	now := st + 2*86400 + 12*3600
	en := st + 3*86400 - 1
	if _, err := sy.Sync(context.Background(), st, en, now, &Progress{}, nil); err != nil {
		t.Fatal(err)
	}
	d3 := usage.TsToDay(st + 2*86400)
	if ms.marks[d3] != now {
		t.Fatalf("当天水位应为 now，实际 %d want %d", ms.marks[d3], now)
	}
	// 新日志在水位之后产生，下一轮增量应拿到
	fs.rows = append(fs.rows, newapi.LogItem{ID: 999, CreatedAt: now + 60, Username: "u"})
	now2 := now + 120
	res, err := sy.Sync(context.Background(), st, en, now2, &Progress{}, nil)
	if err != nil || res.DaysTotal != 1 || res.DaysCached != 2 {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	if _, ok := ms.rows[999]; !ok {
		t.Fatal("增量同步应补到新日志")
	}
}

func TestSyncSettleKeepsJustEndedDayOpen(t *testing.T) {
	fs, st, _ := threeDays()
	ms := newMem()
	sy := &Syncer{Store: ms, Fetch: fs.fetch, Concurrency: 1}
	d1End := DayEnd(st)
	// 第 1 天刚结束 10 秒：不应标记为完整
	if _, err := sy.Sync(context.Background(), st, d1End, d1End+10, &Progress{}, nil); err != nil {
		t.Fatal(err)
	}
	if ms.marks[usage.TsToDay(st)] >= d1End {
		t.Fatal("刚结束的一天应先留出延迟写入窗口")
	}
	// 过了窗口后补齐
	if _, err := sy.Sync(context.Background(), st, d1End, d1End+settleSecs+10, &Progress{}, nil); err != nil {
		t.Fatal(err)
	}
	if ms.marks[usage.TsToDay(st)] < d1End {
		t.Fatal("窗口过后应标记完整")
	}
}

func TestSyncFailureKeepsCompletedDays(t *testing.T) {
	fs, st, en := threeDays()
	base := day0(usage.TsToDay(st))
	ms := newMem()
	// 第三天的请求永久失败
	fs.fail = func(int) error { return nil }
	sy := &Syncer{Store: ms, Concurrency: 1}
	sy.Fetch = func(ctx context.Context, o newapi.LogOpt) ([]newapi.LogItem, int, error) {
		if o.Start >= base+2*86400 {
			return nil, 0, errors.New("boom")
		}
		return fs.fetch(ctx, o)
	}
	res, err := sy.Sync(context.Background(), st, en, en+3600, &Progress{}, nil)
	if err == nil || res.DaysDone != 2 {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	// 重试只补缺口
	sy.Fetch = fs.fetch
	res, err = sy.Sync(context.Background(), st, en, en+3600, &Progress{}, nil)
	if err != nil || res.DaysTotal != 1 || res.DaysCached != 2 || len(ms.rows) != 90 {
		t.Fatalf("res=%+v err=%v rows=%d", res, err, len(ms.rows))
	}
}

func TestSyncCancelKeepsCompletedDays(t *testing.T) {
	fs, st, en := threeDays()
	ms := newMem()
	ctx, cancel := context.WithCancel(context.Background())
	sy := &Syncer{Store: ms, Fetch: fs.fetch, Concurrency: 1}
	hook := func(x SyncState) {
		if x.DaysDone == 1 {
			cancel()
		}
	}
	res, err := sy.Sync(ctx, st, en, en+3600, &Progress{}, hook)
	if !errors.Is(err, context.Canceled) || res.DaysDone != 1 {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	if len(ms.marks) != 1 {
		t.Fatalf("marks=%v", ms.marks)
	}
}

func TestSyncSurvives429ViaThrottle(t *testing.T) {
	withShortPause(t, 5*time.Millisecond, 10*time.Millisecond, time.Minute)
	fs, st, en := threeDays()
	ms := newMem()
	hits := 0
	th := NewThrottle(60000)
	f := th.Wrap(func(ctx context.Context, o newapi.LogOpt) ([]newapi.LogItem, int, error) {
		if fs.calls%5 == 2 && hits < 6 { // 周期性限流
			hits++
			fs.calls++
			return nil, 0, rateErr(0)
		}
		return fs.fetch(ctx, o)
	})
	sy := &Syncer{Store: ms, Fetch: f, Concurrency: 3}
	res, err := sy.Sync(context.Background(), st, en, en+3600, &Progress{}, nil)
	if err != nil || res.DaysDone != 3 || len(ms.rows) != 90 || hits == 0 {
		t.Fatalf("res=%+v err=%v rows=%d hits=%d", res, err, len(ms.rows), hits)
	}
}

func TestMissingAndRecentRange(t *testing.T) {
	fs, st, en := threeDays()
	ms := newMem()
	sy := &Syncer{Store: ms, Fetch: fs.fetch}
	m, _ := sy.Missing(context.Background(), st, en, en+3600)
	if len(m) != 3 {
		t.Fatalf("%v", m)
	}
	a, b := RecentRange(time.Unix(st+86400+100, 0), 3)
	if usage.TsToDay(a) != "2026-09-09" || usage.TsToDay(b) != "2026-09-11" || b-a != 3*86400-1 {
		t.Fatalf("%s %s", usage.TsToDay(a), usage.TsToDay(b))
	}
}
