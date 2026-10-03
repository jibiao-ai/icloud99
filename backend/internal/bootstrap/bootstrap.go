// Package bootstrap 启动引导：管理员初始化、旧版明文数据加密迁移（幂等）。
package bootstrap

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"log"
	"strings"

	"icloud99/internal/auth"
	"icloud99/internal/secret"
)

// legacyPlaceholder 旧版 init.sql 内置的占位哈希（旧代码实际接受固定口令，必须强制重置）。
const legacyPlaceholder = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"

func randomPassword() string {
	b := make([]byte, 9)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// Run 执行引导。返回值为自动生成的管理员口令（仅在需要生成时非空，调用方应写入日志一次）。
func Run(ctx context.Context, db *sql.DB, box *secret.Box, adminPassword string) (generated string, err error) {
	generated, err = ensureAdmin(ctx, db, adminPassword)
	if err != nil {
		return "", err
	}
	if err := migrateLegacyKeys(ctx, db, box); err != nil {
		return generated, err
	}
	return generated, nil
}

func ensureAdmin(ctx context.Context, db *sql.DB, envPassword string) (string, error) {
	rows, err := db.QueryContext(ctx, `SELECT id, username, password_hash FROM admin_users`)
	if err != nil {
		return "", err
	}
	type u struct {
		id   int64
		name string
		hash string
	}
	var users []u
	for rows.Next() {
		var x u
		if err := rows.Scan(&x.id, &x.name, &x.hash); err != nil {
			rows.Close()
			return "", err
		}
		users = append(users, x)
	}
	rows.Close()

	generated := ""
	pick := func() string {
		if envPassword != "" {
			return envPassword
		}
		generated = randomPassword()
		return generated
	}
	if len(users) == 0 {
		h, err := auth.HashPassword(pick())
		if err != nil {
			return "", err
		}
		_, err = db.ExecContext(ctx, `INSERT INTO admin_users(username,password_hash) VALUES('admin',?)`, h)
		if generated != "" {
			return generated, err
		}
		return "", err
	}
	for _, x := range users {
		switch {
		case x.hash == legacyPlaceholder:
			// 旧占位哈希：重置为环境变量口令或随机口令
			h, err := auth.HashPassword(pick())
			if err != nil {
				return "", err
			}
			if _, err := db.ExecContext(ctx, `UPDATE admin_users SET password_hash=? WHERE id=?`, h, x.id); err != nil {
				return "", err
			}
			log.Printf("[bootstrap] 用户 %s 使用旧版占位口令，已强制重置", x.name)
		case !strings.HasPrefix(x.hash, "$2"):
			// 旧版明文口令：就地改为 bcrypt
			h, err := auth.HashPassword(x.hash)
			if err != nil {
				return "", err
			}
			if _, err := db.ExecContext(ctx, `UPDATE admin_users SET password_hash=? WHERE id=?`, h, x.id); err != nil {
				return "", err
			}
			log.Printf("[bootstrap] 用户 %s 的明文口令已升级为 bcrypt", x.name)
		}
	}
	return generated, nil
}

type legacyCfg struct {
	URL      string `json:"url"`
	Key      string `json:"key"`
	Username string `json:"username"`
	Password string `json:"password"`
}

// migrateLegacyKeys 把旧版 api_configs.config_json 中的明文密钥加密迁移，并清空明文列。
func migrateLegacyKeys(ctx context.Context, db *sql.DB, box *secret.Box) error {
	var has int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM information_schema.columns
		WHERE table_schema=DATABASE() AND table_name='api_configs' AND column_name='config_json'`).Scan(&has); err != nil || has == 0 {
		return err
	}
	rows, err := db.QueryContext(ctx, `SELECT id, provider, tier, config_json FROM api_configs
		WHERE config_json IS NOT NULL AND config_json <> '' AND (api_key_enc IS NULL OR api_key_enc = '')`)
	if err != nil {
		return err
	}
	type row struct {
		id             int64
		provider, tier string
		raw            string
	}
	var list []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.provider, &r.tier, &r.raw); err != nil {
			rows.Close()
			return err
		}
		list = append(list, r)
	}
	rows.Close()
	for _, r := range list {
		var c legacyCfg
		if json.Unmarshal([]byte(r.raw), &c) != nil {
			continue
		}
		if r.provider == "newapi" && r.tier == "admin" {
			if c.URL == "" || c.Username == "" || c.Password == "" {
				continue
			}
			enc, err := box.Encrypt(c.Password)
			if err != nil {
				return err
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO newapi_admin(id,base_url,username,password_enc) VALUES(1,?,?,?)
				ON DUPLICATE KEY UPDATE base_url=VALUES(base_url), username=VALUES(username), password_enc=VALUES(password_enc)`,
				c.URL, c.Username, enc); err != nil {
				return err
			}
			if _, err := db.ExecContext(ctx, `DELETE FROM api_configs WHERE id=?`, r.id); err != nil {
				return err
			}
			log.Printf("[bootstrap] 已迁移 New API 管理员配置并加密密码")
			continue
		}
		if c.Key == "" {
			continue
		}
		enc, err := box.Encrypt(c.Key)
		if err != nil {
			return err
		}
		if _, err := db.ExecContext(ctx, `UPDATE api_configs SET base_url=?, api_key_enc=?, config_json='' WHERE id=?`, c.URL, enc, r.id); err != nil {
			return err
		}
		log.Printf("[bootstrap] 已加密迁移上游密钥 %s/%s", r.provider, r.tier)
	}
	return nil
}
