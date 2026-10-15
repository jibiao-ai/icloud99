package api

import (
	"errors"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"icloud99/internal/auth"
	"icloud99/internal/bill"
	"icloud99/internal/httpx"
	"icloud99/internal/usage"
)

const (
	billProduct = "大模型接口服务"
	billGoods   = "大模型接口"
)

// billMonths 解析 months=2026-08,2026-09（最多 12 个，去重排序）。
func billMonths(raw string) ([]string, error) {
	seen := map[string]bool{}
	var out []string
	for _, m := range strings.Split(raw, ",") {
		m = strings.TrimSpace(m)
		if m == "" || seen[m] {
			continue
		}
		if _, _, err := bill.MonthRange(m); err != nil {
			return nil, httpx.Invalid("账单月份格式应为 YYYY-MM", map[string]string{"months": "月份格式应为 YYYY-MM"})
		}
		seen[m] = true
		out = append(out, m)
	}
	if len(out) == 0 {
		return nil, httpx.Invalid("请选择账单月份", map[string]string{"months": "请至少选择一个月份"})
	}
	if len(out) > 12 {
		return nil, httpx.Invalid("一次最多选择 12 个月", map[string]string{"months": "一次最多选择 12 个月"})
	}
	sort.Strings(out)
	return out, nil
}

// billAccounts 列出可出账的账号（有用量的用户，按金额倒序）；用于页面下拉。
func (s *Server) billAccounts(w http.ResponseWriter, r *http.Request, _ *auth.Principal) error {
	cfg, err := s.newapiCfg(r)
	if err != nil {
		return err
	}
	users, err := s.NewAPI.ListAllUsers(r.Context(), cfg)
	if err != nil {
		return upstream(err)
	}
	type acc struct {
		ID          int64  `json:"id"`
		Username    string `json:"username"`
		DisplayName string `json:"displayName"`
		Group       string `json:"group"`
	}
	list := make([]acc, 0, len(users))
	for _, u := range users {
		list = append(list, acc{u.ID, u.Username, u.DisplayName, u.Group})
	}
	sort.SliceStable(list, func(i, j int) bool { return list[i].Username < list[j].Username })
	cur := s.Usage.Currency(r.Context(), cfg)
	httpx.OK(w, map[string]any{"accounts": list, "currency": cur})
	return nil
}

// billDraft 按账号 + 月份由用量统计生成账单草稿（可再由管理员修改）。
func (s *Server) billDraft(w http.ResponseWriter, r *http.Request, p *auth.Principal) error {
	cfg, err := s.newapiCfg(r)
	if err != nil {
		return err
	}
	q := r.URL.Query()
	account := strings.TrimSpace(q.Get("account"))
	if account == "" {
		return httpx.Invalid("请选择账号", map[string]string{"account": "请选择账号"})
	}
	months, err := billMonths(q.Get("months"))
	if err != nil {
		return err
	}
	users, err := s.NewAPI.ListAllUsers(r.Context(), cfg)
	if err != nil {
		return upstream(err)
	}
	var uid int64
	found := false
	for _, u := range users {
		if u.Username == account {
			uid, found = u.ID, true
		}
	}
	if !found {
		return httpx.Invalid("账号不存在", map[string]string{"account": "未找到该账号"})
	}
	cur := s.Usage.Currency(r.Context(), cfg)
	now := time.Now().In(usage.CST)
	doc := bill.Doc{
		Account: account, AccountID: itoa(uid), Currency: cur.Symbol, CurrencyCN: currencyName(cur),
		ExportedBy: p.Username, ExportedAt: now.Format("2006-01-02 15:04:05"),
	}
	for _, m := range months {
		st, en, _ := bill.MonthRange(m)
		// 当月未结束时，截止日期取今天，避免展示尚未发生的日期
		if today := now.Format("2006-01-02"); m == today[:7] && today < en {
			en = today
		}
		per, perr := usage.ParsePeriod(st, en, "", time.Now())
		if perr != nil {
			return httpx.Invalid(perr.Error(), map[string]string{"months": perr.Error()})
		}
		rows, qerr := s.NewAPI.QuotaData(r.Context(), cfg, per.StartTs, per.EndTs, account)
		if qerr != nil {
			return upstream(qerr)
		}
		d := usage.BuildDetail(account, per, cur, rows)
		total := bill.Round2(d.Totals.Amount)
		doc.Months = append(doc.Months, bill.Month{Month: m, Start: st, End: en, Total: total, Payable: total})
		doc.Items = append(doc.Items, bill.Item{Buyer: account, Owner: account, Product: billProduct, Goods: billGoods, Month: m, Amount: total})
	}
	doc.Normalize()
	httpx.OK(w, doc)
	return nil
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }

func currencyName(c usage.Currency) string {
	switch c.Code {
	case "CNY":
		return "人民币（CNY）"
	case "USD":
		return "美元（USD）"
	}
	return "自定义货币（" + c.Symbol + "）"
}

// billExport 按（可能被管理员修改过的）账单内容渲染并下载 PDF。
func (s *Server) billExport(w http.ResponseWriter, r *http.Request, p *auth.Principal) error {
	t0 := time.Now()
	var doc bill.Doc
	if err := httpx.Decode(r, &doc); err != nil {
		return err
	}
	if errs := doc.Normalize(); len(errs) > 0 {
		return httpx.Invalid("账单内容校验失败", errs)
	}
	if strings.TrimSpace(doc.ExportedBy) == "" {
		doc.ExportedBy = p.Username
	}
	if strings.TrimSpace(doc.ExportedAt) == "" {
		doc.ExportedAt = time.Now().In(usage.CST).Format("2006-01-02 15:04:05")
	}
	detail := map[string]any{"account": doc.Account, "months": doc.MonthsPlain(), "payable": doc.Payable(), "items": len(doc.Items)}
	link := "/usage?tab=bill"
	b, err := bill.Render(&doc)
	if err != nil {
		s.rec(r, p, "bill", "export", doc.Account, link, detail, err, t0)
		return errors.New("账单 PDF 生成失败，请稍后重试")
	}
	s.rec(r, p, "bill", "export", doc.Account, link, detail, nil, t0)
	name := "费用账单_" + doc.Account + "_" + strings.ReplaceAll(doc.MonthsPlain(), "、", "_") + ".pdf"
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", "attachment; filename=\"bill.pdf\"; filename*=UTF-8''"+url.PathEscape(name))
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(b)
	return nil
}
