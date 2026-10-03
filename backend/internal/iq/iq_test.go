package iq

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestScoreSVG(t *testing.T) {
	pad := strings.Repeat(`<circle r="1"/>`, 20)
	cases := []struct {
		name, in, want string
		score          float64
	}{
		{"CSS动画", "<svg>" + pad + "<style>@keyframes spin{to{transform:rotate(360deg)}}.w{animation: spin 1s infinite}</style></svg>", "pass", 100},
		{"SMIL动画", "<svg>" + pad + `<animateTransform attributeName="transform" type="rotate" dur="1s"/></svg>`, "pass", 100},
		{"静态图", "<svg>" + pad + "</svg>", "works", 60},
		{"过短", "<svg></svg>", "degraded", 0},
		{"空", "", "degraded", 0},
	}
	for _, c := range cases {
		got, sc := ScoreSVG(c.in)
		if got != c.want || sc != c.score {
			t.Errorf("%s: got %s/%v want %s/%v", c.name, got, sc, c.want, c.score)
		}
	}
}

func chatServer(t *testing.T, h http.HandlerFunc) (*httptest.Server, string) {
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return srv, srv.URL
}

func TestChatErrors(t *testing.T) {
	_, url := chatServer(t, func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":"bad gateway"}`, 502)
	})
	_, _, _, _, err := Chat(context.Background(), &http.Client{}, url, "k", "m", "p", 10, time.Second)
	if err == nil || !strings.Contains(err.Error(), "HTTP 502") {
		t.Fatalf("%v", err)
	}
	_, slow := chatServer(t, func(w http.ResponseWriter, r *http.Request) { time.Sleep(300 * time.Millisecond) })
	_, _, _, _, err = Chat(context.Background(), &http.Client{}, slow, "k", "m", "p", 10, 50*time.Millisecond)
	if err == nil || !strings.Contains(err.Error(), "超时") {
		t.Fatalf("%v", err)
	}
}

func TestRun(t *testing.T) {
	svg := "<svg>" + strings.Repeat(`<circle r="1"/>`, 20) + "<style>@keyframes a{to{opacity:0}}</style></svg>"
	body, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": "好的 " + svg}}},
		"usage": map[string]any{"prompt_tokens": 5, "completion_tokens": 9}})
	_, url := chatServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer k" {
			http.Error(w, "no", 401)
			return
		}
		w.Write(body)
	})
	res := Run(context.Background(), &http.Client{}, url, "k", "m")
	if res.Err != nil || res.Result != "pass" || res.Score != 100 || !res.HasSVG || res.OutputTokens != 9 {
		t.Fatalf("%+v", res)
	}
	bad := Run(context.Background(), &http.Client{}, url, "wrong", "m")
	if bad.Err == nil || bad.Result != "degraded" || !strings.HasPrefix(bad.RawResponse, "Error: ") {
		t.Fatalf("%+v", bad)
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
