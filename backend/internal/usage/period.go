// Package usage 实现全站用户账单统计（北京时间口径）与 Excel 导出。
package usage

import (
	"fmt"
	"regexp"
	"time"
)

// CST 东八区。
var CST = time.FixedZone("CST", 8*3600)

// MaxRangeDays 周期上限。
const MaxRangeDays = 400

var (
	dayRe   = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	monthRe = regexp.MustCompile(`^\d{4}-\d{2}$`)
)

// Period 统计周期（含首尾两天）。
type Period struct {
	Start   string `json:"start"`
	End     string `json:"end"`
	StartTs int64  `json:"startTs"`
	EndTs   int64  `json:"endTs"`
	Days    int    `json:"days"`
	Label   string `json:"label"`
}

// TsToDay unix 秒 → CST 日期。
func TsToDay(ts int64) string { return time.Unix(ts, 0).In(CST).Format("2006-01-02") }

// TsToDateTime unix 秒 → CST 日期时间。
func TsToDateTime(ts int64) string { return time.Unix(ts, 0).In(CST).Format("2006-01-02 15:04:05") }

func dayStart(day string) (int64, error) {
	t, err := time.ParseInLocation("2006-01-02", day, CST)
	if err != nil {
		return 0, fmt.Errorf("日期格式应为 YYYY-MM-DD")
	}
	return t.Unix(), nil
}

// ParsePeriod 解析 start/end（YYYY-MM-DD）或 month=YYYY-MM；缺省为本月至今。now 便于测试。
func ParsePeriod(start, end, month string, now time.Time) (Period, error) {
	today := now.In(CST).Format("2006-01-02")
	if start == "" && monthRe.MatchString(month) {
		t, err := time.ParseInLocation("2006-01", month, CST)
		if err != nil {
			return Period{}, fmt.Errorf("月份格式应为 YYYY-MM")
		}
		start = t.Format("2006-01-02")
		end = t.AddDate(0, 1, -1).Format("2006-01-02")
	}
	if start == "" {
		start = today[:8] + "01"
		end = today
	}
	if end == "" {
		end = today
	}
	if !dayRe.MatchString(start) || !dayRe.MatchString(end) {
		return Period{}, fmt.Errorf("日期格式应为 YYYY-MM-DD")
	}
	if start > end {
		start, end = end, start
	}
	s, err := dayStart(start)
	if err != nil {
		return Period{}, err
	}
	e, err := dayStart(end)
	if err != nil {
		return Period{}, err
	}
	endTs := e + 86400 - 1
	days := int((endTs + 1 - s) / 86400)
	if days > MaxRangeDays {
		return Period{}, fmt.Errorf("统计周期最长 %d 天", MaxRangeDays)
	}
	label := start + " ~ " + end
	if start == end {
		label = start
	}
	return Period{Start: start, End: end, StartTs: s, EndTs: endTs, Days: days, Label: label}, nil
}

// ListDays 周期内每天（CST）。
func (p Period) ListDays() []string {
	var out []string
	for ts := p.StartTs; ts <= p.EndTs; ts += 86400 {
		out = append(out, TsToDay(ts))
	}
	return out
}

// ListMonths 周期覆盖的自然月。
func (p Period) ListMonths() []string {
	s, _ := time.ParseInLocation("2006-01", p.Start[:7], CST)
	e, _ := time.ParseInLocation("2006-01", p.End[:7], CST)
	var out []string
	for t := s; !t.After(e); t = t.AddDate(0, 1, 0) {
		out = append(out, t.Format("2006-01"))
	}
	return out
}
