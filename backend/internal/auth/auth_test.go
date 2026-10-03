package auth

import (
	"strings"
	"testing"
	"time"

	"icloud99/internal/perm"
)

func TestTokenRoundTrip(t *testing.T) {
	s := NewSigner("master-key-123456")
	tok := s.Issue(7, "admin", time.Hour)
	p, err := s.Verify(tok)
	if err != nil || p.Username != "admin" || !p.Can(perm.UsageView) {
		t.Fatalf("verify: %v %+v", err, p)
	}
	if _, err := s.Verify(tok + "x"); err == nil {
		t.Fatal("篡改签名应失败")
	}
	parts := strings.Split(tok, ".")
	if _, err := s.Verify(parts[0] + "." + parts[1] + "A." + parts[2]); err == nil {
		t.Fatal("篡改载荷应失败")
	}
	if _, err := NewSigner("other-master-key-1").Verify(tok); err == nil {
		t.Fatal("不同密钥应失败")
	}
	if _, err := s.Verify(s.Issue(1, "a", -time.Minute)); err == nil {
		t.Fatal("过期应失败")
	}
}

func TestAnonymousPerms(t *testing.T) {
	a := Anonymous()
	if !a.Can(perm.ChannelView) || a.Can(perm.UsageView) || a.Can(perm.IQRun) || !a.IsAnonymous() {
		t.Fatal("匿名权限不正确")
	}
}

func TestPassword(t *testing.T) {
	h, _ := HashPassword("abc123")
	if !CheckPassword(h, "abc123") || CheckPassword(h, "abc124") {
		t.Fatal("bcrypt")
	}
}

func TestLimiter(t *testing.T) {
	l := NewLimiter(3, time.Minute)
	for i := 0; i < 3; i++ {
		if l.Blocked("ip") {
			t.Fatal("过早限流")
		}
		l.Fail("ip")
	}
	if !l.Blocked("ip") {
		t.Fatal("应被限流")
	}
	l.Reset("ip")
	if l.Blocked("ip") {
		t.Fatal("重置后不应限流")
	}
}
