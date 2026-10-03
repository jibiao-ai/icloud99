package monitor

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestGrade(t *testing.T) {
	cases := []struct {
		name       string
		resp, ping int
		ok         bool
		want       Speed
	}{
		{"极速", 3000, 200, true, SpeedFast},
		{"边界极速", 25000, 1500, true, SpeedFast},
		{"较慢", 30000, 200, true, SpeedSlow},
		{"ping偏高较慢", 3000, 2000, true, SpeedSlow},
		{"响应拥堵", 50000, 100, true, SpeedJam},
		{"ping拥堵", 1000, 3000, true, SpeedJam},
		{"失败未知", 1000, 100, false, SpeedUnknown},
		{"无延迟未知", 0, 100, true, SpeedUnknown},
	}
	for _, c := range cases {
		if got := Grade(c.resp, c.ping, c.ok); got != c.want {
			t.Errorf("%s: got %s want %s", c.name, got, c.want)
		}
	}
}

func TestRate(t *testing.T) {
	if (RangeStats{}).Rate() != -1 {
		t.Fatal("无数据应为 -1")
	}
	if got := (RangeStats{Total: 3, Success: 2}).Rate(); got != 66.67 {
		t.Fatal(got)
	}
	if got := (RangeStats{Total: 10, Success: 10}).Rate(); got != 100 {
		t.Fatal(got)
	}
}

func TestProbe(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer sk-x" {
			w.WriteHeader(401)
			return
		}
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()
	ok := Probe(context.Background(), srv.Client(), srv.URL, "sk-x", "m")
	if !ok.Success || ok.PingMs < 0 {
		t.Fatalf("%+v", ok)
	}
	bad := Probe(context.Background(), srv.Client(), srv.URL, "wrong", "m")
	if bad.Success || bad.Err != "HTTP 401" {
		t.Fatalf("%+v", bad)
	}
	down := Probe(context.Background(), &http.Client{Timeout: time.Second}, "http://127.0.0.1:1", "k", "m")
	if down.Success || down.PingMs != -1 {
		t.Fatalf("%+v", down)
	}
}

func TestShouldRun(t *testing.T) {
	now := time.Now()
	if !ShouldRun(time.Time{}, now, time.Hour) || ShouldRun(now.Add(-30*time.Minute), now, time.Hour) || !ShouldRun(now.Add(-61*time.Minute), now, time.Hour) {
		t.Fatal("ShouldRun")
	}
}
