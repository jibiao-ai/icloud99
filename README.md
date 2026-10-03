# 元擎智算可视化 v3（按 开发规范 重写）

New API（api.icloud99.cn）AI 渠道可视化监控平台：渠道状态、智力检测、令牌用量查询、全站用户账单统计。

## 技术栈（规范锁定）
- 前端：React 18 + Vite 5 + Tailwind 3（JSX）、recharts、zustand 单一 store、axios 单一出口 `services/api.js`、lucide-react
- 后端：Go 1.22 仅标准库 `net/http`（ServeMux 方法路由）+ `database/sql` + MariaDB、bcrypt、excelize
- 部署：docker compose（`icloud99-web` nginx :80 → `icloud99-backend` :8080 → `icloud99-db`）
- 迁移：`backend/internal/db/migrations/NNNN_*.sql`，embed，启动自动执行，只增不改

## 第 1 轮：按规范整体重写
**做了什么**
- Node/Hono + 原生 JS 全量替换为 Go + React；功能保持：渠道状态、智力检测、令牌用量查询、用量统计与 Excel 导出、联系我们、管理设置、审计日志。
- 铁律：`npm run lint:rules` 扫描 11 类违规（已用故意违规文件验证可拦截 13 处）；自绘 CustomSelect / DatePicker / Checkbox / Radio / ConfirmModal / Toast。
- 业务参数全部页面录入并落库（上游密钥、New API 账号、检测间隔、主题色、雷达地址、额度换算…）；环境变量仅 `ICLOUD99_ADDR / ICLOUD99_DB_DSN / ICLOUD99_SECRET_KEY / ICLOUD99_ADMIN_PASSWORD`。
- 权限码 `module:action` + `guard`；匿名可访问公开页，管理操作需登录；所有写操作与导出写审计，详情递归脱敏。
- 渠道检测改为**服务端后台任务**（原先依赖浏览器常开），可停止、刷新页面不中断。

**修复的原有安全问题**
- 管理员口令原为明文比对 + 固定后门口令 `admin123`：改为 bcrypt；旧占位哈希启动时强制重置；登录失败限流；令牌改为 HMAC-SHA256 签名（原先无签名、可伪造）。
- 上游密钥/New API 密码 AES-GCM 加密落库，界面保存后只显示 `******`。旧库中的明文在首次启动时自动加密迁移并清空。
- SVG 在 sandbox iframe 渲染（禁脚本），替代原先的正则改写。

## 接口
`GET /api/health` · `POST /api/auth/login` · `GET /api/auth/me` · `GET /api/public/portal-info`
`GET /api/channels` · `GET /api/channels/{id}/detail` · `POST /api/channels/test/{start|stop}` · `GET /api/channels/test/status` · `POST /api/channels/{seed|cleanup}`
`GET /api/iq/{tests|stats|schedule}` · `POST /api/iq/run` · `POST /api/token-usage/query`
`GET /api/usage/{summary|export}` · `GET /api/usage/user/{name}[/logs]`
`GET|PUT /api/settings` · `GET|PUT /api/settings/channel-keys` · `GET|PUT /api/settings/newapi` · `POST /api/settings/newapi/test` · `POST /api/settings/password` · `GET /api/audit-logs`
统一信封 `{code,message,data}`；字段校验失败 HTTP 400 / code 40001 / `data.fields`；未配置 code 40002。

## 部署
```bash
cp .env.example .env   # 填 ICLOUD99_DB_ROOT_PASSWORD / ICLOUD99_DB_PASSWORD / ICLOUD99_SECRET_KEY（openssl rand -hex 32）
docker compose up -d --build
docker logs icloud99-backend   # ICLOUD99_ADMIN_PASSWORD 留空时，首次生成的 admin 口令在此
```
访问 `http://<服务器>（80 端口）`，登录后在「管理设置」依次配置：API 密钥 → 系统参数 → New API → 点「初始化渠道」。
从旧版升级：保留原数据库，改用新 compose；首次启动自动迁移，**管理员口令会被重置**（见日志）。

## 验证
- 后端：`gofmt` / `go vet` / `go test ./...` 全部通过（secret、auth、newapi、usage、iq、monitor、tokenq、httpx、api 校验）。
- 旧库升级已在真实 MariaDB 上实测。
- 用量统计已用真实 New API 做过对账探测（日期范围内与 `/api/log/stat` 偏差 0.48%，触发了逐用户校正回退，最终对账一致）。
- e2e（`e2e/run.mjs`，Playwright + 假 New API）：69 项断言中 68 项通过，见下方“已知问题”。

## 已知问题 / 未完成
- e2e 唯一未过：导出 Excel 时 Playwright 读到的下载文件名为 `download`（后端与反代响应头 `Content-Disposition` 已确认正确，前端 `services/http.js` 解析逻辑待排查；文件本身可正常生成）。
- 未做：Go 的 handler/DB 层集成测试（仅覆盖纯逻辑）；远程服务器部署与验证（未执行，见下）。
- 前端打包体积 ~767KB（recharts），可按路由拆包。
