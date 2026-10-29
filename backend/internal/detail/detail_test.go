package detail

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/xuri/excelize/v2"

	"icloud99/internal/newapi"
)

func init() { retryDelay = time.Millisecond }

// fakeStore 模拟 New API 日志接口：按用户 / 时间过滤，分页，返回满足条件的总数。
type fakeStore struct {
	mu    sync.Mutex
	rows  []newapi.LogItem
	calls int
	fail  func(call int) error
}

func (f *fakeStore) fetch(_ context.Context, o newapi.LogOpt) ([]newapi.LogItem, int, error) {
	f.mu.Lock()
	f.calls++
	n := f.calls
	f.mu.Unlock()
	if f.fail != nil {
		if err := f.fail(n); err != nil {
			return nil, 0, err
		}
	}
	var m []newapi.LogItem
	for _, r := range f.rows {
		if r.CreatedAt >= o.Start && r.CreatedAt <= o.End && (o.Username == "" || r.Username == o.Username) {
			m = append(m, r)
		}
	}
	// New API 默认按 id 倒序
	sort.Slice(m, func(i, j int) bool { return m[i].ID > m[j].ID })
	ps := o.PageSize
	lo := (o.Page - 1) * ps
	if lo > len(m) {
		lo = len(m)
	}
	hi := lo + ps
	if hi > len(m) {
		hi = len(m)
	}
	return m[lo:hi], len(m), nil
}

func mk(n int, base int64, users []string) *fakeStore {
	fs := &fakeStore{}
	for i := 0; i < n; i++ {
		// 时间分布不均：前一天密集，后几天稀疏
		ts := base + int64(i%3)*100 + int64(i/3)*7
		fs.rows = append(fs.rows, newapi.LogItem{ID: int64(i + 1), CreatedAt: ts, Username: users[i%len(users)], Quota: 500000})
	}
	return fs
}

func collect(t *testing.T, fs *fakeStore, p Params) ([]newapi.LogItem, *Progress, error) {
	t.Helper()
	var got []newapi.LogItem
	prog := &Progress{}
	err := Collect(context.Background(), fs.fetch, p, prog, func(items []newapi.LogItem) error { got = append(got, items...); return nil })
	return got, prog, err
}

func TestCollectSplitsAndKeepsOrder(t *testing.T) {
	base := int64(1_788_192_000) // 2026-09-01 00:00:00 CST
	fs := mk(1234, base, []string{"a", "b", "c"})
	p := Params{StartTs: base, EndTs: base + 3*86400 - 1, WindowCap: 50, Concurrency: 3}
	got, prog, err := collect(t, fs, p)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1234 {
		t.Fatalf("行数不符 %d", len(got))
	}
	seen := map[int64]bool{}
	for i, r := range got {
		if seen[r.ID] {
			t.Fatalf("重复 id %d", r.ID)
		}
		seen[r.ID] = true
		if i > 0 && got[i-1].CreatedAt > r.CreatedAt {
			t.Fatalf("未按时间升序 @%d", i)
		}
	}
	_, done, splits, rows, _, _ := prog.Snapshot()
	if splits == 0 || rows != 1234 || done == 0 {
		t.Fatalf("应触发二分: splits=%d rows=%d done=%d", splits, rows, done)
	}
}

func TestCollectSpecificUsers(t *testing.T) {
	base := int64(1_788_192_000)
	fs := mk(300, base, []string{"a", "b", "c"})
	got, _, err := collect(t, fs, Params{StartTs: base, EndTs: base + 86400 - 1, Users: []string{"a", "c"}, WindowCap: 40})
	if err != nil || len(got) != 200 {
		t.Fatalf("指定用户应得 200 条: %d %v", len(got), err)
	}
	for _, r := range got {
		if r.Username == "b" {
			t.Fatal("混入未选用户")
		}
	}
}

func TestCollectSameSecondBeyondCap(t *testing.T) {
	base := int64(1_788_192_000)
	fs := &fakeStore{}
	for i := 0; i < 120; i++ { // 同一秒 120 条，cap=20 也无法再切，必须翻页拉全
		fs.rows = append(fs.rows, newapi.LogItem{ID: int64(i + 1), CreatedAt: base + 5, Username: "a"})
	}
	got, _, err := collect(t, fs, Params{StartTs: base, EndTs: base + 86399, WindowCap: 20})
	if err != nil || len(got) != 120 {
		t.Fatalf("got %d err %v", len(got), err)
	}
}

func TestCollectRetriesTransientAndFailsPermanent(t *testing.T) {
	base := int64(1_788_192_000)
	fs := mk(30, base, []string{"a"})
	fs.fail = func(n int) error {
		if n == 1 || n == 2 {
			return errors.New("限流")
		}
		return nil
	}
	got, _, err := collect(t, fs, Params{StartTs: base, EndTs: base + 86399})
	if err != nil || len(got) != 30 {
		t.Fatalf("瞬时失败应自动重试: %d %v", len(got), err)
	}
	fs2 := mk(30, base, []string{"a"})
	fs2.fail = func(int) error { return errors.New("上游挂了") }
	if _, _, err = collect(t, fs2, Params{StartTs: base, EndTs: base + 86399}); err == nil {
		t.Fatal("持续失败应返回错误而不是静默丢数据")
	}
}

func TestCollectMaxRowsAndCancel(t *testing.T) {
	base := int64(1_788_192_000)
	fs := mk(500, base, []string{"a"})
	if _, _, err := collect(t, fs, Params{StartTs: base, EndTs: base + 86399, MaxTotalRows: 100}); err == nil {
		t.Fatal("超过行数上限应报错")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err := Collect(ctx, fs.fetch, Params{StartTs: base, EndTs: base + 86399}, &Progress{}, func([]newapi.LogItem) error { return nil })
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("取消应返回 context.Canceled: %v", err)
	}
}

func TestInitialSegmentsByCSTDay(t *testing.T) {
	base := int64(1_788_192_000)
	segs := initialSegments(Params{StartTs: base + 3600, EndTs: base + 2*86400 + 100, Users: []string{"a", "b"}})
	if len(segs) != 6 {
		t.Fatalf("2 用户 × 3 天 = 6: %d", len(segs))
	}
	if segs[0].e != base+86399 || segs[2].e != base+2*86400+100 {
		t.Fatalf("按北京自然日切分: %+v", segs[:3])
	}
}

func TestToRowAndUpstreamID(t *testing.T) {
	it := newapi.LogItem{ID: 9, CreatedAt: 1_788_192_001, Username: "u", PromptTokens: 10, CompletionTokens: 5, Quota: 250000, IsStream: true, Channel: float64(7),
		Other: []byte(`"{\"upstream_request_id\":\"up-1\"}"`)}
	r := ToRow(it, 500000)
	if r.Time != "2026-09-01 00:00:01" || r.Total != 15 || r.CostUSD != 0.5 || r.IsStream != 1 || r.Channel != 7 || r.LogType != 2 || r.UpstreamID != "up-1" {
		t.Fatalf("%+v", r)
	}
	if upstreamID([]byte(`{"upstream_id":"x"}`)) != "x" || upstreamID([]byte(`"not json"`)) != "" || upstreamID(nil) != "" {
		t.Fatal("upstreamID 解析异常")
	}
}

func TestWriterSplitsFilesAndMatchesReferenceFormat(t *testing.T) {
	dir := t.TempDir()
	w := NewWriter(dir, "使用明细_2026-09-01_2026-09-03", "09月明细", 1000)
	for i := 0; i < 2500; i++ {
		if err := w.Add(Row{Time: fmt.Sprintf("2026-09-01 00:%02d:%02d", i/60%60, i%60), LogID: int64(i + 1), UserID: 2, Username: "妙妙喵", Model: "gpt-5.5",
			Prompt: 10, Completion: 5, Total: 15, Quota: 500, CostUSD: 0.001, LogType: 2, Channel: 7, RequestID: fmt.Sprint("r", i), IP: "1.1.1.1"}); err != nil {
			t.Fatal(err)
		}
	}
	files, err := w.Close()
	if err != nil || len(files) != 3 {
		t.Fatalf("2500 行 / 1000 每文件 = 3 个文件: %d %v", len(files), err)
	}
	if files[0].Name != "使用明细_2026-09-01_2026-09-03_第1部分.xlsx" || files[0].Rows != 1000 || files[2].Rows != 500 {
		t.Fatalf("%+v", files)
	}
	f, err := excelize.OpenFile(files[2].Path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	rows, err := f.GetRows("09月明细")
	if err != nil || len(rows) != 501 {
		t.Fatalf("表头 + 500 行: %d %v", len(rows), err)
	}
	for i, h := range Headers {
		if rows[0][i] != h {
			t.Fatalf("表头第 %d 列应为 %s 实为 %s", i, h, rows[0][i])
		}
	}
	for _, gone := range []string{"channel", "channel_name", "request_id", "upstream_request_id", "ip"} {
		for _, h := range Headers {
			if h == gone {
				t.Fatalf("表头不应再包含 %s", gone)
			}
		}
	}
	if len(rows[0]) != 16 || len(colWidths) != len(Headers) {
		t.Fatalf("应为 16 列且列宽数量一致: 表头 %d 列宽 %d 实际列 %d", len(Headers), len(colWidths), len(rows[0]))
	}
	if len(Headers) != 16 || rows[1][3] != "妙妙喵" || rows[1][1] != "2001" {
		t.Fatalf("数据行: %v", rows[1])
	}
}

func TestWriterSingleFileAndEmpty(t *testing.T) {
	dir := t.TempDir()
	w := NewWriter(dir, "x", "明细", 0)
	_ = w.Add(Row{Time: "2026-09-01 00:00:00", LogID: 1})
	files, err := w.Close()
	if err != nil || len(files) != 1 || files[0].Name != "x.xlsx" {
		t.Fatalf("%+v %v", files, err)
	}
	dir2 := t.TempDir()
	files, err = NewWriter(dir2, "empty", "明细", 0).Close()
	if err != nil || len(files) != 1 || files[0].Rows != 0 {
		t.Fatalf("空数据应生成仅表头的文件: %+v %v", files, err)
	}
	if _, err := os.Stat(files[0].Path); err != nil {
		t.Fatal(err)
	}
}
