package tokenq

import (
	"testing"
	"time"
)

var cst = time.FixedZone("CST", 8*3600)

func TestParseOther(t *testing.T) {
	if m := ParseOther(`{"model_ratio":2}`); m["model_ratio"].(float64) != 2 {
		t.Fatal(m)
	}
	if m := ParseOther(`not json`); len(m) != 0 {
		t.Fatal("非法 JSON 应返回空 map")
	}
	if m := ParseOther(""); m == nil || len(m) != 0 {
		t.Fatal("空串")
	}
}

func TestAggregate(t *testing.T) {
	now := time.Date(2026, 10, 3, 12, 0, 0, 0, cst)
	today := time.Date(2026, 10, 3, 1, 0, 0, 0, cst).Unix()
	yest := time.Date(2026, 10, 2, 23, 0, 0, 0, cst).Unix()
	logs := []Log{
		{ModelName: "a", Quota: 100, PromptTokens: 10, CompletionTokens: 5, UseTime: 3, CreatedAt: today},
		{ModelName: "a", Quota: 50, UseTime: 4, CreatedAt: yest},
		{ModelName: "b", Quota: 500, UseTime: 1, CreatedAt: today},
		{ModelName: "", Quota: 1, CreatedAt: today},
	}
	models, daily := Aggregate(logs, now, 3, cst)
	if models["a"].Count != 2 || models["a"].Quota != 150 || models["a"].AvgTime != 4 || models["a"].Prompt != 10 {
		t.Fatalf("%+v", models["a"])
	}
	if models["unknown"] == nil {
		t.Fatal("空模型名应归入 unknown")
	}
	if len(daily) != 3 || daily[0].Day != "2026-10-01" || daily[0].Count != 0 || daily[1].Quota != 50 || daily[2].Quota != 601 {
		t.Fatalf("%+v", daily)
	}
	if names := SortedModels(models); names[0] != "b" || names[1] != "a" {
		t.Fatalf("%v", names)
	}
}

func TestAggregateCrossMonth(t *testing.T) {
	now := time.Date(2026, 10, 1, 8, 0, 0, 0, cst)
	_, daily := Aggregate(nil, now, 3, cst)
	if daily[0].Day != "2026-09-29" || daily[2].Day != "2026-10-01" {
		t.Fatalf("%+v", daily)
	}
}
