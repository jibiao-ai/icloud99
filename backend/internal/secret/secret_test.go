package secret

import "testing"

func TestRoundTrip(t *testing.T) {
	b, err := New("0123456789abcdef-master")
	if err != nil {
		t.Fatal(err)
	}
	enc, err := b.Encrypt("sk-abc")
	if err != nil || enc == "sk-abc" {
		t.Fatalf("encrypt: %v %q", err, enc)
	}
	got, err := b.Decrypt(enc)
	if err != nil || got != "sk-abc" {
		t.Fatalf("decrypt: %v %q", err, got)
	}
	b2, _ := New("another-master-key-xx")
	if _, err := b2.Decrypt(enc); err == nil {
		t.Fatal("不同主密钥不应能解密")
	}
}

func TestRedact(t *testing.T) {
	in := map[string]any{
		"url": "x", "password": "p",
		"nested": map[string]any{"apiKey": "k", "ok": 1},
		"list":   []any{map[string]any{"Token": "t"}},
	}
	out := Redact(in).(map[string]any)
	if out["password"] != Mask || out["url"] != "x" {
		t.Fatalf("%v", out)
	}
	if out["nested"].(map[string]any)["apiKey"] != Mask {
		t.Fatal("嵌套未脱敏")
	}
	if out["list"].([]any)[0].(map[string]any)["Token"] != Mask {
		t.Fatal("数组未脱敏")
	}
}

func TestIsMask(t *testing.T) {
	if !IsMask(" ****** ") || IsMask("sk-1") {
		t.Fatal("IsMask")
	}
}
