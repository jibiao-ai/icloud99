package api

import (
	"reflect"
	"slices"
	"testing"

	"icloud99/internal/perm"
)

func TestBillMonths(t *testing.T) {
	got, err := billMonths("2026-09, 2026-08,2026-09,")
	if err != nil || !reflect.DeepEqual(got, []string{"2026-08", "2026-09"}) {
		t.Fatalf("去重排序失败: %v %v", got, err)
	}
	for _, bad := range []string{"", "2026-13", "abc", "2026-01,2026-02,2026-03,2026-04,2026-05,2026-06,2026-07,2026-08,2026-09,2026-10,2026-11,2026-12,2027-01"} {
		if _, err := billMonths(bad); err == nil {
			t.Fatalf("应拒绝 %q", bad)
		}
	}
}

func TestBillExportAdminOnly(t *testing.T) {
	if !slices.Contains(perm.Admin, perm.BillExport) {
		t.Fatal("管理员应拥有 bill:export")
	}
	if slices.Contains(perm.Anonymous, perm.BillExport) {
		t.Fatal("匿名用户不得拥有 bill:export")
	}
}
