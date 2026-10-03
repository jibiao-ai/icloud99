// Package secret 提供密钥的 AES-GCM 加解密（铁律12：密码/密钥落库加密、任何位置不回显）。
package secret

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"regexp"
	"strings"
)

// Mask 是密钥保存后在界面上的统一占位符。
const Mask = "******"

// Box 用主密钥派生 AES-256 密钥。
type Box struct{ aead cipher.AEAD }

// New 由 ICLOUD99_SECRET_KEY 派生加密盒。
func New(master string) (*Box, error) {
	sum := sha256.Sum256([]byte("icloud99/secret/v1|" + master))
	blk, err := aes.NewCipher(sum[:])
	if err != nil {
		return nil, err
	}
	g, err := cipher.NewGCM(blk)
	if err != nil {
		return nil, err
	}
	return &Box{aead: g}, nil
}

// Encrypt 返回 base64(nonce|ciphertext)。
func (b *Box) Encrypt(plain string) (string, error) {
	n := make([]byte, b.aead.NonceSize())
	if _, err := rand.Read(n); err != nil {
		return "", err
	}
	out := b.aead.Seal(n, n, []byte(plain), nil)
	return base64.StdEncoding.EncodeToString(out), nil
}

// Decrypt 解密 Encrypt 的输出。
func (b *Box) Decrypt(enc string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(enc)
	if err != nil {
		return "", err
	}
	ns := b.aead.NonceSize()
	if len(raw) < ns+b.aead.Overhead() {
		return "", errors.New("密文长度非法")
	}
	p, err := b.aead.Open(nil, raw[:ns], raw[ns:], nil)
	if err != nil {
		return "", err
	}
	return string(p), nil
}

// IsMask 判断前端提交的值是否仍是占位符（表示“不修改”）。
func IsMask(s string) bool { return strings.TrimSpace(s) == Mask }

var sensitiveKey = regexp.MustCompile(`(?i)(password|passwd|token|secret|api[_-]?key|authorization)`)

// IsSensitiveKey 判断字段名是否敏感。
func IsSensitiveKey(k string) bool { return sensitiveKey.MatchString(k) }

// Redact 递归脱敏 map/slice 中的敏感字段（审计详情使用）。
func Redact(v any) any {
	switch t := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, val := range t {
			if IsSensitiveKey(k) {
				out[k] = Mask
			} else {
				out[k] = Redact(val)
			}
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i, val := range t {
			out[i] = Redact(val)
		}
		return out
	default:
		return v
	}
}
