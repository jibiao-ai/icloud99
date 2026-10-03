package audit

import "testing"

func TestTrunc(t *testing.T) {
	if trunc("你好世界", 2) != "你好" || trunc("ab", 5) != "ab" {
		t.Fatal("trunc")
	}
}
