package api

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	"cloudwatch/internal/auth"
	"cloudwatch/internal/httpx"
	"cloudwatch/internal/perm"
)

const tokenTTL = 24 * time.Hour

// dummyHash 用户不存在时仍做一次真实 bcrypt 比较，抹平耗时差异（防用户名枚举）。
var dummyHash, _ = auth.HashPassword("cloudwatch-dummy-password")

func (s *Server) portalInfo(w http.ResponseWriter, r *http.Request, _ *auth.Principal) error {
	st, err := s.Store.AllSettings(r.Context())
	if err != nil {
		return err
	}
	pub := map[string]string{}
	for _, k := range []string{"site.name", "site.primary_color", "site.quota_per_unit", "site.currency_symbol", "radar.url"} {
		pub[k] = st[k]
	}
	httpx.OK(w, pub)
	return nil
}

type loginReq struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (s *Server) login(w http.ResponseWriter, r *http.Request, _ *auth.Principal) error {
	t0 := time.Now()
	var in loginReq
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	in.Username = strings.TrimSpace(in.Username)
	fields := map[string]string{}
	if in.Username == "" {
		fields["username"] = "请输入用户名"
	}
	if in.Password == "" {
		fields["password"] = "请输入密码"
	}
	if len(fields) > 0 {
		return httpx.Invalid("请填写用户名和密码", fields)
	}
	key := clientIP(r) + "|" + in.Username
	if s.Limiter.Blocked(key) {
		return httpx.Err(http.StatusTooManyRequests, "登录失败次数过多，请 10 分钟后再试")
	}
	var id int64
	var hash string
	err := s.DB.QueryRowContext(r.Context(), `SELECT id,password_hash FROM admin_users WHERE username=?`, in.Username).Scan(&id, &hash)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	// 用户不存在时同样做一次哈希比较，避免通过耗时枚举用户名
	if errors.Is(err, sql.ErrNoRows) {
		hash = dummyHash
	}
	if !auth.CheckPassword(hash, in.Password) || errors.Is(err, sql.ErrNoRows) {
		s.Limiter.Fail(key)
		s.rec(r, &auth.Principal{Username: in.Username}, "auth", "login_failed", in.Username, "", nil, errors.New("用户名或密码错误"), t0)
		return httpx.Err(http.StatusUnauthorized, "用户名或密码错误")
	}
	s.Limiter.Reset(key)
	p := auth.Admin(id, in.Username)
	s.rec(r, p, "auth", "login", in.Username, "", nil, nil, t0)
	httpx.OK(w, map[string]any{
		"token": s.Signer.Issue(id, in.Username, tokenTTL),
		"user":  map[string]any{"id": id, "username": in.Username},
		"perms": p.Perms(),
	})
	return nil
}

func (s *Server) me(w http.ResponseWriter, _ *http.Request, p *auth.Principal) error {
	var user any
	if !p.IsAnonymous() {
		user = map[string]any{"id": p.ID, "username": p.Username}
	}
	httpx.OK(w, map[string]any{"user": user, "perms": p.Perms(), "menus": perm.Menus})
	return nil
}
