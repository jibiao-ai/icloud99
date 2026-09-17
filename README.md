# 元擎智算可视化

> 基于 New API (https://api.icloud99.cn) 的 AI 渠道可视化监控平台

## 项目概述

- **名称**: 元擎智算可视化 (YuanQing AI Visualization)
- **目标**: 提供渠道状态监控、GPT 智商雷达、鹈鹕骑行智力检测等功能
- **技术栈**: Hono + Node.js + TypeScript + Tailwind CSS (CDN) + **MariaDB**
- **运行时**: Node.js + @hono/node-server + mysql2

## 功能模块

### 渠道状态监控（无需登录）
- 支持 OpenAI / Anthropic 双 Provider Tab 切换
- 模型: `gpt-5.6-sol`、`gpt-6-astra`、`gpt-5.6-terra`、`gpt-image-2`、`claude-opus-4-6`、`claude-fable-5`、`claude-opus-4-7`、`claude-opus-4-8`
- 每 Provider 12 个渠道（4 模型 × 3 分组），分页显示
- 每渠道 60 次检测柱状图（🟢 / 🟠 / 🔴）
- 点击卡片弹窗：7/15/30 天可用率

### 智力检测 · 鹈鹕骑行（操作需登录）
- Codex Candy Eval + SVG 动画生成
- 2 排 × 6 列分页网格
- SVG CSS 作用域隔离

### 权限控制
- 未登录用户：检测按钮禁用

## 项目结构

```
yuanqing-ai-viz/
├── src/
│   ├── index.tsx            # Hono 路由 + mysql2 数据库层
│   └── server.ts            # Node.js 启动入口
├── public/static/
│   ├── app.js               # 前端 SPA
│   └── logo.png             # Logo
├── dist/                    # TypeScript 编译输出
├── init.sql                 # MariaDB 建表脚本
├── package.json
├── tsconfig.json
├── Dockerfile
├── docker-compose.yml       # MariaDB + App + Nginx
├── nginx.conf
└── docker-entrypoint.sh     # 等待DB就绪+自动建表+启动
```

---

## 部署指南

### 方式一：Docker 部署（推荐）

**架构**: Nginx (80/443) → App (Node.js:3000) → MariaDB (3306)

```
┌─────────────────────────────────────────────┐
│  Docker Compose                              │
│                                              │
│  ┌──────────┐  proxy  ┌──────┐  sql  ┌────┐ │
│  │  Nginx   │ ──────→ │ App  │ ────→ │ DB │ │
│  │ :80/:443 │         │:3000 │       │:3306│ │
│  └──────────┘         └──────┘       └────┘ │
│       ↑                                 ↓    │
│   外部访问              yuanqing-mariadb-data │
└─────────────────────────────────────────────┘
```

#### 前置要求

- Docker >= 20.10
- Docker Compose >= 2.0

#### 1. 克隆 & 启动

```bash
git clone https://github.com/jibiao-ai/icloud99.git
cd icloud99
docker compose up -d
```

服务启动后访问：`http://<服务器IP>`（端口 80）

MariaDB 首次启动自动执行 `init.sql` 建表 + 插入默认管理员。

#### 2. 初始化渠道数据

1. 浏览器访问 `http://<服务器IP>`
2. 左侧「管理设置」→ 登录 `admin` / `admin123`
3. 点击「初始化数据」

#### 3. 启用 HTTPS（可选）

```bash
mkdir -p certs
# 放入 fullchain.pem 和 privkey.pem
# 编辑 nginx.conf 取消 HTTPS server 块的注释
docker compose restart nginx
```

#### 4. 常用命令

```bash
docker compose up -d              # 启动
docker compose logs -f app        # 应用日志
docker compose logs -f db         # 数据库日志
docker compose down               # 停止
docker compose up -d --build      # 代码更新后重新构建

# 进入 MariaDB
docker compose exec db mariadb -uyuanqing -pyuanqing123 yuanqing

# 备份数据库
docker compose exec db mariadb-dump -uyuanqing -pyuanqing123 yuanqing > backup.sql

# 恢复数据库
docker compose exec -T db mariadb -uyuanqing -pyuanqing123 yuanqing < backup.sql
```

#### 5. 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DB_HOST` | `db` | MariaDB 主机 |
| `DB_PORT` | `3306` | MariaDB 端口 |
| `DB_USER` | `yuanqing` | 数据库用户 |
| `DB_PASS` | `yuanqing123` | 数据库密码 |
| `DB_NAME` | `yuanqing` | 数据库名 |
| `PORT` | `3000` | App 端口 |

#### 6. 纯 Docker（不用 Compose）

```bash
# 启动 MariaDB
docker run -d --name yuanqing-db \
  -e MARIADB_ROOT_PASSWORD=rootpass123 \
  -e MARIADB_DATABASE=yuanqing \
  -e MARIADB_USER=yuanqing \
  -e MARIADB_PASSWORD=yuanqing123 \
  -v yuanqing-mariadb-data:/var/lib/mysql \
  -v $(pwd)/init.sql:/docker-entrypoint-initdb.d/init.sql:ro \
  mariadb:11

# 构建 & 启动 App
docker build -t yuanqing-ai-viz .
docker run -d --name yuanqing-ai \
  --link yuanqing-db:db \
  -e DB_HOST=db \
  yuanqing-ai-viz

# 启动 Nginx
docker run -d --name yuanqing-nginx \
  -p 80:80 -p 443:443 \
  -v $(pwd)/nginx.conf:/etc/nginx/conf.d/default.conf:ro \
  --link yuanqing-ai:app \
  nginx:alpine
```

---

### 方式二：本地开发

```bash
# 1. 安装 MariaDB 并创建数据库
mysql -u root -e "CREATE DATABASE yuanqing; CREATE USER 'yuanqing'@'%' IDENTIFIED BY 'yuanqing123'; GRANT ALL ON yuanqing.* TO 'yuanqing'@'%';"
mysql -u yuanqing -pyuanqing123 yuanqing < init.sql

# 2. 安装依赖 & 构建
npm install
npm run build

# 3. 启动
DB_HOST=127.0.0.1 npm start
```

访问 `http://localhost:3000`

---

## 部署状态

- **数据库**: MariaDB 11
- **对外端口**: 80 (HTTP) / 443 (HTTPS)
- **技术栈**: Hono + Node.js + TypeScript + MariaDB
- **GitHub**: https://github.com/jibiao-ai/icloud99
- **最后更新**: 2026-09-17
