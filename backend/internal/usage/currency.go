package usage

import (
	"math"
	"strings"
)

// Currency 货币显示（跟随 New API 站点设置）。
type Currency struct {
	QuotaPerUnit float64 `json:"quotaPerUnit"`
	Symbol       string  `json:"symbol"`
	Rate         float64 `json:"rate"`
	Code         string  `json:"code"`
}

func num(m map[string]any, k string) float64 {
	switch v := m[k].(type) {
	case float64:
		return v
	case int:
		return float64(v)
	}
	return 0
}

func str(m map[string]any, k string) string {
	if s, ok := m[k].(string); ok {
		return s
	}
	return ""
}

// CurrencyFromStatus 由 /api/status 的 data 推导货币。
func CurrencyFromStatus(st map[string]any) Currency {
	qpu := num(st, "quota_per_unit")
	if qpu <= 0 {
		qpu = 500000
	}
	typ := strings.ToUpper(str(st, "quota_display_type"))
	if typ == "" {
		typ = "USD"
	}
	switch typ {
	case "CNY":
		r := num(st, "usd_exchange_rate")
		if r <= 0 {
			r = 7.3
		}
		return Currency{qpu, "¥", r, "CNY"}
	case "CUSTOM":
		r := num(st, "custom_currency_exchange_rate")
		if r <= 0 {
			r = 1
		}
		sym := str(st, "custom_currency_symbol")
		if sym == "" {
			sym = "¤"
		}
		return Currency{qpu, sym, r, "CUSTOM"}
	}
	return Currency{qpu, "$", 1, "USD"}
}

// Money quota → 金额，保留 6 位。
func (c Currency) Money(quota float64) float64 {
	return math.Round(quota/c.QuotaPerUnit*c.Rate*1e6) / 1e6
}
