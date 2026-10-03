package iq

import (
	"strings"
	"testing"
	"time"
)

func TestScoreCandy(t *testing.T) {
	long := strings.Repeat("推理过程", 60) + "至少需要取出21个才能保证，最少为21"
	cases := []struct {
		name, in, want string
		score          float64
	}{
		{"完整推理", long, "pass", 100},
		{"只有答案", "答案是 21", "works", 70},
		{"答案错误", "答案是 20", "degraded", 0},
		{"数字包含21但非答案", "共 121 个、210 个", "degraded", 0},
		{"空", "", "degraded", 0},
		{"行首即21", "21", "works", 70},
	}
	for _, c := range cases {
		got, sc := ScoreCandy(c.in)
		if got != c.want || sc != c.score {
			t.Errorf("%s: got %s/%v want %s/%v", c.name, got, sc, c.want, c.score)
		}
	}
}

func TestCombine(t *testing.T) {
	cases := []struct {
		r      string
		s      float64
		svg    bool
		wr     string
		wscore float64
	}{
		{"degraded", 0, true, "works", 50},
		{"degraded", 0, false, "degraded", 0},
		{"pass", 100, true, "pass", 100},
		{"works", 70, true, "works", 70},
		{"works", 70, false, "works", 70},
	}
	for i, c := range cases {
		r, s := Combine(c.r, c.s, c.svg)
		if r != c.wr || s != c.wscore {
			t.Errorf("#%d got %s/%v", i, r, s)
		}
	}
}

func TestExtractSVG(t *testing.T) {
	in := "好的\n```svg\n<svg width=\"10\">\n<g/></SVG>\n```\n结束"
	if got := ExtractSVG(in); !strings.HasPrefix(got, "<svg") || !strings.HasSuffix(strings.ToLower(got), "</svg>") {
		t.Fatalf("%q", got)
	}
	if ExtractSVG("无") != "" {
		t.Fatal()
	}
}

func TestTierAt(t *testing.T) {
	cases := []struct {
		h    int
		want string
		ok   bool
	}{{1, "", false}, {2, "lite", true}, {3, "standard", true}, {4, "ultra", true}, {5, "lite", true}, {7, "ultra", true}, {8, "", false}}
	for _, c := range cases {
		got, ok := TierAt(c.h, 2, 8)
		if got != c.want || ok != c.ok {
			t.Errorf("h=%d got %q %v", c.h, got, ok)
		}
	}
}

func TestNextRun(t *testing.T) {
	loc := time.FixedZone("CST", 8*3600)
	now := time.Date(2026, 10, 3, 3, 30, 0, 0, loc)
	got, ok := NextRun(now, "lite", 2, 8, loc)
	if !ok || got.Hour() != 5 || got.Day() != 3 {
		t.Fatalf("%v", got)
	}
	got, _ = NextRun(now, "standard", 2, 8, loc) // 3 点已过 → 6 点
	if got.Hour() != 6 || got.Day() != 3 {
		t.Fatalf("%v", got)
	}
	now2 := time.Date(2026, 10, 3, 9, 0, 0, 0, loc)
	got, _ = NextRun(now2, "ultra", 2, 8, loc) // 当天窗口已过 → 次日 4 点
	if got.Hour() != 4 || got.Day() != 4 {
		t.Fatalf("%v", got)
	}
	if _, ok := NextRun(now, "lite", 5, 5, loc); ok {
		t.Fatal("空窗口应无下次")
	}
}
