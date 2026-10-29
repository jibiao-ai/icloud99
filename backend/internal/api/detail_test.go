package api

import (
	"slices"
	"testing"
	"time"

	"icloud99/internal/detail"
	"icloud99/internal/perm"
	"icloud99/internal/usage"
)

func TestParseDetailReq(t *testing.T) {
	now := time.Date(2026, 10, 29, 12, 0, 0, 0, usage.CST)
	if _, err := parseDetailReq(detailReq{Start: "2026-09-01"}, now); err == nil {
		t.Fatal("缺少结束日期应拒绝")
	}
	if sw, err := parseDetailReq(detailReq{Start: "2026-09-30", End: "2026-09-01"}, now); err != nil || sw.Start != "2026-09-01" || sw.End != "2026-09-30" {
		t.Fatalf("起止颠倒应自动对调: %+v %v", sw, err)
	}
	if _, err := parseDetailReq(detailReq{Start: "2024-01-01", End: "2026-09-01"}, now); err == nil {
		t.Fatal("超过 400 天应拒绝")
	}
	many := make([]string, detail.MaxUsers+1)
	for i := range many {
		many[i] = "u" + string(rune('a'+i%26)) + string(rune('a'+i/26))
	}
	if _, err := parseDetailReq(detailReq{Start: "2026-09-01", End: "2026-09-02", Users: many}, now); err == nil {
		t.Fatal("用户过多应拒绝")
	}
	p, err := parseDetailReq(detailReq{Start: "2026-09-01", End: "2026-09-30", Users: []string{" alice ", "alice", "", "bob"}, RowsPerFile: 5}, now)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(p.Users, []string{"alice", "bob"}) {
		t.Fatalf("用户去重失败: %v", p.Users)
	}
	if p.EndTs <= p.StartTs || p.MaxRowsPerFile != detail.ClampPerFile(5) {
		t.Fatalf("参数异常: %+v", p)
	}
}

func TestDetailExportAdminOnly(t *testing.T) {
	if !slices.Contains(perm.Admin, perm.DetailExport) {
		t.Fatal("管理员应拥有 detail:export")
	}
	if slices.Contains(perm.Anonymous, perm.DetailExport) {
		t.Fatal("匿名用户不得拥有 detail:export")
	}
}

func TestSafeName(t *testing.T) {
	if got := safeName(`a/b\c:d`); got != "a_b_c_d" {
		t.Fatal(got)
	}
}
