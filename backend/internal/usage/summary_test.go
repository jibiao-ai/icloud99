package usage

import (
	"testing"
	"time"

	"icloud99/internal/newapi"
)

func TestParsePeriod(t *testing.T) {
	now := time.Date(2026, 10, 3, 12, 0, 0, 0, CST)
	cases := []struct {
		name, s, e, m string
		wantStart     string
		wantEnd       string
		days          int
		err           bool
	}{
		{"默认本月至今", "", "", "", "2026-10-01", "2026-10-03", 3, false},
		{"month", "", "", "2026-02", "2026-02-01", "2026-02-28", 28, false},
		{"闰年2月", "", "", "2028-02", "2028-02-01", "2028-02-29", 29, false},
		{"反序自动交换", "2026-10-05", "2026-10-01", "", "2026-10-01", "2026-10-05", 5, false},
		{"单日", "2026-10-01", "2026-10-01", "", "2026-10-01", "2026-10-01", 1, false},
		{"超长", "2025-01-01", "2026-10-01", "", "", "", 0, true},
		{"格式错", "2026/10/01", "2026-10-02", "", "", "", 0, true},
		{"非法日期", "2026-13-40", "2026-13-41", "", "", "", 0, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p, err := ParsePeriod(c.s, c.e, c.m, now)
			if (err != nil) != c.err {
				t.Fatalf("err=%v", err)
			}
			if c.err {
				return
			}
			if p.Start != c.wantStart || p.End != c.wantEnd || p.Days != c.days {
				t.Fatalf("%+v", p)
			}
			if p.EndTs-p.StartTs+1 != int64(c.days)*86400 {
				t.Fatalf("ts 跨度错误")
			}
		})
	}
}

func TestListMonthsAndDays(t *testing.T) {
	p, _ := ParsePeriod("2026-08-30", "2026-10-02", "", time.Now())
	if m := p.ListMonths(); len(m) != 3 || m[0] != "2026-08" || m[2] != "2026-10" {
		t.Fatalf("%v", m)
	}
	if d := p.ListDays(); len(d) != p.Days || d[0] != "2026-08-30" || d[len(d)-1] != "2026-10-02" {
		t.Fatalf("%v", d)
	}
}

func TestCST日界(t *testing.T) {
	p, _ := ParsePeriod("2026-10-01", "2026-10-01", "", time.Now())
	// 北京时间 10-01 00:00 = UTC 09-30 16:00
	if TsToDay(p.StartTs) != "2026-10-01" || TsToDay(p.StartTs-1) != "2026-09-30" || TsToDay(p.EndTs) != "2026-10-01" {
		t.Fatal("日界不正确")
	}
}

func TestCurrency(t *testing.T) {
	c := CurrencyFromStatus(map[string]any{"quota_per_unit": 500000.0, "quota_display_type": "CNY", "usd_exchange_rate": 7.0})
	if c.Symbol != "¥" || c.Money(500000) != 7 {
		t.Fatalf("%+v", c)
	}
	d := CurrencyFromStatus(map[string]any{})
	if d.Code != "USD" || d.QuotaPerUnit != 500000 || d.Money(250000) != 0.5 {
		t.Fatalf("%+v", d)
	}
	x := CurrencyFromStatus(map[string]any{"quota_display_type": "CUSTOM", "custom_currency_symbol": "T", "custom_currency_exchange_rate": 2.0})
	if x.Symbol != "T" || x.Rate != 2 {
		t.Fatalf("%+v", x)
	}
}

func TestReconciled(t *testing.T) {
	if !Reconciled(1_000_000, 1_000_900) || Reconciled(1_000_000, 1_002_000) {
		t.Fatal("0.1% 容差")
	}
	if !Reconciled(100, 900) || Reconciled(100, 1200) {
		t.Fatal("小额最低容差 1000")
	}
}

func TestAssemble(t *testing.T) {
	p, _ := ParsePeriod("2026-09-30", "2026-10-01", "", time.Now())
	d1 := p.StartTs + 3600       // 09-30
	d2 := p.StartTs + 86400 + 60 // 10-01
	a := NewUserAgg(newapi.User{ID: 1, Username: "a", Group: "vip", Quota: 500000})
	a.AddRows([]newapi.QuotaRow{
		{Username: "a", ModelName: "m1", Quota: 500000, Count: 2, TokenUsed: 100, CreatedAt: d1},
		{Username: "a", ModelName: "m2", Quota: 250000, Count: 1, TokenUsed: 50, CreatedAt: d2},
		{Username: "b", ModelName: "m1", Quota: 999, CreatedAt: d1},       // 他人
		{Username: "a", ModelName: "m1", Quota: 999, CreatedAt: 1},        // 周期外
		{Username: "a", ModelName: "", Quota: 0, Count: 1, CreatedAt: d1}, // 空模型名
	}, p)
	b := NewUserAgg(newapi.User{ID: 2, Username: "b"})
	cur := Currency{500000, "$", 1, "USD"}
	s := Assemble(p, cur, []*UserAgg{b, a}, 750000)

	if s.Totals.Quota != 750000 || s.Totals.Amount != 1.5 || s.Totals.Count != 4 {
		t.Fatalf("%+v", s.Totals)
	}
	if s.Totals.ActiveUsers != 1 || s.Totals.RegisteredUsers != 2 || s.Totals.Reconciled == nil || !*s.Totals.Reconciled {
		t.Fatalf("%+v", s.Totals)
	}
	if s.Users[0].Username != "a" || s.Users[0].Share != 1 {
		t.Fatalf("排序/占比: %+v", s.Users[0])
	}
	if s.Users[0].MonthAmounts["2026-09"] != 1 || s.Users[0].MonthAmounts["2026-10"] != 0.5 {
		t.Fatalf("按月: %v", s.Users[0].MonthAmounts)
	}
	if len(s.Daily) != 2 || s.Daily[0].Amount != 1 || s.Daily[1].Amount != 0.5 {
		t.Fatalf("按日: %+v", s.Daily)
	}
	if s.Models[0].Model != "m1" || len(s.Groups) != 1 || s.Groups[0].Group != "vip" {
		t.Fatalf("%+v %+v", s.Models, s.Groups)
	}
	// 未对账
	s2 := Assemble(p, cur, []*UserAgg{a}, -1)
	if s2.Totals.Reconciled != nil || s2.Totals.SiteAmount != nil {
		t.Fatal("siteQuota<0 时不应对账")
	}
}

func mustNow() time.Time { return time.Date(2026, 10, 3, 0, 0, 0, 0, CST) }
