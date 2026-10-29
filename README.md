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
`GET /api/iq/{tests|stats|schedule|run/status}` · `POST /api/iq/run`（后台异步、流式调用上游并自动重试的鹈鹕骑行 SVG 动画检测；上游故障不记为降智，约 2~5 分钟，页面轮询状态；失败原因写入审计日志与检测记录）· `POST /api/token-usage/query`
`GET /api/usage/{summary|export}` · `GET /api/usage/user/{name}[/logs]`
`GET /api/bill/accounts` · `GET /api/bill/draft?account=&months=2026-08,2026-09` · `POST /api/bill/export`（**仅管理员**，权限 `bill:export`：用量统计页「导出账单 PDF」，选账号与月份生成草稿，可在线修改标题/公司名/账号/各月起止日期/费用总额/优惠/明细行/备注，再由服务端渲染 A4 PDF，含元擎智算 logo、每月开始与截止日期、金额；字体与 logo 通过 `go:embed` 内置，生产镜像无需系统字体）
`GET /api/detail/accounts` · `POST /api/detail/export`（body：`start,end,users[],rowsPerFile`）· `GET /api/detail/export/status` · `POST /api/detail/export/cancel` · `GET /api/detail/export/download?file=<name>|all`（**仅管理员**，权限 `detail:export`：菜单「使用明细导出」。按周期导出全站（或指定 ≤50 个）用户的调用明细为 Excel，列与格式同《Token账单_含明细.xlsx》（21 列、微软雅黑表头、时间升序、sheet 如「09月明细」）。**本地库 + 分段策略**：导出不再实时全量拉取上游，而是先把缺少的天同步到本地库（见下），再从本地库流式写 Excel；同步某一天时按北京时间自然日 × 用户切段，先取首页得到段内总数，超过 5000 条则按时间二分直到不超限，再逐页（100/页）拉取，按日志 id 去重、段间并发 3、失败重试、全程按时间有序合并；写入前按本地库行数校验，超过 200 万行直接拒绝。Excel 以流式写入（内存与行数无关），每文件默认 30 万行自动拆分，多文件下载为 zip。后台任务，同一时间仅 1 个，可取消，页面可断线恢复进度，文件保留 2 小时，完成后写审计）
`GET /api/detail/local`（**仅管理员**，`detail:export`：本地明细库概况 + 后台预同步状态 + 上游限流状态）

**使用明细本地库（修复导出被 429 限流而失败）**
- 表：`usage_logs`（按 `log_id` 幂等 upsert，索引 `(created_at,log_id)` / `(username,created_at,log_id)`）、`usage_log_days`（每个北京时间自然日一条同步水位 `synced_until`，水位 >= 当日 23:59:59 即视为该日完整；迁移 `0005_usage_logs.sql`）。
- 后台预同步：调度器每分钟检查，默认每 30 分钟把「最近 3 天（含今天）」同步到本地库；已完整的天直接跳过，当天只做增量（向前回溯 300 秒，重复无害）；刚结束的一天留 300 秒窗口等延迟写入的日志，下一轮再标记完整。
- 手动导出：先同步所选周期里本地库缺少的天（按天串行、每天完成立即记水位），再从本地库读取。因此导出中途失败/取消后，已同步的天保留，重试只补剩余的天；同一周期再次导出不再请求上游。
- 全局限速器：所有上游明细请求共用，默认 45 次/分钟（可配）；命中 429 时全局暂停（优先用 `Retry-After`，否则 15 秒起指数退避、最长 3 分钟），并临时降速，连续成功后恢复；单个请求持续被限流超过 45 分钟才放弃，且错误信息会提示「已同步的天已保存，重试只补剩余」。New API 客户端对此类请求关闭内部 429 重试（`newapi.NoRateRetry`），由限速器统一决定等待。
- 同步闸门：后台预同步与手动导出共用，同一时刻只有一个任务访问上游；手动导出会先让后台预同步让路。
- 设置（管理设置 → 系统参数 → 使用明细本地库）：`detail.sync_enabled`、`detail.sync_interval_minutes`（5~1440）、`detail.sync_days`（1~31）、`detail.retention_days`（7~730，超期自动清理）、`detail.rate_limit`（5~300 次/分钟）。
- 页面：导出页顶部「本地明细库」卡片（已存条数/天数/范围、后台同步状态、限速与累计限流次数）；导出进度分「同步到本地库」「从本地库写入 Excel」两个阶段，遇限流显示暂停倒计时。
- 首次导出较早周期需要先把对应天数同步进来，耗时取决于数据量与上游限速；建议先用较短周期试一次。
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
- e2e（`e2e/run.mjs`，Playwright + 假 New API）：全部断言通过（含渠道每组 4 卡同一行、周期下拉六个预设）。
- 用量统计防强刷：同一周期手动刷新冷却 10 分钟、全站手动刷新冷却 2 分钟，冷却期内只返回缓存（`meta.refreshDenied`），不触达上游；缓存 15 分钟（含今天）/ 6 小时（纯历史）。

## 已知问题 / 未完成
- 导出 Excel：无头 Chromium 对 blob 下载的中文文件名会回退为 `download`，真实浏览器不受影响（前端解析出的文件名已在 Toast 中断言）。
- 未做：Go 的 handler/DB 层集成测试（仅覆盖纯逻辑）；远程服务器部署与验证（未执行，见下）。
- 前端打包体积 ~767KB（recharts），可按路由拆包。
