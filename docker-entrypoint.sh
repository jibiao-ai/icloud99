#!/bin/sh
set -e

echo "=========================================="
echo "  元擎智算可视化 - YuanQing AI Viz"
echo "=========================================="

# Wait for MariaDB to be ready
echo "[启动] 等待 MariaDB 就绪..."
MAX_RETRIES=30
RETRY=0
until node -e "
  const mysql = require('mysql2/promise');
  mysql.createConnection({
    host: process.env.DB_HOST || 'db',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'yuanqing',
    password: process.env.DB_PASS || 'yuanqing123',
    database: process.env.DB_NAME || 'yuanqing'
  }).then(c => { c.end(); process.exit(0); }).catch(() => process.exit(1));
" 2>/dev/null; do
  RETRY=$((RETRY + 1))
  if [ "$RETRY" -ge "$MAX_RETRIES" ]; then
    echo "[错误] MariaDB 连接超时！"
    exit 1
  fi
  echo "[等待] MariaDB 未就绪，重试 $RETRY/$MAX_RETRIES ..."
  sleep 2
done
echo "[成功] MariaDB 已连接"

# Run init SQL
echo "[启动] 执行数据库初始化..."
node -e "
  const mysql = require('mysql2/promise');
  const fs = require('fs');
  (async () => {
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST || 'db',
      port: parseInt(process.env.DB_PORT || '3306'),
      user: process.env.DB_USER || 'yuanqing',
      password: process.env.DB_PASS || 'yuanqing123',
      database: process.env.DB_NAME || 'yuanqing',
      multipleStatements: true
    });
    const sql = fs.readFileSync('/app/init.sql', 'utf8');
    await conn.query(sql);
    await conn.end();
    console.log('[成功] 数据库表已就绪');
  })().catch(e => { console.error('[警告] 初始化:', e.message); });
"

# Start the app
echo "[启动] 启动服务 (端口: ${PORT:-3000})..."
exec node dist/server.js
