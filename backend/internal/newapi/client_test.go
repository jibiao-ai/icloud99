package newapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestDecodePage(t *testing.T) {
	items, total, ps := decodePage[User](json.RawMessage(`{"items":[{"id":1},{"id":2}],"total":9,"page_size":100}`))
	if len(items) != 2 || total != 9 || ps != 100 {
		t.Fatalf("%v %d %d", items, total, ps)
	}
	items, total, _ = decodePage[User](json.RawMessage(`[{"id":3}]`))
	if len(items) != 1 || total != 1 {
		t.Fatal("数组形式")
	}
}

// 假 New API：验证 Cookie + New-Api-User 头，401 后自动重登。
func TestGetRelogin(t *testing.T) {
	var logins, calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/user/login":
			atomic.AddInt32(&logins, 1)
			http.SetCookie(w, &http.Cookie{Name: "session", Value: "abc"})
			_, _ = w.Write([]byte(`{"success":true,"data":{"id":1,"role":100}}`))
		case "/api/log/stat":
			n := atomic.AddInt32(&calls, 1)
			if r.Header.Get("New-Api-User") != "1" || r.Header.Get("Cookie") != "session=abc" {
				w.WriteHeader(401)
				return
			}
			if n == 1 { // 第一次模拟会话过期
				w.WriteHeader(401)
				_, _ = w.Write([]byte(`{"success":false,"message":"未登录"}`))
				return
			}
			_, _ = w.Write([]byte(`{"success":true,"data":{"quota":12345}}`))
		}
	}))
	defer srv.Close()
	c := New()
	q, err := c.LogStat(context.Background(), Cfg{URL: srv.URL, Username: "a", Password: "b"}, 1, 2, "")
	if err != nil || q != 12345 {
		t.Fatalf("q=%d err=%v", q, err)
	}
	if atomic.LoadInt32(&logins) != 2 {
		t.Fatalf("应重登一次，logins=%d", logins)
	}
}

func TestLoginRejectNonAdmin(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"success":true,"data":{"id":5,"role":1}}`))
	}))
	defer srv.Close()
	_, _, err := New().TestConnection(context.Background(), Cfg{URL: srv.URL, Username: "u", Password: "p"})
	var ne *Error
	if err == nil || !asErr(err, &ne) || ne.Kind != KAuth {
		t.Fatalf("应拒绝非管理员: %v", err)
	}
}

func asErr(err error, t **Error) bool {
	e, ok := err.(*Error)
	if ok {
		*t = e
	}
	return ok
}

func TestMapPool(t *testing.T) {
	var sum int64
	MapPool([]int{1, 2, 3, 4, 5}, 2, func(_ int, x int) { atomic.AddInt64(&sum, int64(x)) })
	if sum != 15 {
		t.Fatal(sum)
	}
}
