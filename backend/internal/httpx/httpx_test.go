package httpx

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestParseListQuery(t *testing.T) {
	r := httptest.NewRequest("GET", "/x?page=3&pageSize=500&sortOrder=ASC&keyword=%20ab%20", nil)
	q := ParseListQuery(r, 10, 100)
	if q.Page != 3 || q.PageSize != 100 || q.SortOrder != "asc" || q.Keyword != "ab" || q.Offset() != 200 {
		t.Fatalf("%+v", q)
	}
	q = ParseListQuery(httptest.NewRequest("GET", "/x?page=-1&pageSize=abc", nil), 10, 100)
	if q.Page != 1 || q.PageSize != 10 || q.SortOrder != "desc" {
		t.Fatalf("%+v", q)
	}
}

func TestPaginate(t *testing.T) {
	rows := []int{1, 2, 3, 4, 5, 6, 7}
	cases := []struct {
		page, size int
		want       []int
		wantPage   int
	}{
		{1, 3, []int{1, 2, 3}, 1},
		{3, 3, []int{7}, 3},
		{9, 3, []int{7}, 3}, // 越界回落最后一页
		{1, 10, rows, 1},
	}
	for _, c := range cases {
		got, pg := Paginate(rows, ListQuery{Page: c.page, PageSize: c.size})
		if len(got) != len(c.want) || pg != c.wantPage {
			t.Errorf("%+v got %v page %d", c, got, pg)
		}
	}
	if got, pg := Paginate([]int{}, ListQuery{Page: 5, PageSize: 10}); len(got) != 0 || pg != 1 {
		t.Fatal("空列表")
	}
}

func TestEnvelope(t *testing.T) {
	w := httptest.NewRecorder()
	Fail(w, Invalid("参数错误", map[string]string{"url": "必填"}))
	if w.Code != 400 {
		t.Fatal(w.Code)
	}
	var env struct {
		Code int `json:"code"`
		Data struct {
			Fields map[string]string `json:"fields"`
		} `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &env)
	if env.Code != CodeValidation || env.Data.Fields["url"] != "必填" {
		t.Fatalf("%s", w.Body.String())
	}
	w = httptest.NewRecorder()
	Fail(w, Err(http.StatusForbidden, "无权限"))
	if w.Code != 403 {
		t.Fatal(w.Code)
	}
	w = httptest.NewRecorder()
	OK(w, map[string]int{"a": 1})
	if w.Code != 200 {
		t.Fatal()
	}
}
