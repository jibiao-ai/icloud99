# 元擎智算可视化

## 项目概述
- **名称**: 元擎智算可视化 (YuanQing AI Visualization)
- **目标**: 基于 New API 的可视化监控平台，提供渠道状态监控、GPT智商雷达、智力检测等功能
- **技术栈**: Hono + TypeScript + Tailwind CSS + Cloudflare D1

## 功能模块

### 0. 管理员设置（需登录）
- 管理员登录（默认账号: admin / admin123）
- 配置 OpenAI / Anthropic 的 Lite、Standard、Ultra 分组令牌密钥
- 密钥格式: `{"_type":"newapi_channel_conn","key":"sk-xxx","url":"https://api.icloud99.cn"}`
- 渠道管理（CRUD）
- 种子数据初始化

### 1. GPT智商雷达（无需登录）
- 嵌入 IQ Radar 页面实时查看
- 支持亮色/暗色主题自动适配
- 可新窗口打开完整版

### 2. 智力检测（无需登录）
- 鹦鹉骑行 (Codex Candy Eval) 糖果问题测试
- 对 Lite / Standard / Ultra 分组分别测试
- 测试模型: gpt-5.6-sol、gpt-6-astra
- 每3小时自动检测（通过定时调用API）
- 结果分类: 智力通过 / 可以作品 / 降智记录
- 统计看板 + 历史记录表格

### 3. 渠道状态监控（无需登录）
- 参考 New API 渠道检测逻辑
- 每15分钟自动检测上游渠道
- 显示：对话延迟、端点PING、成功率
- 60次检测历史条形图（绿色=正常/红色=失败）
- 按 OpenAI / Anthropic / 国产模型 分组展示
- 7天 / 15天 / 30天 时间范围筛选
- 总体状态: OPERATIONAL / DEGRADED / OUTAGE

## 入口URI
| 路径 | 描述 | 登录要求 |
|------|------|---------|
| `/` | 首页（渠道状态） | 否 |
| `/api/health` | 健康检查 | 否 |
| `/api/channels?range=7` | 获取渠道状态 | 否 |
| `/api/iq-tests?model=&tier=` | 获取智力检测结果 | 否 |
| `/api/iq-tests/stats` | 智力检测统计 | 否 |
| `/api/test-all-channels` | 批量检测所有渠道 | 否 |
| `/api/run-iq-test` | 运行单次智力检测 | 否 |
| `/api/login` | 管理员登录 | 否 |
| `/api/admin/configs` | 管理API配置 | 是 |
| `/api/admin/channels` | 管理渠道 | 是 |
| `/api/admin/seed` | 初始化种子数据 | 是 |

## 数据架构
- **数据库**: Cloudflare D1 (SQLite)
- **表结构**:
  - `admin_users` - 管理员用户
  - `api_configs` - API密钥配置（provider + tier 唯一）
  - `channels` - 渠道信息
  - `channel_tests` - 渠道检测结果
  - `iq_tests` - 智力检测结果

## 使用指南

### 首次使用
1. 打开网站，点击左侧"管理设置"
2. 使用 admin / admin123 登录
3. 点击"初始化种子数据"生成示例渠道和检测数据
4. 配置各分组的 API 密钥
5. 返回"渠道状态"查看监控面板

### 配置API密钥
在管理设置中，为每个分组配置：
```json
{"_type":"newapi_channel_conn","key":"sk-xxx","url":"https://api.icloud99.cn"}
```

### 定时检测
- 渠道检测: POST `/api/test-all-channels` (每15分钟)
- 智力检测: POST `/api/run-iq-test` (每3小时)
- 可通过外部定时任务（cron）调用这些接口

## 部署
- **平台**: Cloudflare Pages
- **状态**: ✅ 开发中
- **最后更新**: 2026-09-16
