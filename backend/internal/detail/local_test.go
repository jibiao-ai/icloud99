package detail

import (
	"context"
	"os"
	"testing"

	"icloud99/internal/db"
	"icloud99/internal/newapi"
)

// 集成测试：需要 ICLOUD99_TEST_DSN 指向一个专用的空库，未设置时跳过。
func testLocal(t *testing.T) *Local {
	t.Helper()
	dsn := os.Getenv("ICLOUD99_TEST_DSN")
	if dsn == "" {
		t.Skip("未设置 ICLOUD99_TEST_DSN，跳过本地库集成测试")
	}
	if err := db.Migrate(dsn); err != nil {
		t.Fatal(err)
	}
	conn, err := db.Open(dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	for _, q := range []string{"DELETE FROM usage_logs", "DELETE FROM usage_log_days"} {
		if _, err := conn.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	return &Local{DB: conn}
}

func TestLocalUpsertCountStreamPrune(t *testing.T) {
	l := testLocal(t)
	ctx := context.Background()
	old := streamPage
	streamPage = 7 // 缩小分页，覆盖翻页逻辑
	defer func() { streamPage = old }()

	base := day0("2026-09-10")
	var items []newapi.LogItem
	for i := 0; i < 50; i++ {
		u := "alice"
		if i%2 == 1 {
			u = "bob"
		}
		// 每 5 条同一秒，验证 (created_at, log_id) 复合游标不丢不重
		items = append(items, newapi.LogItem{ID: int64(100 + i), CreatedAt: base + int64(i/5), Username: u, UserID: 1,
			ModelName: "m", Quota: 500000, PromptTokens: 3, CompletionTokens: 4, Content: "内容 " + u})
	}
	if err := l.Upsert(ctx, items); err != nil {
		t.Fatal(err)
	}
	if err := l.Upsert(ctx, items); err != nil { // 幂等
		t.Fatal(err)
	}
	n, err := l.Count(ctx, base, base+100, nil)
	if err != nil || n != 50 {
		t.Fatalf("n=%d err=%v", n, err)
	}
	if n, _ := l.Count(ctx, base, base+100, []string{"alice"}); n != 25 {
		t.Fatalf("alice=%d", n)
	}

	collect := func(users []string) []Row {
		var got []Row
		if err := l.Stream(ctx, base, base+100, users, 500000, func(r Row) error { got = append(got, r); return nil }); err != nil {
			t.Fatal(err)
		}
		return got
	}
	all := collect(nil)
	if len(all) != 50 {
		t.Fatalf("stream=%d", len(all))
	}
	for i := 1; i < len(all); i++ {
		a, b := all[i-1], all[i]
		if a.Time > b.Time || (a.Time == b.Time && a.LogID >= b.LogID) {
			t.Fatalf("顺序错误 %d: %v %v", i, a, b)
		}
	}
	if all[0].CostUSD != 1 || all[0].Total != 7 || all[0].Content == "" {
		t.Fatalf("行内容不对: %+v", all[0])
	}
	if got := collect([]string{"bob"}); len(got) != 25 {
		t.Fatalf("bob=%d", len(got))
	}
	if got := collect([]string{"alice", "bob"}); len(got) != 50 {
		t.Fatalf("both=%d", len(got))
	}

	// 回调报错应中止
	cnt := 0
	err = l.Stream(ctx, base, base+100, nil, 500000, func(Row) error {
		if cnt++; cnt == 3 {
			return context.Canceled
		}
		return nil
	})
	if err != context.Canceled || cnt != 3 {
		t.Fatalf("err=%v cnt=%d", err, cnt)
	}

	// 水位只增不减
	if err := l.MarkDay(ctx, "2026-09-10", base+500, base, base+86399); err != nil {
		t.Fatal(err)
	}
	if err := l.MarkDay(ctx, "2026-09-10", base+100, base, base+86399); err != nil {
		t.Fatal(err)
	}
	st, err := l.DayState(ctx, "2026-09-01", "2026-09-30")
	if err != nil || st["2026-09-10"] != base+500 {
		t.Fatalf("st=%v err=%v", st, err)
	}
	stats, err := l.Stats(ctx)
	if err != nil || stats.Rows != 50 || stats.Days != 1 || stats.FirstDay != "2026-09-10" {
		t.Fatalf("stats=%+v err=%v", stats, err)
	}

	// 清理
	removed, err := l.Prune(ctx, base+3, "2026-09-11")
	if err != nil || removed == 0 {
		t.Fatalf("removed=%d err=%v", removed, err)
	}
	if n, _ := l.Count(ctx, base, base+100, nil); n != 50-removed {
		t.Fatalf("清理后剩余 %d", n)
	}
	if st, _ := l.DayState(ctx, "2026-09-01", "2026-09-30"); len(st) != 0 {
		t.Fatalf("日水位应被清理: %v", st)
	}
}

// 同步器 + 真实本地库端到端：二次同步不再请求上游。
func TestSyncerWithRealLocal(t *testing.T) {
	l := testLocal(t)
	fs, st, en := threeDays()
	sy := &Syncer{Store: l, Fetch: fs.fetch, Concurrency: 2}
	now := en + 3600
	res, err := sy.Sync(context.Background(), st, en, now, &Progress{}, nil)
	if err != nil || res.DaysDone != 3 {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	calls := fs.calls
	res, err = sy.Sync(context.Background(), st, en, now, &Progress{}, nil)
	if err != nil || res.DaysCached != 3 || fs.calls != calls {
		t.Fatalf("res=%+v calls=%d->%d", res, calls, fs.calls)
	}
	if n, _ := l.Count(context.Background(), st, en, nil); n != 90 {
		t.Fatalf("n=%d", n)
	}
}
