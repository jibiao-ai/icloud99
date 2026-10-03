// Package auth 实现 bcrypt 密码校验与 HMAC-SHA256 签名令牌（JWT 兼容格式）。
package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"

	"icloud99/internal/perm"

	"golang.org/x/crypto/bcrypt"
)

// Principal 当前请求主体。匿名时 Username 为空。
type Principal struct {
	ID       int64
	Username string
	perms    map[string]bool
}

// Can 判断是否拥有权限码。
func (p *Principal) Can(code string) bool { return p != nil && p.perms[code] }

// Perms 返回权限码列表。
func (p *Principal) Perms() []string {
	out := make([]string, 0, len(p.perms))
	for k := range p.perms {
		out = append(out, k)
	}
	return out
}

// IsAnonymous 是否未登录。
func (p *Principal) IsAnonymous() bool { return p == nil || p.Username == "" }

// Anonymous 构造匿名主体。
func Anonymous() *Principal { return &Principal{perms: perm.Set(perm.Anonymous)} }

// Admin 构造管理员主体。
func Admin(id int64, name string) *Principal {
	return &Principal{ID: id, Username: name, perms: perm.Set(perm.Admin)}
}

// HashPassword 生成 bcrypt 哈希。
func HashPassword(pw string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	return string(b), err
}

// CheckPassword 校验密码。
func CheckPassword(hash, pw string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(pw)) == nil
}

type claims struct {
	UID  int64  `json:"uid"`
	Name string `json:"name"`
	Exp  int64  `json:"exp"`
}

var enc = base64.RawURLEncoding

// Signer 令牌签发/校验。
type Signer struct{ key []byte }

// NewSigner 创建签名器。
func NewSigner(master string) *Signer {
	sum := sha256.Sum256([]byte("icloud99/jwt/v1|" + master))
	return &Signer{key: sum[:]}
}

func (s *Signer) mac(msg string) string {
	h := hmac.New(sha256.New, s.key)
	h.Write([]byte(msg))
	return enc.EncodeToString(h.Sum(nil))
}

// Issue 签发令牌。
func (s *Signer) Issue(uid int64, name string, ttl time.Duration) string {
	head := enc.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	body, _ := json.Marshal(claims{UID: uid, Name: name, Exp: time.Now().Add(ttl).Unix()})
	msg := head + "." + enc.EncodeToString(body)
	return msg + "." + s.mac(msg)
}

// Verify 校验令牌并返回管理员主体。
func (s *Signer) Verify(tok string) (*Principal, error) {
	parts := strings.Split(tok, ".")
	if len(parts) != 3 {
		return nil, errors.New("令牌格式错误")
	}
	if !hmac.Equal([]byte(s.mac(parts[0]+"."+parts[1])), []byte(parts[2])) {
		return nil, errors.New("令牌签名无效")
	}
	raw, err := enc.DecodeString(parts[1])
	if err != nil {
		return nil, errors.New("令牌内容无效")
	}
	var c claims
	if err := json.Unmarshal(raw, &c); err != nil {
		return nil, errors.New("令牌内容无效")
	}
	if c.Exp < time.Now().Unix() {
		return nil, errors.New("令牌已过期")
	}
	return Admin(c.UID, c.Name), nil
}

// Limiter 登录失败限流（按 key，滑动窗口）。
type Limiter struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	hits   map[string][]time.Time
}

// NewLimiter 创建限流器。
func NewLimiter(max int, window time.Duration) *Limiter {
	return &Limiter{max: max, window: window, hits: map[string][]time.Time{}}
}

func (l *Limiter) prune(key string, now time.Time) []time.Time {
	var keep []time.Time
	for _, t := range l.hits[key] {
		if now.Sub(t) < l.window {
			keep = append(keep, t)
		}
	}
	l.hits[key] = keep
	return keep
}

// Blocked 是否已被限流。
func (l *Limiter) Blocked(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.prune(key, time.Now())) >= l.max
}

// Fail 记录一次失败。
func (l *Limiter) Fail(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	l.prune(key, now)
	l.hits[key] = append(l.hits[key], now)
}

// Reset 清除记录。
func (l *Limiter) Reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.hits, key)
}
