// Package perm 登记权限码（module:action）与菜单（铁律8：禁止 role 硬编码）。
package perm

// 权限码。
const (
	ChannelView    = "channel:view"
	ChannelTest    = "channel:test"
	IQView         = "iq:view"
	IQRun          = "iq:run"
	TokenQuery     = "token:query"
	ContactView    = "contact:view"
	RadarView      = "radar:view"
	UsageView      = "usage:view"
	UsageExport    = "usage:export"
	SettingsView   = "settings:view"
	SettingsEdit   = "settings:edit"
	AuditView      = "audit:view"
	ChannelManage  = "channel:manage"
	PasswordChange = "password:change"
)

// Menu 菜单项，Perm 为空表示不限制。
type Menu struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Path  string `json:"path"`
	Icon  string `json:"icon"`
	Perm  string `json:"perm"`
}

// Menus 全部菜单（前端按 useCan 过滤）。
var Menus = []Menu{
	{"token-usage", "用量查询", "/token-usage", "LineChart", TokenQuery},
	{"channel-status", "渠道状态", "/channels", "Radio", ChannelView},
	{"iq-radar", "GPT智商雷达", "/radar", "Crosshair", RadarView},
	{"iq-test", "智力检测", "/iq", "Brain", IQView},
	{"usage-stats", "用量统计", "/usage", "Users", UsageView},
	{"contact", "联系我们", "/contact", "Headset", ContactView},
	{"settings", "管理设置", "/settings", "Settings", ""},
}

// Anonymous 未登录访客拥有的权限（公开页面）。
var Anonymous = []string{ChannelView, IQView, TokenQuery, ContactView, RadarView}

// Admin 管理员拥有全部权限。
var Admin = []string{
	ChannelView, ChannelTest, ChannelManage, IQView, IQRun, TokenQuery, ContactView, RadarView,
	UsageView, UsageExport, SettingsView, SettingsEdit, AuditView, PasswordChange,
}

// Set 将切片转换为集合。
func Set(list []string) map[string]bool {
	m := make(map[string]bool, len(list))
	for _, p := range list {
		m[p] = true
	}
	return m
}
