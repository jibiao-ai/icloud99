#!/bin/sh
# e2e 前置：重建干净数据库并重启后端，令牌查询地址置空以验证“未配置”分支。
set -e
sudo mariadb -e "DROP DATABASE IF EXISTS cloudwatch; CREATE DATABASE cloudwatch CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
pm2 restart cloudwatch-api >/dev/null 2>&1
for i in 1 2 3 4 5 6 7 8 9 10; do curl -sf localhost:8080/api/health >/dev/null && break; sleep 1; done
sudo mariadb cloudwatch -e "UPDATE settings SET v='' WHERE k='site.token_base_url'"
