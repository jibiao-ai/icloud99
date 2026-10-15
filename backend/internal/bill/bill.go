// Package bill 生成“费用账单”PDF：元擎智算 logo、账期起止、账号信息、月度汇总与产品费用明细。
// 账单内容完全由 Doc 描述（可由用量统计自动生成，再由管理员修改/定制），渲染不依赖浏览器。
package bill

import (
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// Item 产品费用明细行。
type Item struct {
	Buyer   string  `json:"buyer"`   // 资源购买账号
	Owner   string  `json:"owner"`   // 资源归属账号
	Product string  `json:"product"` // 产品名称
	Goods   string  `json:"goods"`   // 商品名称
	Month   string  `json:"month"`   // 账单月份 YYYY-MM
	Amount  float64 `json:"amount"`  // 费用金额
}

// Month 月度费用汇总行（含该月起止日期）。
type Month struct {
	Month    string  `json:"month"`    // YYYY-MM
	Start    string  `json:"start"`    // 账期开始 YYYY-MM-DD
	End      string  `json:"end"`      // 账期截止 YYYY-MM-DD
	Total    float64 `json:"total"`    // 费用总额
	Discount float64 `json:"discount"` // 优惠/抵扣（>=0）
	Payable  float64 `json:"payable"`  // 应付金额 = 总额 - 优惠
}

// Doc 一份完整账单。
type Doc struct {
	Title      string  `json:"title"`      // 费用账单
	Subtitle   string  `json:"subtitle"`   // 账期内的服务费用明细
	Company    string  `json:"company"`    // 元擎智算
	Account    string  `json:"account"`    // 账号
	AccountID  string  `json:"accountId"`  // 账号 ID
	Currency   string  `json:"currency"`   // 货币符号 ¥
	CurrencyCN string  `json:"currencyCn"` // 人民币（CNY）
	ExportedBy string  `json:"exportedBy"` // 导出账号
	ExportedAt string  `json:"exportedAt"` // 导出时间
	Footer     string  `json:"footer"`     // 页脚备注
	Remark     string  `json:"remark"`     // 账单备注（可选，显示在明细后）
	Months     []Month `json:"months"`
	Items      []Item  `json:"items"`
}

var (
	monthRe = regexp.MustCompile(`^\d{4}-(0[1-9]|1[0-2])$`)
	dayRe   = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	cst     = time.FixedZone("CST", 8*3600)
)

// MonthRange 返回某月（YYYY-MM）的首日与末日。
func MonthRange(m string) (start, end string, err error) {
	t, err := time.ParseInLocation("2006-01", m, cst)
	if err != nil {
		return "", "", fmt.Errorf("月份格式应为 YYYY-MM")
	}
	return t.Format("2006-01-02"), t.AddDate(0, 1, -1).Format("2006-01-02"), nil
}

// Round2 保留两位小数（金额）。
func Round2(v float64) float64 { return math.Round(v*100) / 100 }

// Fmt 金额格式化（千分位，两位小数）。
func Fmt(v float64) string {
	neg := v < 0
	s := fmt.Sprintf("%.2f", math.Abs(v))
	ip, fp, _ := strings.Cut(s, ".")
	var b []byte
	for i, c := range []byte(ip) {
		if i > 0 && (len(ip)-i)%3 == 0 {
			b = append(b, ',')
		}
		b = append(b, c)
	}
	out := string(b) + "." + fp
	if neg {
		out = "-" + out
	}
	return out
}

// Limits 字段限制。
const (
	maxMonths = 24
	maxItems  = 200
)

func chk(name, v string, max int, required bool) string {
	n := utf8.RuneCountInString(strings.TrimSpace(v))
	if required && n == 0 {
		return name + "不能为空"
	}
	if n > max {
		return fmt.Sprintf("%s最长 %d 个字符", name, max)
	}
	return ""
}

// Normalize 校验并规范化账单；返回字段级错误（键为字段路径，如 months.0.discount）。
// 规范化：补全默认文案、按总额-优惠重算应付金额、金额保留两位。
func (d *Doc) Normalize() map[string]string {
	errs := map[string]string{}
	set := func(k, m string) {
		if m != "" {
			errs[k] = m
		}
	}
	d.Title = strings.TrimSpace(d.Title)
	if d.Title == "" {
		d.Title = "费用账单"
	}
	if strings.TrimSpace(d.Subtitle) == "" {
		d.Subtitle = "账期内的服务费用明细"
	}
	if strings.TrimSpace(d.Company) == "" {
		d.Company = "元擎智算"
	}
	if strings.TrimSpace(d.Currency) == "" {
		d.Currency = "¥"
	}
	if strings.TrimSpace(d.CurrencyCN) == "" {
		d.CurrencyCN = "人民币（CNY）"
	}
	set("title", chk("标题", d.Title, 30, true))
	set("subtitle", chk("副标题", d.Subtitle, 60, false))
	set("company", chk("公司名称", d.Company, 30, true))
	set("account", chk("账号", d.Account, 60, true))
	set("accountId", chk("账号 ID", d.AccountID, 40, false))
	set("currency", chk("货币符号", d.Currency, 4, true))
	set("currencyCn", chk("货币说明", d.CurrencyCN, 30, false))
	set("exportedBy", chk("导出账号", d.ExportedBy, 60, false))
	set("exportedAt", chk("导出时间", d.ExportedAt, 30, false))
	set("footer", chk("页脚", d.Footer, 80, false))
	set("remark", chk("备注", d.Remark, 300, false))
	if len(d.Months) == 0 {
		errs["months"] = "至少需要一个账单月份"
	}
	if len(d.Months) > maxMonths {
		errs["months"] = fmt.Sprintf("账单月份最多 %d 个", maxMonths)
		return errs
	}
	if len(d.Items) > maxItems {
		errs["items"] = fmt.Sprintf("费用明细最多 %d 行", maxItems)
		return errs
	}
	seen := map[string]bool{}
	for i, m := range d.Months {
		k := func(f string) string { return fmt.Sprintf("months.%d.%s", i, f) }
		if !monthRe.MatchString(m.Month) {
			errs[k("month")] = "月份格式应为 YYYY-MM"
			continue
		}
		if seen[m.Month] {
			errs[k("month")] = "账单月份重复"
		}
		seen[m.Month] = true
		if !dayRe.MatchString(m.Start) || !dayRe.MatchString(m.End) {
			errs[k("start")] = "日期格式应为 YYYY-MM-DD"
		} else if m.Start > m.End {
			errs[k("start")] = "开始日期不能晚于截止日期"
		}
		if m.Total < 0 || m.Total > 1e12 || math.IsNaN(m.Total) {
			errs[k("total")] = "费用总额应为非负数"
		}
		if m.Discount < 0 || m.Discount > m.Total {
			errs[k("discount")] = "优惠金额应在 0 ~ 费用总额之间"
		}
		d.Months[i].Total = Round2(m.Total)
		d.Months[i].Discount = Round2(m.Discount)
		d.Months[i].Payable = Round2(d.Months[i].Total - d.Months[i].Discount)
	}
	for i, it := range d.Items {
		k := func(f string) string { return fmt.Sprintf("items.%d.%s", i, f) }
		set(k("product"), chk("产品名称", it.Product, 40, true))
		set(k("goods"), chk("商品名称", it.Goods, 40, false))
		set(k("buyer"), chk("资源购买账号", it.Buyer, 60, false))
		set(k("owner"), chk("资源归属账号", it.Owner, 60, false))
		if !monthRe.MatchString(it.Month) {
			errs[k("month")] = "月份格式应为 YYYY-MM"
		}
		if it.Amount < 0 || it.Amount > 1e12 || math.IsNaN(it.Amount) {
			errs[k("amount")] = "费用金额应为非负数"
		}
		d.Items[i].Amount = Round2(it.Amount)
	}
	return errs
}

// Payable 本期应付金额合计。
func (d *Doc) Payable() float64 {
	var s float64
	for _, m := range d.Months {
		s += m.Payable
	}
	return Round2(s)
}

// Total 费用总额合计。
func (d *Doc) Total() float64 {
	var s float64
	for _, m := range d.Months {
		s += m.Total
	}
	return Round2(s)
}

// Discount 优惠合计。
func (d *Doc) Discount() float64 {
	var s float64
	for _, m := range d.Months {
		s += m.Discount
	}
	return Round2(s)
}

// ItemsTotal 明细合计。
func (d *Doc) ItemsTotal() float64 {
	var s float64
	for _, it := range d.Items {
		s += it.Amount
	}
	return Round2(s)
}

// PeriodLabel 账单月份标题：单月“2026 年 09 月”，多月“2026 年 07 月 ~ 2026 年 09 月”。
func (d *Doc) PeriodLabel() string {
	if len(d.Months) == 0 {
		return ""
	}
	f := func(m string) string { return m[:4] + " 年 " + m[5:] + " 月" }
	first, last := d.Months[0].Month, d.Months[0].Month
	for _, m := range d.Months {
		if m.Month < first {
			first = m.Month
		}
		if m.Month > last {
			last = m.Month
		}
	}
	if first == last {
		return f(first)
	}
	return f(first) + " ~ " + f(last)
}

// PeriodRange 整体账期起止日期。
func (d *Doc) PeriodRange() (string, string) {
	if len(d.Months) == 0 {
		return "", ""
	}
	s, e := d.Months[0].Start, d.Months[0].End
	for _, m := range d.Months {
		if m.Start < s {
			s = m.Start
		}
		if m.End > e {
			e = m.End
		}
	}
	return s, e
}

// MonthsPlain 账单月份纯文本：2026-09 或 2026-07、2026-08。
func (d *Doc) MonthsPlain() string {
	var ms []string
	for _, m := range d.Months {
		ms = append(ms, m.Month)
	}
	return strings.Join(ms, "、")
}
