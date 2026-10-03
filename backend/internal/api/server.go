// Package api 装配 HTTP 路由（Go 1.22 ServeMux 方法路由）与各模块 handler。
package api

import (
	"context"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"icloud99/internal/audit"
	"icloud99/internal/auth"
	"icloud99/internal/httpx"
	"icloud99/internal/monitor"
	"icloud99/internal/newapi"
	"icloud99/internal/store"
	"icloud99/internal/usage"

	"database/sql"
)

// Server 聚合依赖。
type Server struct {
	DB      *sql.DB
	Store   *store.Store
	Signer  *auth.Signer
	Audit   *audit.Recorder
	Runner  *monitor.Runner
	NewAPI  *newapi.Client
	Usage   *usage.Service
	Limiter *auth.Limiter
	HTTP    *http.Client
	CST     *time.Location
	iqJob   iqJob
}

type ctxKey int

const principalKey ctxKey = 1

type handlerFn func(w http.ResponseWriter, r *http.Request, p *auth.Principal) error

// principal 从 Authorization 解析主体；无令牌为匿名，令牌无效返回 401。
func (s *Server) principal(r *http.Request) (*auth.Principal, error) {
	h := r.Header.Get("Authorization")
	if h == "" {
		return auth.Anonymous(), nil
	}
	if !strings.HasPrefix(h, "Bearer ") {
		return nil, httpx.Err(http.StatusUnauthorized, "未授权")
	}
	p, err := s.Signer.Verify(strings.TrimPrefix(h, "Bearer "))
	if err != nil {
		return nil, httpx.Err(http.StatusUnauthorized, "登录已过期，请重新登录")
	}
	return p, nil
}

// guard 校验权限码；perm 为空表示公开（仍解析主体）。匿名访问受限资源返回 401，已登录无权限返回 403。
func (s *Server) guard(code string, h handlerFn) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, err := s.principal(r)
		if err != nil {
			httpx.Fail(w, err)
			return
		}
		if code != "" && !p.Can(code) {
			if p.IsAnonymous() {
				httpx.Fail(w, httpx.Err(http.StatusUnauthorized, "请先登录"))
			} else {
				httpx.Fail(w, httpx.Err(http.StatusForbidden, "无权限执行该操作"))
			}
			return
		}
		if err := h(w, r.WithContext(context.WithValue(r.Context(), principalKey, p)), p); err != nil {
			httpx.Fail(w, err)
		}
	})
}

// clientIP 取真实客户端 IP（反代后读 X-Real-IP / X-Forwarded-For）。
func clientIP(r *http.Request) string {
	if v := r.Header.Get("X-Real-IP"); v != "" {
		return v
	}
	if v := r.Header.Get("X-Forwarded-For"); v != "" {
		return strings.TrimSpace(strings.Split(v, ",")[0])
	}
	h, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return h
}

// rec 记录审计（写操作与导出必须调用）。
func (s *Server) rec(r *http.Request, p *auth.Principal, module, action, target, link string, detail any, err error, t0 time.Time) {
	user := ""
	if p != nil {
		user = p.Username
	}
	s.Audit.Record(audit.Entry{Module: module, Action: action, Target: target, Link: link, Detail: detail,
		IP: clientIP(r), Username: user, Err: err, Started: t0})
}

// Handler 构建路由。
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.Handle("GET /api/health", http.HandlerFunc(s.health))

	// 公开
	mux.Handle("GET /api/public/portal-info", s.guard("", s.portalInfo))
	mux.Handle("POST /api/auth/login", s.guard("", s.login))
	mux.Handle("GET /api/auth/me", s.guard("", s.me))

	// 渠道状态
	mux.Handle("GET /api/channels", s.guard("channel:view", s.channelList))
	mux.Handle("GET /api/channels/{id}/detail", s.guard("channel:view", s.channelDetail))
	mux.Handle("GET /api/channels/test/status", s.guard("channel:view", s.channelTestStatus))
	mux.Handle("POST /api/channels/test/start", s.guard("channel:test", s.channelTestStart))
	mux.Handle("POST /api/channels/test/stop", s.guard("channel:test", s.channelTestStop))
	mux.Handle("POST /api/channels/seed", s.guard("channel:manage", s.channelSeed))
	mux.Handle("POST /api/channels/cleanup", s.guard("channel:manage", s.channelCleanup))

	// 智力检测
	mux.Handle("GET /api/iq/tests", s.guard("iq:view", s.iqList))
	mux.Handle("GET /api/iq/stats", s.guard("iq:view", s.iqStats))
	mux.Handle("GET /api/iq/schedule", s.guard("iq:view", s.iqSchedule))
	mux.Handle("POST /api/iq/run", s.guard("iq:run", s.iqRun))
	mux.Handle("GET /api/iq/run/status", s.guard("iq:view", s.iqRunStatus))

	// 令牌用量查询（访客可用：用户自带令牌 Key）
	mux.Handle("POST /api/token-usage/query", s.guard("token:query", s.tokenQuery))

	// 用量统计（管理员）
	mux.Handle("GET /api/usage/summary", s.guard("usage:view", s.usageSummary))
	mux.Handle("GET /api/usage/user/{username}", s.guard("usage:view", s.usageUser))
	mux.Handle("GET /api/usage/user/{username}/logs", s.guard("usage:view", s.usageUserLogs))
	mux.Handle("GET /api/usage/export", s.guard("usage:export", s.usageExport))

	// 管理设置
	mux.Handle("GET /api/settings", s.guard("settings:view", s.settingsGet))
	mux.Handle("PUT /api/settings", s.guard("settings:edit", s.settingsPut))
	mux.Handle("GET /api/settings/channel-keys", s.guard("settings:view", s.keysList))
	mux.Handle("PUT /api/settings/channel-keys", s.guard("settings:edit", s.keysPut))
	mux.Handle("DELETE /api/settings/channel-keys/{provider}/{tier}", s.guard("settings:edit", s.keysDelete))
	mux.Handle("GET /api/settings/newapi", s.guard("settings:view", s.newapiGet))
	mux.Handle("PUT /api/settings/newapi", s.guard("settings:edit", s.newapiPut))
	mux.Handle("POST /api/settings/newapi/test", s.guard("settings:edit", s.newapiTest))
	mux.Handle("POST /api/settings/password", s.guard("password:change", s.changePassword))
	mux.Handle("GET /api/audit-logs", s.guard("audit:view", s.auditList))

	return recoverer(withCORS(mux))
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if err := s.DB.PingContext(ctx); err != nil {
		httpx.Fail(w, httpx.Err(http.StatusServiceUnavailable, "数据库不可用"))
		return
	}
	httpx.OK(w, map[string]string{"status": "ok"})
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Expose-Headers", "Content-Disposition")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				log.Printf("[panic] %s %s: %v", r.Method, r.URL.Path, v)
				httpx.Fail(w, httpx.Err(http.StatusInternalServerError, "服务内部错误"))
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func (s *Server) autoAudit(module, action, target, link string, detail any) {
	s.Audit.Record(auditEntry(module, action, target, link, detail, nil, time.Now()))
}
