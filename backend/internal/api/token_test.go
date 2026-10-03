package api

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestFetchJSONUpstreamStatus(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   string
		wantOK bool
		want   int
	}{
		{"正常JSON", 200, `{"code":true}`, true, 0},
		{"429空响应体", 429, ``, false, 429},
		{"502空响应体", 502, ``, false, 502},
		{"200空响应体", 200, ``, false, 200},
		{"401带JSON(业务错误应透传)", 401, `{"success":false,"message":"Invalid token"}`, true, 0},
		{"502非JSON页面", 502, `<html>bad gateway</html>`, false, 502},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(c.status)
				_, _ = w.Write([]byte(c.body))
			}))
			defer ts.Close()
			s := &Server{HTTP: ts.Client()}
			_, err := s.fetchJSON(context.Background(), ts.URL, "k", 3*time.Second)
			if c.wantOK {
				if err != nil {
					t.Fatalf("不应报错: %v", err)
				}
				return
			}
			var ue *upstreamError
			if !errors.As(err, &ue) || ue.Status != c.want {
				t.Fatalf("期望 upstreamError(%d)，实际 %v", c.want, err)
			}
			if err.Error() == "unexpected end of JSON input" {
				t.Fatal("不应再暴露原始 JSON 解析错误")
			}
		})
	}
}
