package api

import "testing"

func TestPublicPortalWhitelist(t *testing.T) {
	st := map[string]string{
		"site.name": "元擎智算", "site.token_base_url": "https://api.icloud99.cn",
		"newapi.password": "secret", "iq.model": "x",
	}
	pub := publicPortal(st)
	if pub["site.token_base_url"] != "https://api.icloud99.cn" {
		t.Fatalf("联系我们页依赖的 API 域名未公开: %v", pub)
	}
	if _, ok := pub["newapi.password"]; ok {
		t.Fatal("白名单外的配置不得公开")
	}
	if len(pub) != len(publicPortalKeys) {
		t.Fatalf("键数量不符: %v", pub)
	}
}
