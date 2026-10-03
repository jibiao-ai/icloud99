// 元擎智算可视化后端入口。仅读取 ICLOUD99_ADDR / ICLOUD99_DB_DSN / ICLOUD99_SECRET_KEY / ICLOUD99_ADMIN_PASSWORD 四个启动引导变量。
package main

import (
	"context"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"icloud99/internal/api"
	"icloud99/internal/audit"
	"icloud99/internal/auth"
	"icloud99/internal/bootstrap"
	"icloud99/internal/config"
	"icloud99/internal/db"
	"icloud99/internal/monitor"
	"icloud99/internal/newapi"
	"icloud99/internal/secret"
	"icloud99/internal/store"
	"icloud99/internal/usage"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("配置错误: %v", err)
	}
	conn, err := db.Open(cfg.DSN)
	if err != nil {
		log.Fatalf("数据库连接失败: %v", err)
	}
	defer conn.Close()
	if err := db.Migrate(cfg.DSN); err != nil {
		log.Fatalf("数据库迁移失败: %v", err)
	}
	box, err := secret.New(cfg.SecretKey)
	if err != nil {
		log.Fatalf("初始化加密失败: %v", err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	gen, err := bootstrap.Run(ctx, conn, box, cfg.AdminPassword)
	if err != nil {
		log.Fatalf("启动引导失败: %v", err)
	}
	if gen != "" {
		log.Printf("============================================================")
		log.Printf(" 已生成管理员初始口令（仅显示一次，请立即登录并修改）")
		log.Printf("   用户名: admin    密码: %s", gen)
		log.Printf("============================================================")
	}
	if n, err := bootstrap.SeedChannels(ctx, conn); err != nil {
		log.Printf("[seed] 渠道目录初始化失败: %v", err)
	} else if n > 0 {
		log.Printf("[seed] 已补齐 %d 个渠道", n)
	}

	st := &store.Store{DB: conn, Box: box}
	hc := &http.Client{Timeout: 200 * time.Second}
	na := newapi.New()
	srv := &api.Server{
		DB: conn, Store: st, Signer: auth.NewSigner(cfg.SecretKey), Audit: &audit.Recorder{DB: conn},
		Runner: &monitor.Runner{DB: conn, Store: st, HTTP: hc}, NewAPI: na, Usage: usage.NewService(na),
		Limiter: auth.NewLimiter(8, 10*time.Minute), HTTP: hc, CST: usage.CST,
	}
	srv.StartScheduler(ctx)

	hs := &http.Server{Addr: cfg.Addr, Handler: srv.Handler(), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 2 * time.Minute}
	go func() {
		<-ctx.Done()
		sctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = hs.Shutdown(sctx)
	}()
	log.Printf("服务已启动，监听 %s", cfg.Addr)
	if err := hs.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("服务异常退出: %v", err)
	}
}
