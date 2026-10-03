package bootstrap

import "testing"

func TestCatalogShape(t *testing.T) {
	if len(Catalog) != 8 {
		t.Fatalf("目录应为 8 个模型，实际 %d", len(Catalog))
	}
	seen := map[string]bool{}
	for _, c := range Catalog {
		if seen[c.Model] {
			t.Fatalf("模型重复 %s", c.Model)
		}
		seen[c.Model] = true
		if c.Provider != "openai" && c.Provider != "anthropic" {
			t.Fatalf("未知 provider %s", c.Provider)
		}
	}
	if len(Catalog)*len(Tiers) != 24 {
		t.Fatal("应共 24 个渠道")
	}
}

func TestRandomPassword(t *testing.T) {
	a, b := randomPassword(), randomPassword()
	if len(a) != 18 || a == b {
		t.Fatalf("%q %q", a, b)
	}
}
