// Package config 仅承载启动引导参数（铁律1：业务参数一律在页面录入并落库）。
package config

import (
	"fmt"
	"os"
)

// Config 启动引导配置，全部来自环境变量。
type Config struct {
	Addr          string // CW_ADDR 监听地址
	DSN           string // CW_DB_DSN MariaDB 连接串
	SecretKey     string // CW_SECRET_KEY 加密/签名主密钥
	AdminPassword string // CW_ADMIN_PASSWORD 首次初始化管理员密码
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// Load 读取环境变量，缺失关键项时返回错误。
func Load() (*Config, error) {
	c := &Config{
		Addr:          env("CW_ADDR", ":8080"),
		DSN:           env("CW_DB_DSN", ""),
		SecretKey:     env("CW_SECRET_KEY", ""),
		AdminPassword: env("CW_ADMIN_PASSWORD", ""),
	}
	if c.DSN == "" {
		return nil, fmt.Errorf("缺少环境变量 CW_DB_DSN")
	}
	if len(c.SecretKey) < 16 {
		return nil, fmt.Errorf("CW_SECRET_KEY 至少 16 个字符")
	}
	return c, nil
}
