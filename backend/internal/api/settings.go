package api

import (
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"cloudwatch/internal/auth"
	"cloudwatch/internal/httpx"
	"cloudwatch/internal/iq"
	"cloudwatch/internal/secret"
	"cloudwatch/internal/store"
)

// settingSpec 可由页面修改的系统参数及其校验。
var settingSpec = map[string]func(string) string{
	"site.name":                func(v string) string { return reqText(v, 1, 40, "站点名称") },
	"site.token_base_url":      optURL,
	"site.primary_color":       hexColor,
	"site.quota_per_unit":      intRange(1, 1000000000),
	"site.currency_symbol":     func(v string) string { return reqText(v, 1, 4, "货币符号") },
	"radar.url":                optURL,
	"monitor.enabled":          boolStr,
	"monitor.interval_minutes": intRange(5, 1440),
	"monitor.retention_days":   intRange(1, 365),
	"iq.enabled":               boolStr,
	"iq.model":                 func(v string) string { return reqText(v, 1, 100, "检测模型") },
	"iq.start_hour":            intRange(0, 23),
	"iq.end_hour":              intRange(1, 24),
}

var hexRe = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func reqText(v string, min, max int, name string) string {
	n := len([]rune(strings.TrimSpace(v)))
	if n < min || n > max {
		return name + "长度应为 " + strconv.Itoa(min) + "~" + strconv.Itoa(max) + " 个字符"
	}
	return ""
}

func optURL(v string) string {
	if strings.TrimSpace(v) == "" {
		return ""
	}
	u, err := url.Parse(strings.TrimSpace(v))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "请填写以 http:// 或 https:// 开头的有效地址"
	}
	return ""
}

func hexColor(v string) string {
	if !hexRe.MatchString(v) {
		return "颜色格式应为 #RRGGBB"
	}
	return ""
}

func boolStr(v string) string {
	if v != "0" && v != "1" {
		return "取值应为 0 或 1"
	}
	return ""
}

func intRange(min, max int) func(string) string {
	return func(v string) string {
		n, err := strconv.Atoi(v)
		if err != nil || n < min || n > max {
			return "请填写 " + strconv.Itoa(min) + "~" + strconv.Itoa(max) + " 的整数"
		}
		return ""
	}
}

// ValidateSettings 校验一组设置，返回字段级错误（纯函数，便于测试）。
func ValidateSettings(in map[string]string) map[string]string {
	errs := map[string]string{}
	for k, v := range in {
		fn, ok := settingSpec[k]
		if !ok {
			errs[k] = "不支持的参数"
			continue
		}
		if m := fn(v); m != "" {
			errs[k] = m
		}
	}
	return errs
}

func (s *Server) settingsGet(w http.ResponseWriter, r *http.Request, _ *auth.Principal) error {
	all, err := s.Store.AllSettings(r.Context())
	if err != nil {
		return err
	}
	out := map[string]string{}
	for k := range settingSpec {
		out[k] = all[k]
	}
	httpx.OK(w, out)
	return nil
}

func (s *Server) settingsPut(w http.ResponseWriter, r *http.Request, p *auth.Principal) error {
	t0 := time.Now()
	var in map[string]string
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	if errs := ValidateSettings(in); len(errs) > 0 {
		return httpx.Invalid("参数校验失败", errs)
	}
	cur, _ := s.Store.AllSettings(r.Context())
	start, end := atoiDef(merge(in, cur, "iq.start_hour"), 2), atoiDef(merge(in, cur, "iq.end_hour"), 8)
	if start >= end {
		return httpx.Invalid("自动检测起始小时必须小于结束小时", map[string]string{"iq.end_hour": "结束小时必须大于起始小时"})
	}
	for k, v := range in {
		if err := s.Store.SetSetting(r.Context(), k, strings.TrimSpace(v)); err != nil {
			s.rec(r, p, "settings", "update", "系统参数", "/settings?tab=system", in, err, t0)
			return err
		}
	}
	s.rec(r, p, "settings", "update", "系统参数", "/settings?tab=system", in, nil, t0)
	httpx.OK(w, map[string]bool{"saved": true})
	return nil
}

func merge(in, cur map[string]string, k string) string {
	if v, ok := in[k]; ok {
		return v
	}
	return cur[k]
}

func atoiDef(v string, def int) int {
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

// ---- 上游 API 密钥（按 provider × tier）----

var providers = []string{"openai", "anthropic"}

type keyRow struct {
	Provider string `json:"provider"`
	Tier     string `json:"tier"`
	BaseURL  string `json:"baseUrl"`
	Key      string `json:"apiKey"` // 已保存显示 ******，未保存为空
	Saved    bool   `json:"saved"`
}

func (s *Server) keysList(w http.ResponseWriter, r *http.Request, _ *auth.Principal) error {
	rows, err := s.DB.QueryContext(r.Context(), `SELECT provider,tier,base_url FROM api_configs WHERE api_key_enc IS NOT NULL AND api_key_enc<>''`)
	if err != nil {
		return err
	}
	defer rows.Close()
	saved := map[string]string{}
	for rows.Next() {
		var pv, t, u string
		if err := rows.Scan(&pv, &t, &u); err != nil {
			return err
		}
		saved[pv+"/"+t] = u
	}
	if err := rows.Err(); err != nil {
		return err
	}
	out := []keyRow{}
	for _, pv := range providers {
		for _, t := range iq.Tiers {
			row := keyRow{Provider: pv, Tier: t}
			if u, ok := saved[pv+"/"+t]; ok {
				row.BaseURL, row.Key, row.Saved = u, secret.Mask, true
			}
			out = append(out, row)
		}
	}
	httpx.OK(w, out)
	return nil
}

func validProvider(p string) bool {
	for _, x := range providers {
		if x == p {
			return true
		}
	}
	return false
}

func validTier(t string) bool {
	for _, x := range iq.Tiers {
		if x == t {
			return true
		}
	}
	return false
}

// ValidateKeyItems 校验一批密钥配置（纯函数）。keys 为 "provider/tier" → 是否已保存。
func ValidateKeyItems(items []keyRow, saved map[string]bool) map[string]string {
	errs := map[string]string{}
	for i, it := range items {
		f := func(field string) string { return "items." + strconv.Itoa(i) + "." + field }
		if !validProvider(it.Provider) || !validTier(it.Tier) {
			errs[f("provider")] = "分组无效"
			continue
		}
		if m := optURL(it.BaseURL); m != "" || strings.TrimSpace(it.BaseURL) == "" {
			if m == "" {
				m = "请填写上游 API 地址"
			}
			errs[f("baseUrl")] = m
		}
		first := !saved[it.Provider+"/"+it.Tier]
		if first && (it.Key == "" || secret.IsMask(it.Key)) {
			errs[f("apiKey")] = "首次保存必须填写密钥"
		}
	}
	return errs
}

func (s *Server) keysPut(w http.ResponseWriter, r *http.Request, p *auth.Principal) error {
	t0 := time.Now()
	var in struct {
		Items []keyRow `json:"items"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	if len(in.Items) == 0 {
		return httpx.Invalid("请提供要保存的配置", map[string]string{"items": "不能为空"})
	}
	rows, err := s.DB.QueryContext(r.Context(), `SELECT provider,tier FROM api_configs WHERE api_key_enc IS NOT NULL AND api_key_enc<>''`)
	if err != nil {
		return err
	}
	saved := map[string]bool{}
	for rows.Next() {
		var a, b string
		if err := rows.Scan(&a, &b); err != nil {
			rows.Close()
			return err
		}
		saved[a+"/"+b] = true
	}
	rows.Close()
	if errs := ValidateKeyItems(in.Items, saved); len(errs) > 0 {
		return httpx.Invalid("配置校验失败", errs)
	}
	targets := []string{}
	for _, it := range in.Items {
		if err := s.Store.SaveChannelKey(r.Context(), it.Provider, it.Tier, strings.TrimRight(strings.TrimSpace(it.BaseURL), "/"), it.Key); err != nil {
			s.rec(r, p, "settings", "keys_save", it.Provider+"/"+it.Tier, "/settings?tab=keys", nil, err, t0)
			return httpx.Err(http.StatusBadRequest, err.Error())
		}
		targets = append(targets, it.Provider+"/"+it.Tier)
	}
	s.rec(r, p, "settings", "keys_save", strings.Join(targets, ","), "/settings?tab=keys", in, nil, t0)
	httpx.OK(w, map[string]any{"saved": len(targets)})
	return nil
}

func (s *Server) keysDelete(w http.ResponseWriter, r *http.Request, p *auth.Principal) error {
	t0 := time.Now()
	pv, t := r.PathValue("provider"), r.PathValue("tier")
	if !validProvider(pv) || !validTier(t) {
		return httpx.Err(http.StatusBadRequest, "分组无效")
	}
	_, err := s.DB.ExecContext(r.Context(), `DELETE FROM api_configs WHERE provider=? AND tier=?`, pv, t)
	s.rec(r, p, "settings", "keys_delete", pv+"/"+t, "/settings?tab=keys", nil, err, t0)
	if err != nil {
		return err
	}
	httpx.OK(w, map[string]bool{"deleted": true})
	return nil
}

// ---- New API 管理员 ----

func (s *Server) newapiGet(w http.ResponseWriter, r *http.Request, _ *auth.Principal) error {
	cfg, err := s.Store.NewAPICfg(r.Context())
	if errors.Is(err, store.ErrNotConfigured) {
		httpx.OK(w, map[string]any{"baseUrl": "", "username": "", "password": "", "saved": false})
		return nil
	}
	if err != nil {
		return err
	}
	httpx.OK(w, map[string]any{"baseUrl": cfg.URL, "username": cfg.Username, "password": secret.Mask, "saved": true})
	return nil
}

type newapiIn struct {
	BaseURL  string `json:"baseUrl"`
	Username string `json:"username"`
	Password string `json:"password"`
}

// ValidateNewAPI 校验 New API 配置（纯函数）。
func ValidateNewAPI(in newapiIn, saved bool) map[string]string {
	errs := map[string]string{}
	if strings.TrimSpace(in.BaseURL) == "" {
		errs["baseUrl"] = "请填写 New API 地址"
	} else if m := optURL(in.BaseURL); m != "" {
		errs["baseUrl"] = m
	}
	if strings.TrimSpace(in.Username) == "" {
		errs["username"] = "请填写管理员用户名"
	}
	if !saved && (in.Password == "" || secret.IsMask(in.Password)) {
		errs["password"] = "请填写密码"
	}
	return errs
}

func (s *Server) newapiPut(w http.ResponseWriter, r *http.Request, p *auth.Principal) error {
	t0 := time.Now()
	var in newapiIn
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	_, e := s.Store.NewAPICfg(r.Context())
	if errs := ValidateNewAPI(in, e == nil); len(errs) > 0 {
		return httpx.Invalid("配置校验失败", errs)
	}
	err := s.Store.SaveNewAPICfg(r.Context(), strings.TrimRight(strings.TrimSpace(in.BaseURL), "/"), strings.TrimSpace(in.Username), in.Password)
	if err == nil {
		s.Usage.Invalidate()
	}
	s.rec(r, p, "settings", "newapi_save", in.BaseURL, "/settings?tab=newapi", in, err, t0)
	if err != nil {
		return httpx.Err(http.StatusBadRequest, err.Error())
	}
	httpx.OK(w, map[string]bool{"saved": true})
	return nil
}

func (s *Server) newapiTest(w http.ResponseWriter, r *http.Request, p *auth.Principal) error {
	t0 := time.Now()
	cfg, err := s.newapiCfg(r)
	if err != nil {
		return err
	}
	uid, total, err := s.NewAPI.TestConnection(r.Context(), cfg)
	s.rec(r, p, "settings", "newapi_test", cfg.URL, "/settings?tab=newapi", nil, err, t0)
	if err != nil {
		return upstream(err)
	}
	httpx.OK(w, map[string]any{"uid": uid, "totalUsers": total})
	return nil
}

// ---- 修改密码 ----

// ValidateNewPassword 校验新密码（纯函数）。
func ValidateNewPassword(cur, next string) map[string]string {
	errs := map[string]string{}
	if cur == "" {
		errs["currentPassword"] = "请输入当前密码"
	}
	switch {
	case len(next) < 8:
		errs["newPassword"] = "新密码至少 8 位"
	case next == cur:
		errs["newPassword"] = "新密码不能与当前密码相同"
	}
	return errs
}

func (s *Server) changePassword(w http.ResponseWriter, r *http.Request, p *auth.Principal) error {
	t0 := time.Now()
	var in struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	if errs := ValidateNewPassword(in.CurrentPassword, in.NewPassword); len(errs) > 0 {
		return httpx.Invalid("密码校验失败", errs)
	}
	var hash string
	if err := s.DB.QueryRowContext(r.Context(), `SELECT password_hash FROM admin_users WHERE id=?`, p.ID).Scan(&hash); err != nil {
		return httpx.Err(http.StatusBadRequest, "用户不存在")
	}
	if !auth.CheckPassword(hash, in.CurrentPassword) {
		err := errors.New("当前密码错误")
		s.rec(r, p, "auth", "change_password", p.Username, "/settings?tab=security", nil, err, t0)
		return httpx.Invalid("当前密码错误", map[string]string{"currentPassword": "当前密码错误"})
	}
	nh, err := auth.HashPassword(in.NewPassword)
	if err == nil {
		_, err = s.DB.ExecContext(r.Context(), `UPDATE admin_users SET password_hash=? WHERE id=?`, nh, p.ID)
	}
	s.rec(r, p, "auth", "change_password", p.Username, "/settings?tab=security", nil, err, t0)
	if err != nil {
		return err
	}
	httpx.OK(w, map[string]bool{"changed": true})
	return nil
}

// ---- 审计日志 ----

func (s *Server) auditList(w http.ResponseWriter, r *http.Request, _ *auth.Principal) error {
	q := httpx.ParseListQuery(r, 20, 100)
	module := r.URL.Query().Get("module")
	where, args := ` WHERE 1=1`, []any{}
	if module != "" {
		where += ` AND module=?`
		args = append(args, module)
	}
	if q.Keyword != "" {
		where += ` AND (action LIKE ? OR target LIKE ? OR username LIKE ?)`
		kw := "%" + q.Keyword + "%"
		args = append(args, kw, kw, kw)
	}
	var total int
	if err := s.DB.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM audit_logs`+where, args...).Scan(&total); err != nil {
		return err
	}
	pages := (total + q.PageSize - 1) / q.PageSize
	if pages < 1 {
		pages = 1
	}
	if q.Page > pages {
		q.Page = pages
	}
	rows, err := s.DB.QueryContext(r.Context(), `SELECT id,module,action,target,link,COALESCE(detail,''),ip,username,success,duration_ms,created_at
		FROM audit_logs`+where+` ORDER BY id DESC LIMIT ? OFFSET ?`, append(args, q.PageSize, q.Offset())...)
	if err != nil {
		return err
	}
	defer rows.Close()
	type row struct {
		ID         int64     `json:"id"`
		Module     string    `json:"module"`
		Action     string    `json:"action"`
		Target     string    `json:"target"`
		Link       string    `json:"link"`
		Detail     string    `json:"detail"`
		IP         string    `json:"ip"`
		Username   string    `json:"username"`
		Success    bool      `json:"success"`
		DurationMs int       `json:"durationMs"`
		CreatedAt  time.Time `json:"createdAt"`
	}
	list := []row{}
	for rows.Next() {
		var x row
		var ok int
		if err := rows.Scan(&x.ID, &x.Module, &x.Action, &x.Target, &x.Link, &x.Detail, &x.IP, &x.Username, &ok, &x.DurationMs, &x.CreatedAt); err != nil {
			return err
		}
		x.Success = ok == 1
		list = append(list, x)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	mods := []string{}
	mr, err := s.DB.QueryContext(r.Context(), `SELECT DISTINCT module FROM audit_logs WHERE module<>'' ORDER BY module`)
	if err == nil {
		defer mr.Close()
		for mr.Next() {
			var m string
			if mr.Scan(&m) == nil {
				mods = append(mods, m)
			}
		}
	}
	httpx.OK(w, map[string]any{"page": httpx.NewPageResult(list, total, q.Page, q.PageSize), "modules": mods})
	return nil
}
