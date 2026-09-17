# 元擎智算可视化

> 基于 New API (https://api.icloud99.cn) 的 AI 渠道可视化监控平台

## 项目概述

- **名称**: 元擎智算可视化 (YuanQing AI Visualization)
- **目标**: 提供渠道状态监控、GPT 智商雷达、鹈鹕骑行智力检测等功能
- **技术栈**: Hono + TypeScript + Tailwind CSS (CDN) + Cloudflare D1 (SQLite)
- **运行时**: Cloudflare Workers / Wrangler (本地开发)

## 功能模块

### 渠道状态监控（无需登录）
- 支持 OpenAI / Anthropic 双 Provider
- 模型: `gpt-5.6-sol`、`gpt-6-astra`、`gpt-5.6-terra`、`gpt-image-2`、`claude-opus-4-6`、`claude-fable-5`、`claude-opus-4-7`、`claude-opus-4-8`
- 每渠道 60 次检测柱状图（🟢 延迟≤25s & PING≤1.5s / 🟠 中间 / 🔴 延迟≥50s 或 PING≥3s）
- 点击卡片弹窗查看：模型、最新状态、最新延迟、7/15/30 天可用率、7 天平均延迟
- 速度状态：极速 / 较慢 / 拥堵

### 智力检测 · 鹈鹕骑行（查看无需登录，操作需登录）
- Codex Candy Eval 糖果问题测试 + SVG 动画生成
- GPT Chat Completions 生成鹈鹕骑行 SVG 动画（CSS @keyframes）
- 按 Lite / Standard / Ultra 分组检测
- 2 排 × 6 列分页网格，支持首页/尾页/页码跳转
- SVG CSS 作用域隔离（多 SVG 并行渲染无冲突）
- 放大动画预览模态框

### GPT 智商雷达（无需登录）
- 嵌入 IQ Radar 页面实时查看
- 支持亮色 / 暗色主题自动适配

### 管理员设置（需登录）
- 默认账号: `admin` / `admin123`
- 配置 OpenAI / Anthropic 各分组（Lite / Standard / Ultra）API 密钥
- 种子数据初始化（24 个检测渠道）
- 密码修改

### 权限控制
- 未登录用户：「立即检测」「Lite」「Standard」「Ultra」按钮禁用显示锁图标
- 点击提示登录并自动跳转到登录页面

## API 入口

| 路径 | 方法 | 描述 | 登录 |
|------|------|------|------|
| `/api/health` | GET | 健康检查 | 否 |
| `/api/channels?range=7` | GET | 渠道状态列表 | 否 |
| `/api/channels/:id/detail` | GET | 渠道详情（7/15/30 天统计） | 否 |
| `/api/iq-tests-paged?page=1&pageSize=12` | GET | 智力检测分页查询 | 否 |
| `/api/iq-tests/stats` | GET | 智力检测统计 | 否 |
| `/api/test-channels` | POST | 批量检测所有渠道 | 否 |
| `/api/run-iq-test` | POST | 运行单次智力检测 | 否 |
| `/api/login` | POST | 管理员登录 | 否 |
| `/api/admin/configs` | GET/POST | 管理 API 配置 | 是 |
| `/api/admin/configs/:id` | DELETE | 删除 API 配置 | 是 |
| `/api/admin/seed` | POST | 初始化种子数据 | 是 |
| `/api/admin/change-password` | POST | 修改密码 | 是 |

## 数据架构

**数据库**: Cloudflare D1 (SQLite)，本地开发使用 `wrangler --local` 模式自动创建 `.wrangler/state/v3/d1/` 下的 SQLite 文件。

| 表名 | 描述 |
|------|------|
| `admin_users` | 管理员用户 |
| `api_configs` | API 密钥配置（provider + tier 唯一约束） |
| `channels` | 渠道信息（名称、模型、图标、倍率） |
| `channel_tests` | 渠道检测结果（延迟、PING、成功状态） |
| `iq_tests` | 智力检测结果（含 svg_code 列存储 SVG 动画） |

**迁移文件**:
```
migrations/
├── 0001_initial.sql        # 基础表结构 + 默认管理员
├── 0002_add_tier.sql       # channels 添加 tier 字段
├── 0003_add_image_url.sql  # iq_tests 添加 image_url 字段
└── 0004_add_svg_code.sql   # iq_tests 添加 svg_code 字段
```

## 项目结构

```
yuanqing-ai-viz/
├── src/
│   └── index.tsx            # Hono 后端（路由、API、SVG 生成）
├── public/
│   └── static/
│       ├── app.js           # 前端 SPA（vanilla JS）
│       └── logo.png         # 品牌 Logo
├── migrations/              # D1 数据库迁移文件
├── dist/                    # 构建输出（vite build）
├── package.json             # 依赖和脚本
├── vite.config.ts           # Vite 构建配置
├── wrangler.jsonc           # Cloudflare Workers 配置
├── ecosystem.config.cjs     # PM2 进程管理配置
├── Dockerfile               # Docker 容器构建
└── docker-compose.yml       # Docker Compose 编排
```

---

## 部署指南

### 方式一：Docker 部署（推荐）

#### 前置要求

- Docker >= 20.10
- Docker Compose >= 2.0

#### 1. 克隆仓库

```bash
git clone https://github.com/jibiao-ai/icloud99.git
cd icloud99
```

#### 2. 使用 Docker Compose 一键启动

```bash
docker compose up -d
```

服务将在 `http://localhost:3000` 启动。

#### 3. 初始化数据库

容器首次启动时会自动执行数据库迁移。如需手动初始化种子数据：

1. 打开浏览器访问 `http://localhost:3000`
2. 点击左侧菜单「管理设置」
3. 使用默认账号登录：`admin` / `admin123`
4. 点击「初始化数据」按钮

#### 4. 配置 API 密钥

在管理设置中为各分组配置 New API 密钥：

- **API URL**: `https://api.icloud99.cn`
- **API Key**: 你的 `sk-xxxxxxxx` 令牌

#### 5. 常用命令

```bash
# 启动服务（后台运行）
docker compose up -d

# 查看日志
docker compose logs -f

# 停止服务
docker compose down

# 重新构建并启动（代码更新后）
docker compose up -d --build

# 进入容器调试
docker compose exec app sh

# 查看数据库
docker compose exec app cat /app/.wrangler/state/v3/d1/*.sqlite
```

#### 6. 数据持久化

Docker Compose 配置中已挂载数据卷 `yuanqing-d1-data`，数据库文件持久存储在 Docker volume 中，容器重启不会丢失数据。

```bash
# 查看数据卷
docker volume ls | grep yuanqing

# 备份数据库
docker compose exec app sh -c "cp -r /app/.wrangler/state/v3/d1 /tmp/d1-backup"
docker cp $(docker compose ps -q app):/tmp/d1-backup ./d1-backup
```

#### 7. 自定义配置

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `PORT` | `3000` | 服务端口 |
| `NODE_ENV` | `production` | 运行环境 |

修改端口映射，编辑 `docker-compose.yml`：

```yaml
ports:
  - "8080:3000"   # 将外部 8080 映射到容器内 3000
```

#### 8. 不使用 Docker Compose（纯 Docker）

```bash
# 构建镜像
docker build -t yuanqing-ai-viz .

# 运行容器
docker run -d \
  --name yuanqing-ai \
  -p 3000:3000 \
  -v yuanqing-d1-data:/app/.wrangler/state/v3/d1 \
  --restart unless-stopped \
  yuanqing-ai-viz

# 查看日志
docker logs -f yuanqing-ai
```

---

### 方式二：本地开发（非 Docker）

#### 前置要求

- Node.js >= 18
- npm >= 9

#### 1. 安装依赖

```bash
git clone https://github.com/jibiao-ai/icloud99.git
cd icloud99
npm install
```

#### 2. 初始化数据库

```bash
# 执行迁移（本地 SQLite）
npm run db:migrate:local
```

#### 3. 构建并启动

```bash
# 构建前端
npm run build

# 启动本地开发服务器
npm run dev:sandbox
```

访问 `http://localhost:3000`。

#### 4. 可用脚本

```bash
npm run build             # 构建项目
npm run dev               # Vite 开发服务器
npm run dev:sandbox       # Wrangler 本地开发（含 D1）
npm run db:migrate:local  # 执行数据库迁移
npm run db:reset          # 重置数据库（清空后重新迁移）
```

---

### 方式三：Cloudflare Pages 部署

#### 1. 创建 D1 数据库

```bash
npx wrangler d1 create yuanqing-db
```

将输出的 `database_id` 填入 `wrangler.jsonc`。

#### 2. 执行迁移

```bash
npx wrangler d1 migrations apply yuanqing-db
```

#### 3. 部署

```bash
npm run build
npx wrangler pages deploy dist --project-name yuanqing-ai-viz
```

---

## 使用指南

### 首次使用

1. 访问网站首页
2. 点击左侧「管理设置」
3. 使用 `admin` / `admin123` 登录
4. 点击「初始化数据」生成 24 个检测渠道
5. 为 OpenAI 各分组配置 API 密钥（URL: `https://api.icloud99.cn`，Key: `sk-xxx`）
6. 返回「渠道状态」查看监控面板
7. 进入「智力检测」运行鹈鹕骑行测试

### 定时检测

可通过外部定时任务（cron）调用接口实现自动检测：

```bash
# 每小时检测渠道状态
0 * * * * curl -s -X POST http://localhost:3000/api/test-channels

# 每3小时运行智力检测（Lite → Standard → Ultra 轮转）
0 0,3,6,9,12,15,18,21 * * * curl -s -X POST http://localhost:3000/api/run-iq-test \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.6-sol","tier":"lite","provider":"openai"}'
```

## 部署状态

- **平台**: Cloudflare Pages / Docker
- **状态**: ✅ Active
- **技术栈**: Hono + TypeScript + Tailwind CSS + D1 (SQLite)
- **GitHub**: https://github.com/jibiao-ai/icloud99
- **最后更新**: 2026-09-17
