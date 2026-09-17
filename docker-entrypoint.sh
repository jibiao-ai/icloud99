#!/bin/sh
set -e

echo "=========================================="
echo "  元擎智算可视化 - YuanQing AI Viz"
echo "=========================================="

# 执行数据库迁移
echo "[启动] 执行数据库迁移..."
npx wrangler d1 migrations apply yuanqing-db --local 2>&1 || echo "[警告] 迁移已执行或无新迁移"

# 启动 wrangler 本地开发服务器
echo "[启动] 启动服务 (端口: ${PORT:-3000})..."
exec npx wrangler pages dev dist \
  --d1=yuanqing-db \
  --local \
  --ip 0.0.0.0 \
  --port "${PORT:-3000}"
