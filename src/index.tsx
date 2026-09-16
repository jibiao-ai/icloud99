import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Bindings = {
  DB: D1Database
}

type Variables = {
  user?: { id: number; username: string }
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

app.use('/api/*', cors())

// ===== 工具函数 =====
function hashPassword(password: string): string {
  // 简单hash用于Cloudflare Workers (不支持bcrypt)
  // 生产环境应使用Web Crypto API
  let hash = 0
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return 'hash_' + Math.abs(hash).toString(36)
}

async function createToken(payload: object): Promise<string> {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = btoa(JSON.stringify({ ...payload, exp: Date.now() + 86400000 }))
  return `${header}.${body}.signature`
}

function verifyToken(token: string): any {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(atob(parts[1]))
    if (payload.exp && payload.exp < Date.now()) return null
    return payload
  } catch { return null }
}

// ===== 认证中间件 =====
async function authMiddleware(c: any, next: any) {
  const auth = c.req.header('Authorization')
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ code: -1, message: '未授权' }, 401)
  }
  const payload = verifyToken(auth.substring(7))
  if (!payload) {
    return c.json({ code: -1, message: 'Token无效或已过期' }, 401)
  }
  c.set('user', payload)
  await next()
}

// ===== 公开API =====

// 健康检查
app.get('/api/health', (c) => c.json({ code: 0, message: 'ok' }))

// 管理员登录
app.post('/api/login', async (c) => {
  const { username, password } = await c.req.json()
  if (!username || !password) {
    return c.json({ code: -1, message: '用户名和密码不能为空' }, 400)
  }
  // 简单验证: admin / admin123
  if (username === 'admin' && password === 'admin123') {
    const token = await createToken({ id: 1, username: 'admin' })
    return c.json({ code: 0, data: { token, user: { id: 1, username: 'admin' } } })
  }
  return c.json({ code: -1, message: '用户名或密码错误' }, 401)
})

// ===== 公开查看接口 (无需登录) =====

// 获取所有渠道及最新状态
app.get('/api/channels', async (c) => {
  const db = c.env.DB
  const timeRange = c.req.query('range') || '7'
  const days = parseInt(timeRange)
  const since = new Date(Date.now() - days * 86400000).toISOString()

  const channels = await db.prepare(
    'SELECT * FROM channels WHERE is_active = 1 ORDER BY provider, sort_order'
  ).all()

  const results = []
  for (const ch of channels.results || []) {
    // 获取最新60次检测
    const tests = await db.prepare(
      'SELECT * FROM channel_tests WHERE channel_id = ? AND tested_at > ? ORDER BY tested_at DESC LIMIT 60'
    ).bind(ch.id, since).all()

    const testResults = tests.results || []
    const successCount = testResults.filter((t: any) => t.success === 1).length
    const totalTests = testResults.length
    const successRate = totalTests > 0 ? Math.round((successCount / totalTests) * 100) : 0

    const latestTest = testResults[0] || null

    results.push({
      ...ch,
      latest_test: latestTest,
      success_rate: successRate,
      total_tests: totalTests,
      history: testResults.reverse().map((t: any) => ({
        time: t.tested_at,
        response_time: t.response_time_ms,
        success: t.success,
        ping: t.ping_ms
      }))
    })
  }

  return c.json({ code: 0, data: results })
})

// 获取智力检测结果
app.get('/api/iq-tests', async (c) => {
  const db = c.env.DB
  const model = c.req.query('model') || ''
  const tier = c.req.query('tier') || ''
  const testType = c.req.query('test_type') || ''
  const page = parseInt(c.req.query('page') || '1')
  const limit = parseInt(c.req.query('limit') || '50')

  let sql = 'SELECT * FROM iq_tests WHERE 1=1'
  const params: any[] = []

  if (model) { sql += ' AND model = ?'; params.push(model) }
  if (tier) { sql += ' AND tier = ?'; params.push(tier) }
  if (testType) { sql += ' AND test_type = ?'; params.push(testType) }

  const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total')
  const countResult = await db.prepare(countSql).bind(...params).first<{ total: number }>()

  sql += ' ORDER BY tested_at DESC LIMIT ? OFFSET ?'
  params.push(limit, (page - 1) * limit)

  const results = await db.prepare(sql).bind(...params).all()

  return c.json({
    code: 0,
    data: results.results || [],
    total: countResult?.total || 0,
    page
  })
})

// 获取智力检测统计
app.get('/api/iq-tests/stats', async (c) => {
  const db = c.env.DB
  const stats = await db.prepare(`
    SELECT model, tier, test_type, result, COUNT(*) as count
    FROM iq_tests
    GROUP BY model, tier, test_type, result
    ORDER BY model, tier
  `).all()

  return c.json({ code: 0, data: stats.results || [] })
})

// ===== 管理员接口 =====

// 获取API配置
app.get('/api/admin/configs', authMiddleware, async (c) => {
  const db = c.env.DB
  const configs = await db.prepare('SELECT * FROM api_configs ORDER BY provider, tier').all()
  return c.json({ code: 0, data: configs.results || [] })
})

// 保存API配置
app.post('/api/admin/configs', authMiddleware, async (c) => {
  const db = c.env.DB
  const { provider, tier, config_json } = await c.req.json()

  if (!provider || !tier || !config_json) {
    return c.json({ code: -1, message: '参数不完整' }, 400)
  }

  await db.prepare(`
    INSERT INTO api_configs (provider, tier, config_json, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(provider, tier) DO UPDATE SET
    config_json = excluded.config_json,
    updated_at = datetime('now')
  `).bind(provider, tier, config_json).run()

  return c.json({ code: 0, message: '保存成功' })
})

// 删除API配置
app.delete('/api/admin/configs/:id', authMiddleware, async (c) => {
  const db = c.env.DB
  const id = c.req.param('id')
  await db.prepare('DELETE FROM api_configs WHERE id = ?').bind(id).run()
  return c.json({ code: 0, message: '删除成功' })
})

// 管理渠道 CRUD
app.get('/api/admin/channels', authMiddleware, async (c) => {
  const db = c.env.DB
  const channels = await db.prepare('SELECT * FROM channels ORDER BY provider, sort_order').all()
  return c.json({ code: 0, data: channels.results || [] })
})

app.post('/api/admin/channels', authMiddleware, async (c) => {
  const db = c.env.DB
  const body = await c.req.json()
  const { name, provider, model_id, icon, rate_multiplier, sort_order } = body

  await db.prepare(`
    INSERT INTO channels (name, provider, model_id, icon, rate_multiplier, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(name, provider, model_id, icon || '', rate_multiplier || 1.0, sort_order || 0).run()

  return c.json({ code: 0, message: '创建成功' })
})

app.put('/api/admin/channels/:id', authMiddleware, async (c) => {
  const db = c.env.DB
  const id = c.req.param('id')
  const body = await c.req.json()

  await db.prepare(`
    UPDATE channels SET name=?, provider=?, model_id=?, icon=?, rate_multiplier=?, sort_order=?, is_active=?
    WHERE id=?
  `).bind(body.name, body.provider, body.model_id, body.icon || '', body.rate_multiplier || 1.0, body.sort_order || 0, body.is_active ?? 1, id).run()

  return c.json({ code: 0, message: '更新成功' })
})

app.delete('/api/admin/channels/:id', authMiddleware, async (c) => {
  const db = c.env.DB
  const id = c.req.param('id')
  await db.prepare('DELETE FROM channels WHERE id = ?').bind(id).run()
  return c.json({ code: 0, message: '删除成功' })
})

// ===== 渠道检测 API =====
// 手动触发检测(管理员)
app.post('/api/admin/test-channel/:id', authMiddleware, async (c) => {
  const db = c.env.DB
  const id = c.req.param('id')
  const channel = await db.prepare('SELECT * FROM channels WHERE id = ?').bind(id).first()
  if (!channel) return c.json({ code: -1, message: '渠道不存在' }, 404)

  // 从api_configs获取对应的key
  const config = await db.prepare(
    'SELECT * FROM api_configs WHERE provider = ? LIMIT 1'
  ).bind(channel.provider === 'domestic' ? 'openai' : channel.provider).first()

  if (!config) {
    return c.json({ code: -1, message: '未配置API密钥' }, 400)
  }

  const configData = JSON.parse(config.config_json as string)
  const result = await testUpstream(configData.url, configData.key, channel.model_id as string)

  await db.prepare(`
    INSERT INTO channel_tests (channel_id, response_time_ms, ping_ms, success, tested_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).bind(id, result.responseTime, result.ping, result.success ? 1 : 0).run()

  return c.json({ code: 0, data: result })
})

// 批量检测所有渠道 (公开接口，供定时调用)
app.post('/api/test-all-channels', async (c) => {
  const db = c.env.DB
  const channels = await db.prepare('SELECT * FROM channels WHERE is_active = 1').all()
  const results = []

  for (const ch of channels.results || []) {
    const config = await db.prepare(
      'SELECT * FROM api_configs WHERE provider = ? LIMIT 1'
    ).bind(ch.provider === 'domestic' ? 'openai' : ch.provider).first()

    if (!config) {
      results.push({ channel_id: ch.id, name: ch.name, error: '未配置API密钥' })
      continue
    }

    try {
      const configData = JSON.parse(config.config_json as string)
      const result = await testUpstream(configData.url, configData.key, ch.model_id as string)

      await db.prepare(`
        INSERT INTO channel_tests (channel_id, response_time_ms, ping_ms, success, tested_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).bind(ch.id, result.responseTime, result.ping, result.success ? 1 : 0).run()

      results.push({ channel_id: ch.id, name: ch.name, ...result })
    } catch (e: any) {
      await db.prepare(`
        INSERT INTO channel_tests (channel_id, response_time_ms, ping_ms, success, tested_at)
        VALUES (?, ?, ?, 0, datetime('now'))
      `).bind(ch.id, 0, 0).run()
      results.push({ channel_id: ch.id, name: ch.name, error: e.message })
    }
  }

  return c.json({ code: 0, data: results })
})

// ===== 智力检测 API =====
app.post('/api/run-iq-test', async (c) => {
  const db = c.env.DB
  const { model, tier, provider } = await c.req.json()

  // 获取API配置
  const config = await db.prepare(
    'SELECT * FROM api_configs WHERE provider = ? AND tier = ?'
  ).bind(provider || 'openai', tier || 'lite').first()

  if (!config) {
    return c.json({ code: -1, message: '未配置对应分组的API密钥' }, 400)
  }

  const configData = JSON.parse(config.config_json as string)
  const result = await runCandyTest(configData.url, configData.key, model)

  await db.prepare(`
    INSERT INTO iq_tests (provider, tier, model, test_type, result, score, raw_response, reasoning_tokens, input_tokens, output_tokens, response_time_ms, tested_at)
    VALUES (?, ?, ?, 'parrot', ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).bind(
    provider || 'openai', tier || 'lite', model,
    result.result, result.score, result.rawResponse,
    result.reasoningTokens, result.inputTokens, result.outputTokens,
    result.responseTime
  ).run()

  return c.json({ code: 0, data: result })
})

// ===== 上游测试函数 =====
async function testUpstream(baseUrl: string, apiKey: string, model: string) {
  const startTime = Date.now()
  let pingTime = 0

  // Ping测试
  try {
    const pingStart = Date.now()
    await fetch(baseUrl + '/v1/models', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000)
    })
    pingTime = Date.now() - pingStart
  } catch { pingTime = -1 }

  // 对话测试 (使用次新模型)
  try {
    const chatStart = Date.now()
    const resp = await fetch(baseUrl + '/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5,
        stream: false
      }),
      signal: AbortSignal.timeout(30000)
    })
    const responseTime = Date.now() - chatStart

    if (!resp.ok) {
      return { success: false, responseTime, ping: pingTime, error: `HTTP ${resp.status}` }
    }

    return { success: true, responseTime, ping: pingTime }
  } catch (e: any) {
    return { success: false, responseTime: Date.now() - startTime, ping: pingTime, error: e.message }
  }
}

// ===== 糖果智力测试 =====
const CANDY_PROMPT = `不使用任何外部工具回答以下问题：

在一个黑色的袋子里放有三种口味的糖果，每种糖果有两种不同的形状（圆形和五角星形，不同的形状靠手感可以分辨）。现已知不同口味的糖和不同形状的数量统计如下表。参赛者需要在活动前决定摸出的糖果数目，那么，最少取出多少个糖果才能保证手中同时拥有不同形状的苹果味和桃子味的糖？（同时手中有圆形苹果味匹配五角星桃子味糖果，或者有圆形桃子味匹配五角星苹果味糖果都满足要求）

        苹果味  桃子味  西瓜味
圆形       7      9      8
五角星形   7      6      4`

async function runCandyTest(baseUrl: string, apiKey: string, model: string) {
  const startTime = Date.now()

  try {
    const resp = await fetch(baseUrl + '/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: CANDY_PROMPT }],
        max_tokens: 4096,
        stream: false
      }),
      signal: AbortSignal.timeout(120000)
    })

    const responseTime = Date.now() - startTime
    if (!resp.ok) {
      return {
        result: 'degraded', score: 0, rawResponse: `HTTP Error: ${resp.status}`,
        reasoningTokens: 0, inputTokens: 0, outputTokens: 0, responseTime
      }
    }

    const data: any = await resp.json()
    const content = data.choices?.[0]?.message?.content || ''
    const usage = data.usage || {}

    // 判定：正确答案为21
    const hasCorrectAnswer = /(?<!\d)21(?!\d)/.test(content)

    let result = 'degraded'
    let score = 0
    if (hasCorrectAnswer) {
      // 检查推理过程质量
      if (content.length > 200 && (content.includes('最少') || content.includes('保证'))) {
        result = 'pass'
        score = 100
      } else {
        result = 'works'
        score = 70
      }
    } else {
      result = 'degraded'
      score = 0
    }

    return {
      result, score,
      rawResponse: content.substring(0, 2000),
      reasoningTokens: usage.completion_tokens_details?.reasoning_tokens || 0,
      inputTokens: usage.prompt_tokens || 0,
      outputTokens: usage.completion_tokens || 0,
      responseTime
    }
  } catch (e: any) {
    return {
      result: 'degraded', score: 0, rawResponse: `Error: ${e.message}`,
      reasoningTokens: 0, inputTokens: 0, outputTokens: 0,
      responseTime: Date.now() - startTime
    }
  }
}

// ===== 种子数据接口（首次初始化用）=====
app.post('/api/admin/seed', authMiddleware, async (c) => {
  const db = c.env.DB

  // 检查是否已有渠道
  const existing = await db.prepare('SELECT COUNT(*) as cnt FROM channels').first<{ cnt: number }>()
  if (existing && existing.cnt > 0) {
    return c.json({ code: 0, message: '已有数据，跳过种子' })
  }

  const channels = [
    // OpenAI
    { name: 'cx-稳定官池', provider: 'openai', model_id: 'gpt-5.6-sol', icon: '🏆', rate: 0.22, sort: 1 },
    { name: 'cx-pro', provider: 'openai', model_id: 'gpt-5.6-sol', icon: '🌍', rate: 0.28, sort: 2 },
    { name: 'cx-vip专线', provider: 'openai', model_id: 'gpt-5.6-sol', icon: '🔥', rate: 0.48, sort: 3 },
    { name: 'cx-不降智', provider: 'openai', model_id: 'gpt-5.6-sol', icon: '🧠', rate: 0.55, sort: 4 },
    { name: 'cx-一人一号', provider: 'openai', model_id: 'gpt-5.6-sol', icon: '👤', rate: 0.80, sort: 5 },
    { name: 'cx-官key', provider: 'openai', model_id: 'gpt-5.6-sol', icon: '🔑', rate: 1.50, sort: 6 },
    // Anthropic
    { name: 'cc-kiro-高级', provider: 'anthropic', model_id: 'claude-sonnet-5', icon: '✨', rate: 8.58, sort: 1 },
    { name: 'cc-aws', provider: 'anthropic', model_id: 'claude-sonnet-5', icon: '☁️', rate: 0.72, sort: 2 },
    { name: 'cc-max-满血', provider: 'anthropic', model_id: 'claude-sonnet-5', icon: '💉', rate: 1.55, sort: 3 },
    { name: 'cc-满血版-无限制', provider: 'anthropic', model_id: 'claude-sonnet-5', icon: '🚀', rate: 1.88, sort: 4 },
    // 国产模型
    { name: '国模-DeepSeek', provider: 'domestic', model_id: 'deepseek-v4-pro-0813', icon: '🔍', rate: 0.38, sort: 1 },
    { name: '国模-智谱 GLM', provider: 'domestic', model_id: 'glm-5.3', icon: '📚', rate: 0.30, sort: 2 },
    { name: '国模-月之暗面 Kimi', provider: 'domestic', model_id: 'kimi-k3', icon: '🌙', rate: 0.30, sort: 3 },
    { name: '国模-阿里 Qwen', provider: 'domestic', model_id: 'qwen3.8-max', icon: '☁️', rate: 0.38, sort: 4 },
  ]

  for (const ch of channels) {
    await db.prepare(
      'INSERT INTO channels (name, provider, model_id, icon, rate_multiplier, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(ch.name, ch.provider, ch.model_id, ch.icon, ch.rate, ch.sort).run()
  }

  // 插入模拟检测数据
  const allChannels = await db.prepare('SELECT id FROM channels').all()
  for (const ch of allChannels.results || []) {
    for (let i = 0; i < 60; i++) {
      const success = Math.random() > 0.05 ? 1 : 0
      const respTime = success ? Math.floor(1000 + Math.random() * 3000) : 0
      const ping = Math.floor(1 + Math.random() * 100)
      const time = new Date(Date.now() - (60 - i) * 15 * 60000).toISOString()
      await db.prepare(
        'INSERT INTO channel_tests (channel_id, response_time_ms, ping_ms, success, tested_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(ch.id, respTime, ping, success, time).run()
    }
  }

  // 插入模拟IQ测试数据
  const models = ['gpt-5.6-sol', 'gpt-6-astra']
  const tiers = ['lite', 'standard', 'ultra']
  const results = ['pass', 'works', 'degraded']
  for (const model of models) {
    for (const tier of tiers) {
      for (let i = 0; i < 10; i++) {
        const result = results[Math.floor(Math.random() * 3)]
        const score = result === 'pass' ? 100 : result === 'works' ? 70 : 0
        const time = new Date(Date.now() - i * 3 * 3600000).toISOString()
        await db.prepare(
          'INSERT INTO iq_tests (provider, tier, model, test_type, result, score, raw_response, reasoning_tokens, input_tokens, output_tokens, response_time_ms, tested_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind('openai', tier, model, 'parrot', result, score, '模拟测试响应', Math.floor(Math.random() * 1000), 200, Math.floor(Math.random() * 500), Math.floor(1000 + Math.random() * 5000), time).run()
      }
    }
  }

  return c.json({ code: 0, message: '种子数据已生成' })
})

// ===== 前端页面 =====
app.get('*', (c) => {
  return c.html(getIndexHtml())
})

function getIndexHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>元擎智算可视化</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <script>
    tailwind.config = {
      darkMode: ['selector', '[data-theme="dark"]'],
      theme: {
        extend: {
          colors: {
            primary: {
              50: '#f0eeff', 100: '#d9d4ff', 200: '#b3a9ff', 300: '#8d7eff',
              400: '#7a68ff', 500: '#6C5CE7', 600: '#513CC8', 700: '#3f2ea0',
              800: '#2d2178', 900: '#1b1450'
            }
          }
        }
      }
    }
  </script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .scrollbar-thin::-webkit-scrollbar { width: 4px; }
    .scrollbar-thin::-webkit-scrollbar-thumb { background: #94a3b8; border-radius: 2px; }
    [data-theme="dark"] .scrollbar-thin::-webkit-scrollbar-thumb { background: #475569; }
    .glass { backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    .fade-in { animation: fadeIn 0.3s ease; }
    @keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .pulse-dot { animation: pulse-dot 2s ease-in-out infinite; }
    .bar-chart-mini { display: flex; align-items: flex-end; gap: 1px; height: 32px; }
    .bar-chart-mini .bar { min-width: 3px; flex: 1; border-radius: 1px 1px 0 0; transition: all 0.2s; cursor: pointer; }
    .bar-chart-mini .bar:hover { opacity: 0.8; transform: scaleY(1.1); transform-origin: bottom; }
    [data-theme="dark"] body { background: #0f172a; color: #e2e8f0; }
    [data-theme="dark"] ::selection { background: #6C5CE7; color: white; }
    textarea:focus, input:focus { outline: none; ring: 2px; border-color: #6C5CE7; box-shadow: 0 0 0 2px rgba(108,92,231,0.2); }
  </style>
</head>
<body>
  <div id="app"></div>
  <script src="/static/app.js"></script>
</body>
</html>`
}

export default app
