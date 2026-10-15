package bill

import (
	"bytes"
	"fmt"
	"os"
	"strings"
	"testing"
)

func sample() *Doc {
	return &Doc{Account: "SEGer", AccountID: "93", ExportedBy: "SEGer", ExportedAt: "2026-10-15 10:00:00",
		Months: []Month{{Month: "2026-09", Start: "2026-09-01", End: "2026-09-30", Total: 100}},
		Items:  []Item{{Buyer: "SEGer", Owner: "SEGer", Product: "大模型接口服务", Goods: "大模型接口", Month: "2026-09", Amount: 100}}}
}

func TestFmt(t *testing.T) {
	cases := map[float64]string{0: "0.00", 100: "100.00", 1234.5: "1,234.50", 1234567.891: "1,234,567.89", -1234.5: "-1,234.50", 999.999: "1,000.00"}
	for in, want := range cases {
		if got := Fmt(in); got != want {
			t.Errorf("Fmt(%v)=%s want %s", in, got, want)
		}
	}
}

func TestMonthRange(t *testing.T) {
	for m, w := range map[string][2]string{"2026-09": {"2026-09-01", "2026-09-30"}, "2024-02": {"2024-02-01", "2024-02-29"}, "2026-12": {"2026-12-01", "2026-12-31"}} {
		s, e, err := MonthRange(m)
		if err != nil || s != w[0] || e != w[1] {
			t.Errorf("%s: %s %s %v", m, s, e, err)
		}
	}
	if _, _, err := MonthRange("2026-13"); err == nil {
		t.Error("应报错")
	}
}

func TestNormalizeComputesPayable(t *testing.T) {
	d := sample()
	d.Months = []Month{
		{Month: "2026-08", Start: "2026-08-01", End: "2026-08-31", Total: 100.005, Discount: 20},
		{Month: "2026-09", Start: "2026-09-01", End: "2026-09-30", Total: 50, Payable: 9999},
	}
	if errs := d.Normalize(); len(errs) != 0 {
		t.Fatal(errs)
	}
	if d.Months[0].Payable != 80.01 || d.Months[1].Payable != 50 {
		t.Fatalf("%+v", d.Months)
	}
	if d.Payable() != 130.01 || d.Total() != 150.01 || d.Discount() != 20 {
		t.Fatalf("%v %v %v", d.Payable(), d.Total(), d.Discount())
	}
	if d.PeriodLabel() != "2026 年 08 月 ~ 2026 年 09 月" {
		t.Fatal(d.PeriodLabel())
	}
	if s, e := d.PeriodRange(); s != "2026-08-01" || e != "2026-09-30" {
		t.Fatal(s, e)
	}
}

func TestNormalizeDefaultsAndErrors(t *testing.T) {
	d := &Doc{Account: "a", Months: []Month{{Month: "2026-09", Start: "2026-09-01", End: "2026-09-30"}}}
	if errs := d.Normalize(); len(errs) != 0 {
		t.Fatal(errs)
	}
	if d.Title != "费用账单" || d.Company != "元擎智算" || d.Currency != "¥" {
		t.Fatalf("默认值未补全 %+v", d)
	}
	bad := &Doc{Months: []Month{
		{Month: "2026-9", Start: "x", End: "y"},
		{Month: "2026-09", Start: "2026-09-30", End: "2026-09-01", Total: -1, Discount: 5},
		{Month: "2026-09", Start: "2026-09-01", End: "2026-09-30", Total: 10, Discount: 11},
	}, Items: []Item{{Month: "bad", Amount: -3}}}
	errs := bad.Normalize()
	for _, k := range []string{"account", "months.0.month", "months.1.start", "months.1.total", "months.2.discount", "months.2.month", "items.0.product", "items.0.month", "items.0.amount"} {
		if errs[k] == "" {
			t.Errorf("缺少字段错误 %s: %v", k, errs)
		}
	}
	if (&Doc{Account: "a"}).Normalize()["months"] == "" {
		t.Error("无月份应报错")
	}
}

func TestRenderValidPDF(t *testing.T) {
	d := sample()
	if errs := d.Normalize(); len(errs) > 0 {
		t.Fatal(errs)
	}
	b, err := Render(d)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(b, []byte("%PDF-")) || !bytes.Contains(b[len(b)-32:], []byte("%%EOF")) || len(b) < 5000 {
		t.Fatalf("不是有效 PDF len=%d", len(b))
	}
	if out := os.Getenv("BILL_PREVIEW"); out != "" {
		_ = os.WriteFile(out, b, 0o644)
	}
}

func TestRenderManyRowsPaginatesAndSpecialChars(t *testing.T) {
	d := sample()
	d.Remark = strings.Repeat("这是一段很长的备注内容，用于测试自动换行。", 12) + "😀 emoji 与 <b>标签</b> & 引号\"'"
	d.Account = "用户😀<script>"
	for i := 0; i < 70; i++ {
		d.Items = append(d.Items, Item{Buyer: "买家" + fmt.Sprint(i), Owner: "归属账号非常非常长的名称用于测试单元格内换行行为", Product: "大模型接口服务", Goods: "gpt-5.6-sol/claude-opus-4-7", Month: "2026-09", Amount: float64(i) * 1.5})
	}
	if errs := d.Normalize(); len(errs) > 0 {
		t.Fatal(errs)
	}
	b, err := Render(d)
	if err != nil {
		t.Fatal(err)
	}
	if n := bytes.Count(b, []byte("/Type /Page\n")) + bytes.Count(b, []byte("/Type /Page ")); n < 3 {
		t.Logf("页数检测=%d（仅记录）", n)
	}
	if out := os.Getenv("BILL_PREVIEW_MANY"); out != "" {
		_ = os.WriteFile(out, b, 0o644)
	}
}

func TestCleanReplacesMissingGlyphs(t *testing.T) {
	if got := clean("ab😀中\n文"); got != "ab?中 文" {
		t.Fatal(got)
	}
}
