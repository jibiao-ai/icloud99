package usage

import (
	"bytes"
	"fmt"
	"math"
	"strings"

	"cloudwatch/internal/newapi"

	"github.com/xuri/excelize/v2"
)

// ExportOpts 导出选项（= 页面当前筛选条件）。
type ExportOpts struct {
	IncludeZero bool
	Details     bool
	MaxRows     int
	Group       string
	Keyword     string
	Rows        []newapi.LogItem
	DetailTotal int
	SourceURL   string
}

const amountFmt = "#,##0.000000"

// FilterUsers 按页面筛选条件过滤用户（导出 = 当前筛选结果）。
func FilterUsers(users []UserRow, group, keyword string, includeZero bool) []UserRow {
	var out []UserRow
	kw := strings.ToLower(keyword)
	for _, u := range users {
		if !includeZero && u.Quota <= 0 {
			continue
		}
		if group != "" && u.Group != group {
			continue
		}
		if kw != "" && !strings.Contains(strings.ToLower(u.Username), kw) && !strings.Contains(strings.ToLower(u.DisplayName), kw) && fmt.Sprint(u.ID) != kw {
			continue
		}
		out = append(out, u)
	}
	return out
}

func col(n int) string { s, _ := excelize.ColumnNumberToName(n); return s }

// BuildWorkbook 生成 xlsx：整体账单 / 模型汇总 / 每日汇总 / 调用明细(可选) / 说明。
func BuildWorkbook(s Summary, o ExportOpts) (*bytes.Buffer, error) {
	f := excelize.NewFile()
	cur := s.Currency
	hdr, _ := f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Bold: true, Color: "FFFFFF"},
		Fill:      excelize.Fill{Type: "pattern", Color: []string{"513CC8"}, Pattern: 1},
		Alignment: &excelize.Alignment{Horizontal: "center", Vertical: "center"},
	})
	money, _ := f.NewStyle(&excelize.Style{CustomNumFmt: strPtr(amountFmt)})
	pct, _ := f.NewStyle(&excelize.Style{NumFmt: 10})
	intFmt, _ := f.NewStyle(&excelize.Style{NumFmt: 3})
	bold, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true}})

	writeHead := func(sheet string, heads []string) {
		for i, h := range heads {
			c := col(i+1) + "1"
			_ = f.SetCellValue(sheet, c, h)
			_ = f.SetCellStyle(sheet, c, c, hdr)
		}
		_ = f.SetPanes(sheet, &excelize.Panes{Freeze: true, YSplit: 1, TopLeftCell: "A2", ActivePane: "bottomLeft"})
	}

	// Sheet1 整体账单
	s1 := "整体账单"
	_ = f.SetSheetName("Sheet1", s1)
	heads := []string{"序号", "用户", "显示名", "用户团队"}
	for _, m := range s.Months {
		heads = append(heads, fmt.Sprintf("%s年%s月消费金额(%s)", m[:4], m[5:], cur.Symbol))
	}
	base := len(heads)
	heads = append(heads, fmt.Sprintf("合计费用(%s)", cur.Symbol), "占比", "调用次数", "Tokens", fmt.Sprintf("当前余额(%s)", cur.Symbol), "最近调用")
	writeHead(s1, heads)
	users := FilterUsers(s.Users, o.Group, o.Keyword, o.IncludeZero)
	for i, u := range users {
		r := i + 2
		vals := []any{i + 1, u.Username, u.DisplayName, u.Group}
		for _, m := range s.Months {
			vals = append(vals, u.MonthAmounts[m])
		}
		last := ""
		if u.LastAt > 0 {
			last = TsToDateTime(u.LastAt)
		}
		vals = append(vals, u.Amount, u.Share, u.Count, u.Tokens, u.Balance, last)
		for c, v := range vals {
			cell := col(c+1) + fmt.Sprint(r)
			_ = f.SetCellValue(s1, cell, v)
			switch {
			case c >= 4 && c < base, c == base, c == base+4:
				_ = f.SetCellStyle(s1, cell, cell, money)
			case c == base+1:
				_ = f.SetCellStyle(s1, cell, cell, pct)
			case c == base+2, c == base+3:
				_ = f.SetCellStyle(s1, cell, cell, intFmt)
			}
		}
	}
	tr := len(users) + 2
	_ = f.SetCellValue(s1, "B"+fmt.Sprint(tr), "合计")
	var tAmt, tCnt, tTok float64
	for _, u := range users {
		tAmt += u.Amount
		tCnt += u.Count
		tTok += u.Tokens
	}
	for mi, m := range s.Months {
		var t float64
		for _, u := range users {
			t += u.MonthAmounts[m]
		}
		cell := col(5+mi) + fmt.Sprint(tr)
		_ = f.SetCellValue(s1, cell, round6(t))
		_ = f.SetCellStyle(s1, cell, cell, money)
	}
	_ = f.SetCellValue(s1, col(base+1)+fmt.Sprint(tr), round6(tAmt))
	_ = f.SetCellValue(s1, col(base+3)+fmt.Sprint(tr), tCnt)
	_ = f.SetCellValue(s1, col(base+4)+fmt.Sprint(tr), tTok)
	_ = f.SetCellStyle(s1, "A"+fmt.Sprint(tr), col(len(heads))+fmt.Sprint(tr), bold)
	_ = f.SetColWidth(s1, "A", "A", 7)
	_ = f.SetColWidth(s1, "B", col(len(heads)), 18)

	// Sheet2 模型汇总
	s2 := "模型汇总"
	_, _ = f.NewSheet(s2)
	writeHead(s2, []string{"模型", fmt.Sprintf("消费金额(%s)", cur.Symbol), "调用次数", "Tokens", "使用人数"})
	for i, m := range s.Models {
		r := fmt.Sprint(i + 2)
		_ = f.SetCellValue(s2, "A"+r, m.Model)
		_ = f.SetCellValue(s2, "B"+r, m.Amount)
		_ = f.SetCellStyle(s2, "B"+r, "B"+r, money)
		_ = f.SetCellValue(s2, "C"+r, m.Count)
		_ = f.SetCellValue(s2, "D"+r, m.Tokens)
		_ = f.SetCellValue(s2, "E"+r, m.Users)
	}
	_ = f.SetColWidth(s2, "A", "A", 30)
	_ = f.SetColWidth(s2, "B", "E", 16)

	// Sheet3 每日汇总
	s3 := "每日汇总"
	_, _ = f.NewSheet(s3)
	writeHead(s3, []string{"日期", fmt.Sprintf("消费金额(%s)", cur.Symbol), "quota"})
	for i, d := range s.Daily {
		r := fmt.Sprint(i + 2)
		_ = f.SetCellValue(s3, "A"+r, d.Day)
		_ = f.SetCellValue(s3, "B"+r, d.Amount)
		_ = f.SetCellStyle(s3, "B"+r, "B"+r, money)
		_ = f.SetCellValue(s3, "C"+r, d.Quota)
	}
	_ = f.SetColWidth(s3, "A", "C", 18)

	detailNote := "未包含（导出时勾选「包含调用明细」）"
	if o.Details {
		s4 := "调用明细"
		_, _ = f.NewSheet(s4)
		writeHead(s4, []string{"time", "log_id", "user_id", "username", "token_name", "group", "model", "prompt_tokens",
			"completion_tokens", "total_tokens", "quota", fmt.Sprintf("cost(%s)", cur.Symbol), "channel_name", "request_id", "use_time", "is_stream", "ip"})
		for i, x := range o.Rows {
			r := fmt.Sprint(i + 2)
			vals := []any{TsToDateTime(x.CreatedAt), x.ID, x.UserID, x.Username, x.TokenName, x.Group, x.ModelName, x.PromptTokens,
				x.CompletionTokens, x.PromptTokens + x.CompletionTokens, x.Quota, cur.Money(float64(x.Quota)), x.ChannelName, x.RequestID, x.UseTime, x.IsStream, x.IP}
			for c, v := range vals {
				_ = f.SetCellValue(s4, col(c+1)+r, v)
			}
		}
		_ = f.SetColWidth(s4, "A", "Q", 16)
		if len(o.Rows) < o.DetailTotal {
			detailNote = fmt.Sprintf("已包含（共 %d 条，仅导出最新 %d 条）", o.DetailTotal, len(o.Rows))
		} else {
			detailNote = fmt.Sprintf("已包含（共 %d 条）", o.DetailTotal)
		}
	}

	// 说明
	s0 := "说明"
	_, _ = f.NewSheet(s0)
	writeHead(s0, []string{"项目", "内容"})
	recon := "未校验"
	if s.Totals.Reconciled != nil {
		if *s.Totals.Reconciled {
			recon = fmt.Sprintf("一致（/api/log/stat = %s%v）", cur.Symbol, *s.Totals.SiteAmount)
		} else {
			recon = fmt.Sprintf("存在差异（/api/log/stat = %s%v）", cur.Symbol, *s.Totals.SiteAmount)
		}
	}
	filter := "无"
	if o.Group != "" || o.Keyword != "" || !o.IncludeZero {
		filter = fmt.Sprintf("分组=%q 关键字=%q 含零消费=%v", o.Group, o.Keyword, o.IncludeZero)
	}
	notes := [][2]string{
		{"统计周期", s.Period.Label + "（北京时间，含首尾两天）"},
		{"数据来源", o.SourceURL + "（New API 管理接口 /api/data + /api/log/stat 对账）"},
		{"筛选条件", filter},
		{"全站合计", fmt.Sprintf("%s%v", cur.Symbol, s.Totals.Amount)},
		{"后台口径校验", recon},
		{"注册用户 / 有消费用户", fmt.Sprintf("%d / %d", s.Totals.RegisteredUsers, s.Totals.ActiveUsers)},
		{"金额换算", fmt.Sprintf("1 %s = %v quota × %v", cur.Code, cur.QuotaPerUnit, cur.Rate)},
		{"调用明细", detailNote},
	}
	for i, n := range notes {
		r := fmt.Sprint(i + 2)
		_ = f.SetCellValue(s0, "A"+r, n[0])
		_ = f.SetCellValue(s0, "B"+r, n[1])
	}
	_ = f.SetColWidth(s0, "A", "A", 24)
	_ = f.SetColWidth(s0, "B", "B", 80)

	buf := &bytes.Buffer{}
	if err := f.Write(buf); err != nil {
		return nil, err
	}
	return buf, nil
}

func strPtr(s string) *string { return &s }

func round6(n float64) float64 { return math.Round(n*1e6) / 1e6 }
