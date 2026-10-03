// Package store 封装 settings / api_configs / newapi_admin 的读写（密钥加解密集中于此）。
package store

import (
	"context"
	"database/sql"
	"errors"
	"strconv"

	"cloudwatch/internal/newapi"
	"cloudwatch/internal/secret"
)

// Store 配置存取。
type Store struct {
	DB  *sql.DB
	Box *secret.Box
}

// Setting 读取单个设置，缺失返回 def。
func (s *Store) Setting(ctx context.Context, k, def string) string {
	var v string
	if err := s.DB.QueryRowContext(ctx, `SELECT v FROM settings WHERE k=?`, k).Scan(&v); err != nil {
		return def
	}
	return v
}

// SettingInt 读取整型设置。
func (s *Store) SettingInt(ctx context.Context, k string, def int) int {
	n, err := strconv.Atoi(s.Setting(ctx, k, ""))
	if err != nil {
		return def
	}
	return n
}

// AllSettings 读取全部设置。
func (s *Store) AllSettings(ctx context.Context) (map[string]string, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT k,v FROM settings`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, rows.Err()
}

// SetSetting 写入设置。
func (s *Store) SetSetting(ctx context.Context, k, v string) error {
	_, err := s.DB.ExecContext(ctx, `INSERT INTO settings(k,v) VALUES(?,?) ON DUPLICATE KEY UPDATE v=VALUES(v)`, k, v)
	return err
}

// ChannelKey 某 provider/tier 的上游连接。
type ChannelKey struct {
	BaseURL string
	APIKey  string
}

// ErrNotConfigured 未配置。
var ErrNotConfigured = errors.New("未配置")

// GetChannelKey 读取并解密上游密钥。
func (s *Store) GetChannelKey(ctx context.Context, provider, tier string) (ChannelKey, error) {
	var base, enc string
	err := s.DB.QueryRowContext(ctx, `SELECT base_url,api_key_enc FROM api_configs WHERE provider=? AND tier=?`, provider, tier).Scan(&base, &enc)
	if errors.Is(err, sql.ErrNoRows) {
		return ChannelKey{}, ErrNotConfigured
	}
	if err != nil {
		return ChannelKey{}, err
	}
	k, err := s.Box.Decrypt(enc)
	if err != nil {
		return ChannelKey{}, err
	}
	return ChannelKey{BaseURL: base, APIKey: k}, nil
}

// SaveChannelKey 保存上游密钥；apiKey 为空或占位符时仅更新地址并保留旧密钥。
func (s *Store) SaveChannelKey(ctx context.Context, provider, tier, baseURL, apiKey string) error {
	if apiKey == "" || secret.IsMask(apiKey) {
		res, err := s.DB.ExecContext(ctx, `UPDATE api_configs SET base_url=? WHERE provider=? AND tier=?`, baseURL, provider, tier)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return errors.New("首次保存必须填写密钥")
		}
		return nil
	}
	enc, err := s.Box.Encrypt(apiKey)
	if err != nil {
		return err
	}
	_, err = s.DB.ExecContext(ctx, `INSERT INTO api_configs(provider,tier,base_url,api_key_enc) VALUES(?,?,?,?)
		ON DUPLICATE KEY UPDATE base_url=VALUES(base_url), api_key_enc=VALUES(api_key_enc)`, provider, tier, baseURL, enc)
	return err
}

// NewAPICfg 读取 New API 管理员配置（密码解密）；未配置返回 ErrNotConfigured。
func (s *Store) NewAPICfg(ctx context.Context) (newapi.Cfg, error) {
	var base, user, enc string
	err := s.DB.QueryRowContext(ctx, `SELECT base_url,username,password_enc FROM newapi_admin WHERE id=1`).Scan(&base, &user, &enc)
	if errors.Is(err, sql.ErrNoRows) {
		return newapi.Cfg{}, ErrNotConfigured
	}
	if err != nil {
		return newapi.Cfg{}, err
	}
	pw, err := s.Box.Decrypt(enc)
	if err != nil {
		return newapi.Cfg{}, err
	}
	return newapi.Cfg{URL: base, Username: user, Password: pw}, nil
}

// SaveNewAPICfg 保存 New API 管理员配置；password 为空或占位符时保留旧密码。
func (s *Store) SaveNewAPICfg(ctx context.Context, base, user, password string) error {
	if password == "" || secret.IsMask(password) {
		res, err := s.DB.ExecContext(ctx, `UPDATE newapi_admin SET base_url=?, username=? WHERE id=1`, base, user)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return errors.New("首次保存必须填写密码")
		}
		return nil
	}
	enc, err := s.Box.Encrypt(password)
	if err != nil {
		return err
	}
	_, err = s.DB.ExecContext(ctx, `INSERT INTO newapi_admin(id,base_url,username,password_enc) VALUES(1,?,?,?)
		ON DUPLICATE KEY UPDATE base_url=VALUES(base_url), username=VALUES(username), password_enc=VALUES(password_enc)`, base, user, enc)
	return err
}
