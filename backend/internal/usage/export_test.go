package usage

import (
	"bytes"
	"testing"

	"cloudwatch/internal/newapi"

	"github.com/xuri/excelize/v2"
)

func TestFilterUsers(t *testing.T) {
	us := []UserRow{
		{ID: 1, Username: "Alice", Group: "vip", Quota: 10},
		{ID: 2, Username: "bob", Group: "default", Quota: 0},
		{ID: 3, Username: "carol", DisplayName: "Caro L", Group: "vip", Quota: 5},
	}
	if got := FilterUsers(us, "", "", true); len(got) != 3 {
		t.Fatal(len(got))
	}
	if got := FilterUsers(us, "", "", false); len(got) != 2 {
		t.Fatal("应隐藏零消费")
	}
	if got := FilterUsers(us, "vip", "", true); len(got) != 2 {
		t.Fatal("分组")
	}
	if got := FilterUsers(us, "", "ALICE", true); len(got) != 1 || got[0].ID != 1 {
		t.Fatal("关键字大小写不敏感")
	}
	if got := FilterUsers(us, "", "caro", true); len(got) != 1 {
		t.Fatal("显示名")
	}
	if got := FilterUsers(us, "", "2", true); len(got) != 1 || got[0].ID != 2 {
		t.Fatal("按 ID")
	}
}

func TestBuildDetail(t *testing.T) {
	p, _ := ParsePeriod("2026-10-01", "2026-10-02", "", mustNow())
	cur := Currency{500000, "$", 1, "USD"}
	d := BuildDetail("a", p, cur, []newapi.QuotaRow{
		{Username: "a", ModelName: "x", Quota: 500000, Count: 1, CreatedAt: p.StartTs + 10},
		{Username: "a", ModelName: "y", Quota: 1000000, Count: 2, CreatedAt: p.StartTs + 86400 + 10},
		{Username: "z", ModelName: "x", Quota: 5, CreatedAt: p.StartTs + 10},
	})
	if d.Totals.Amount != 3 || len(d.Daily) != 2 || d.Models[0].Model != "y" {
		t.Fatalf("%+v", d)
	}
}

func TestBuildWorkbook(t *testing.T) {
	p, _ := ParsePeriod("2026-09-30", "2026-10-01", "", mustNow())
	cur := Currency{500000, "$", 1, "USD"}
	a := NewUserAgg(newapi.User{ID: 1, Username: "a", Group: "vip"})
	a.AddRows([]newapi.QuotaRow{{Username: "a", ModelName: "m", Quota: 500000, Count: 1, TokenUsed: 9, CreatedAt: p.StartTs + 5}}, p)
	s := Assemble(p, cur, []*UserAgg{a}, 500000)
	buf, err := BuildWorkbook(s, ExportOpts{IncludeZero: true, Details: true, Rows: []newapi.LogItem{{ID: 1, Username: "a", Quota: 500000, CreatedAt: p.StartTs + 5}}, DetailTotal: 1, SourceURL: "http://x"})
	if err != nil {
		t.Fatal(err)
	}
	f, err := excelize.OpenReader(bytes.NewReader(buf.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"整体账单", "模型汇总", "每日汇总", "调用明细", "说明"}
	got := f.GetSheetList()
	if len(got) != len(want) {
		t.Fatalf("%v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("%v", got)
		}
	}
	if v, _ := f.GetCellValue("整体账单", "B2"); v != "a" {
		t.Fatalf("B2=%q", v)
	}
	if v, _ := f.GetCellValue("整体账单", "B3"); v != "合计" {
		t.Fatalf("B3=%q", v)
	}
}
