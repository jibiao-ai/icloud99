// Package db 连接 MariaDB 并执行内嵌迁移（只增不改，记录于 schema_migrations）。
package db

import (
	"database/sql"
	"embed"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
)

//go:embed migrations/*.sql
var migrationFS embed.FS

// Open 打开连接池（带重试，等待数据库就绪），统一使用 UTC 存储。
func Open(dsn string) (*sql.DB, error) {
	cfg, err := mysql.ParseDSN(dsn)
	if err != nil {
		return nil, fmt.Errorf("解析 CW_DB_DSN 失败: %w", err)
	}
	cfg.ParseTime = true
	cfg.Loc = time.UTC
	cfg.Params = map[string]string{"charset": "utf8mb4", "time_zone": "'+00:00'"}
	conn, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		return nil, err
	}
	conn.SetMaxOpenConns(20)
	conn.SetMaxIdleConns(5)
	conn.SetConnMaxLifetime(30 * time.Minute)
	var last error
	for i := 0; i < 40; i++ {
		if last = conn.Ping(); last == nil {
			return conn, nil
		}
		log.Printf("[db] 等待数据库就绪 (%d/40): %v", i+1, last)
		time.Sleep(2 * time.Second)
	}
	return nil, last
}

// Migrate 按文件名顺序执行未应用的迁移。
func Migrate(dsn string) error {
	cfg, err := mysql.ParseDSN(dsn)
	if err != nil {
		return err
	}
	cfg.MultiStatements = true
	cfg.Loc = time.UTC
	conn, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		return err
	}
	defer conn.Close()
	if _, err := conn.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version VARCHAR(100) NOT NULL PRIMARY KEY,
		applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`); err != nil {
		return err
	}
	entries, err := migrationFS.ReadDir("migrations")
	if err != nil {
		return err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	for _, n := range names {
		var cnt int
		if err := conn.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE version=?`, n).Scan(&cnt); err != nil {
			return err
		}
		if cnt > 0 {
			continue
		}
		body, err := migrationFS.ReadFile("migrations/" + n)
		if err != nil {
			return err
		}
		if _, err := conn.Exec(string(body)); err != nil {
			return fmt.Errorf("迁移 %s 失败: %w", n, err)
		}
		if _, err := conn.Exec(`INSERT INTO schema_migrations(version) VALUES(?)`, n); err != nil {
			return err
		}
		log.Printf("[db] 已执行迁移 %s", n)
	}
	return nil
}
