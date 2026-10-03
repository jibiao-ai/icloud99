// Package tokenq 令牌用量查询：把 New API 令牌日志聚合成模型分布与每日趋势。
package tokenq

import (
	"encoding/json"
	"sort"
	"time"
)

// Log 一条令牌日志（只保留展示所需字段，other 解析为 map）。
type Log struct {
	ID               int64          `json:"id"`
	CreatedAt        int64          `json:"created_at"`
	ModelName        string         `json:"model_name"`
	Username         string         `json:"username"`
	TokenName        string         `json:"token_name"`
	Group            string         `json:"group"`
	PromptTokens     int64          `json:"prompt_tokens"`
	CompletionTokens int64          `json:"completion_tokens"`
	Quota            int64          `json:"quota"`
	UseTime          int64          `json:"use_time"`
	IsStream         bool           `json:"is_stream"`
	RequestID        string         `json:"request_id"`
	OtherRaw         string         `json:"other"`
	OtherParsed      map[string]any `json:"other_parsed"`
}

// ParseOther 解析 other 字段（JSON 字符串），失败返回空 map。
func ParseOther(raw string) map[string]any {
	m := map[string]any{}
	if raw == "" {
		return m
	}
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return map[string]any{}
	}
	return m
}

// ModelStat 模型聚合。
type ModelStat struct {
	Count      int   `json:"count"`
	Quota      int64 `json:"quota"`
	Prompt     int64 `json:"prompt"`
	Completion int64 `json:"completion"`
	AvgTime    int64 `json:"avgTime"`
}

// DayStat 每日聚合。
type DayStat struct {
	Day   string `json:"day"`
	Count int    `json:"count"`
	Quota int64  `json:"quota"`
}

// Aggregate 汇总模型分布，以及最近 days 天（含今天，CST）逐日趋势，缺失日补 0。
func Aggregate(logs []Log, now time.Time, days int, loc *time.Location) (map[string]*ModelStat, []DayStat) {
	models := map[string]*ModelStat{}
	sumTime := map[string]int64{}
	byDay := map[string]*DayStat{}
	for _, l := range logs {
		name := l.ModelName
		if name == "" {
			name = "unknown"
		}
		m := models[name]
		if m == nil {
			m = &ModelStat{}
			models[name] = m
		}
		m.Count++
		m.Quota += l.Quota
		m.Prompt += l.PromptTokens
		m.Completion += l.CompletionTokens
		sumTime[name] += l.UseTime
		d := time.Unix(l.CreatedAt, 0).In(loc).Format("2006-01-02")
		ds := byDay[d]
		if ds == nil {
			ds = &DayStat{Day: d}
			byDay[d] = ds
		}
		ds.Count++
		ds.Quota += l.Quota
	}
	for k, m := range models {
		if m.Count > 0 {
			m.AvgTime = int64(float64(sumTime[k])/float64(m.Count) + 0.5)
		}
	}
	out := make([]DayStat, 0, days)
	n := now.In(loc)
	for i := days - 1; i >= 0; i-- {
		d := time.Date(n.Year(), n.Month(), n.Day()-i, 0, 0, 0, 0, loc).Format("2006-01-02")
		if ds := byDay[d]; ds != nil {
			out = append(out, *ds)
		} else {
			out = append(out, DayStat{Day: d})
		}
	}
	return models, out
}

// SortedModels 按消费倒序返回模型名。
func SortedModels(m map[string]*ModelStat) []string {
	names := make([]string, 0, len(m))
	for k := range m {
		names = append(names, k)
	}
	sort.Slice(names, func(i, j int) bool {
		if m[names[i]].Quota != m[names[j]].Quota {
			return m[names[i]].Quota > m[names[j]].Quota
		}
		return names[i] < names[j]
	})
	return names
}
