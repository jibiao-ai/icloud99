package api

import "testing"

func TestValidateSettings(t *testing.T) {
	ok := map[string]string{"site.name": "元擎", "site.primary_color": "#6C5CE7", "monitor.interval_minutes": "60",
		"iq.start_hour": "2", "iq.end_hour": "8", "site.token_base_url": "https://api.example.com", "radar.url": "", "iq.enabled": "1"}
	if e := ValidateSettings(ok); len(e) != 0 {
		t.Fatalf("合法设置不应报错: %v", e)
	}
	bad := map[string]string{"site.name": "", "site.primary_color": "red", "monitor.interval_minutes": "1",
		"site.token_base_url": "ftp://x", "iq.enabled": "yes", "unknown.key": "x", "iq.end_hour": "25"}
	e := ValidateSettings(bad)
	for _, k := range []string{"site.name", "site.primary_color", "monitor.interval_minutes", "site.token_base_url", "iq.enabled", "unknown.key", "iq.end_hour"} {
		if e[k] == "" {
			t.Errorf("%s 应报错", k)
		}
	}
}

func TestValidateKeyItems(t *testing.T) {
	saved := map[string]bool{"openai/lite": true}
	items := []keyRow{
		{Provider: "openai", Tier: "lite", BaseURL: "https://a.com", Key: "******"},     // 已保存 + 占位符 => 合法（不修改）
		{Provider: "openai", Tier: "standard", BaseURL: "https://a.com", Key: "******"}, // 首次 + 占位符 => 非法
		{Provider: "openai", Tier: "ultra", BaseURL: "", Key: "sk-1"},                   // 缺地址
		{Provider: "bad", Tier: "lite", BaseURL: "https://a.com", Key: "sk"},            // 非法分组
		{Provider: "anthropic", Tier: "lite", BaseURL: "https://a.com", Key: "sk-2"},    // 合法新增
	}
	e := ValidateKeyItems(items, saved)
	if e["items.0.apiKey"] != "" || e["items.0.baseUrl"] != "" {
		t.Errorf("已保存项使用占位符应合法: %v", e)
	}
	if e["items.1.apiKey"] == "" {
		t.Error("首次保存用占位符应报错")
	}
	if e["items.2.baseUrl"] == "" {
		t.Error("缺地址应报错")
	}
	if e["items.3.provider"] == "" {
		t.Error("非法分组应报错")
	}
	if len(e) != 3 {
		t.Errorf("预期 3 个错误，实际 %v", e)
	}
}

func TestValidateNewAPI(t *testing.T) {
	if e := ValidateNewAPI(newapiIn{BaseURL: "https://x.com", Username: "u", Password: "p"}, false); len(e) != 0 {
		t.Fatal(e)
	}
	if e := ValidateNewAPI(newapiIn{BaseURL: "https://x.com", Username: "u", Password: "******"}, true); len(e) != 0 {
		t.Fatal("已保存时占位符合法", e)
	}
	e := ValidateNewAPI(newapiIn{BaseURL: "x", Username: "", Password: "******"}, false)
	if e["baseUrl"] == "" || e["username"] == "" || e["password"] == "" {
		t.Fatal(e)
	}
}

func TestValidateNewPassword(t *testing.T) {
	if e := ValidateNewPassword("old", "newpass123"); len(e) != 0 {
		t.Fatal(e)
	}
	if e := ValidateNewPassword("", "short"); e["currentPassword"] == "" || e["newPassword"] == "" {
		t.Fatal(e)
	}
	if e := ValidateNewPassword("samepass1", "samepass1"); e["newPassword"] == "" {
		t.Fatal("新旧相同应报错")
	}
}
