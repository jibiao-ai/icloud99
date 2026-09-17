import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Bindings = { DB: D1Database }
type Variables = { user?: { id: number; username: string } }

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()
app.use('/api/*', cors())

// ===== Auth helpers =====
async function createToken(payload: object): Promise<string> {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = btoa(JSON.stringify({ ...payload, exp: Date.now() + 86400000 }))
  return `${header}.${body}.sig`
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
async function authMiddleware(c: any, next: any) {
  const auth = c.req.header('Authorization')
  if (!auth?.startsWith('Bearer ')) return c.json({ code: -1, message: '未授权' }, 401)
  const payload = verifyToken(auth.substring(7))
  if (!payload) return c.json({ code: -1, message: 'Token无效或已过期' }, 401)
  c.set('user', payload)
  await next()
}

// ===== Public =====
app.get('/api/health', (c) => c.json({ code: 0, message: 'ok' }))

app.post('/api/login', async (c) => {
  const db = c.env.DB
  const { username, password } = await c.req.json()
  // Check against DB first for custom password
  const user = await db.prepare('SELECT * FROM admin_users WHERE username = ?').bind(username).first()
  if (user) {
    // password_hash stores plain text for simplicity in Workers env (no bcrypt)
    // Support both legacy default and custom passwords
    const storedPw = user.password_hash as string
    const isLegacy = storedPw.startsWith('$2a$') && password === 'admin123' && username === 'admin'
    const isMatch = storedPw === password
    if (isLegacy || isMatch) {
      const token = await createToken({ id: user.id, username: user.username as string })
      return c.json({ code: 0, data: { token, user: { id: user.id, username: user.username } } })
    }
  }
  return c.json({ code: -1, message: '用户名或密码错误' }, 401)
})

// ===== Public: read configs (key masked) =====
app.get('/api/configs', async (c) => {
  const db = c.env.DB
  const configs = await db.prepare('SELECT id, provider, tier, config_json, updated_at FROM api_configs ORDER BY provider, tier').all()
  const masked = (configs.results || []).map((r: any) => {
    try {
      const j = JSON.parse(r.config_json)
      return { ...r, url: j.url, key_masked: j.key ? j.key.substring(0, 8) + '****' : '', has_key: !!j.key }
    } catch { return { ...r, url: '', key_masked: '', has_key: false } }
  })
  return c.json({ code: 0, data: masked })
})

// ===== Public: channels with tier grouping =====
app.get('/api/channels', async (c) => {
  const db = c.env.DB
  const range = parseInt(c.req.query('range') || '7')
  const since = new Date(Date.now() - range * 86400000).toISOString()

  const channels = await db.prepare('SELECT * FROM channels WHERE is_active = 1 ORDER BY provider, tier, sort_order').all()
  const results = []
  for (const ch of channels.results || []) {
    const tests = await db.prepare('SELECT * FROM channel_tests WHERE channel_id = ? AND tested_at > ? ORDER BY tested_at DESC LIMIT 60').bind(ch.id, since).all()
    const testResults = tests.results || []
    const successCount = testResults.filter((t: any) => t.success === 1).length
    const totalTests = testResults.length
    const successRate = totalTests > 0 ? Math.round((successCount / totalTests) * 100) : 0
    results.push({
      ...ch,
      latest_test: testResults[0] || null,
      success_rate: successRate,
      total_tests: totalTests,
      history: testResults.reverse().map((t: any) => ({ time: t.tested_at, response_time: t.response_time_ms, success: t.success, ping: t.ping_ms }))
    })
  }
  return c.json({ code: 0, data: results })
})

// ===== Public: IQ tests =====
app.get('/api/iq-tests', async (c) => {
  const db = c.env.DB
  const tier = c.req.query('tier') || ''
  const limit = parseInt(c.req.query('limit') || '50')
  let sql = 'SELECT id, provider, tier, model, test_type, result, score, reasoning_tokens, input_tokens, output_tokens, response_time_ms, image_url, tested_at FROM iq_tests WHERE 1=1'
  const params: any[] = []
  if (tier) { sql += ' AND tier = ?'; params.push(tier) }
  sql += ' ORDER BY tested_at DESC LIMIT ?'
  params.push(limit)
  const results = await db.prepare(sql).bind(...params).all()
  return c.json({ code: 0, data: results.results || [] })
})

app.get('/api/iq-tests/stats', async (c) => {
  const db = c.env.DB
  const stats = await db.prepare(`SELECT tier, model, result, COUNT(*) as count FROM iq_tests GROUP BY tier, model, result ORDER BY tier, model`).all()
  return c.json({ code: 0, data: stats.results || [] })
})

// ===== Admin =====
app.get('/api/admin/configs', authMiddleware, async (c) => {
  const db = c.env.DB
  const configs = await db.prepare('SELECT * FROM api_configs ORDER BY provider, tier').all()
  return c.json({ code: 0, data: configs.results || [] })
})

app.post('/api/admin/configs', authMiddleware, async (c) => {
  const db = c.env.DB
  const { provider, tier, key, url } = await c.req.json()
  if (!provider || !tier || !key || !url) return c.json({ code: -1, message: '参数不完整' }, 400)
  const config_json = JSON.stringify({ _type: 'newapi_channel_conn', key, url })
  await db.prepare(`INSERT INTO api_configs (provider, tier, config_json, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(provider, tier) DO UPDATE SET config_json = excluded.config_json, updated_at = datetime('now')`)
    .bind(provider, tier, config_json).run()
  return c.json({ code: 0, message: '保存成功' })
})

app.delete('/api/admin/configs/:id', authMiddleware, async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM api_configs WHERE id = ?').bind(id).run()
  return c.json({ code: 0, message: '删除成功' })
})

// ===== Admin: change password =====
app.post('/api/admin/change-password', authMiddleware, async (c) => {
  const db = c.env.DB
  const { currentPassword, newPassword } = await c.req.json()
  if (!currentPassword || !newPassword) return c.json({ code: -1, message: '请填写完整信息' }, 400)
  if (newPassword.length < 6) return c.json({ code: -1, message: '新密码至少6位' }, 400)
  const user: any = c.get('user')
  const dbUser = await db.prepare('SELECT * FROM admin_users WHERE id = ?').bind(user.id).first()
  if (!dbUser) return c.json({ code: -1, message: '用户不存在' }, 400)
  const storedPw = dbUser.password_hash as string
  const isLegacy = storedPw.startsWith('$2a$') && currentPassword === 'admin123'
  const isMatch = storedPw === currentPassword
  if (!isLegacy && !isMatch) return c.json({ code: -1, message: '当前密码错误' }, 400)
  await db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').bind(newPassword, user.id).run()
  return c.json({ code: 0, message: '密码修改成功！下次登录请使用新密码。' })
})

// ===== Channel test (uses real keys) =====
async function testUpstream(baseUrl: string, apiKey: string, model: string) {
  let pingTime = 0
  try {
    const ps = Date.now()
    await fetch(baseUrl + '/v1/models', { method: 'GET', headers: { 'Authorization': `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10000) })
    pingTime = Date.now() - ps
  } catch { pingTime = -1 }
  try {
    const cs = Date.now()
    const resp = await fetch(baseUrl + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 5, stream: false }),
      signal: AbortSignal.timeout(30000)
    })
    const responseTime = Date.now() - cs
    if (!resp.ok) return { success: false, responseTime, ping: pingTime, error: `HTTP ${resp.status}` }
    return { success: true, responseTime, ping: pingTime }
  } catch (e: any) { return { success: false, responseTime: 0, ping: pingTime, error: e.message } }
}

// Test channels by tier
app.post('/api/test-channels', async (c) => {
  const db = c.env.DB
  const { tier } = await c.req.json().catch(() => ({ tier: '' }))
  
  let channelQuery = 'SELECT * FROM channels WHERE is_active = 1'
  const channelParams: any[] = []
  if (tier) { channelQuery += ' AND tier = ?'; channelParams.push(tier) }
  channelQuery += ' ORDER BY provider, sort_order'
  
  const channels = await db.prepare(channelQuery).bind(...channelParams).all()
  const results = []

  for (const ch of channels.results || []) {
    const config = await db.prepare('SELECT * FROM api_configs WHERE provider = ? AND tier = ?').bind(ch.provider, ch.tier).first()
    if (!config) { results.push({ channel_id: ch.id, name: ch.name, error: '未配置密钥' }); continue }
    try {
      const cfg = JSON.parse(config.config_json as string)
      const result = await testUpstream(cfg.url, cfg.key, ch.model_id as string)
      await db.prepare('INSERT INTO channel_tests (channel_id, response_time_ms, ping_ms, success, tested_at) VALUES (?, ?, ?, ?, datetime(\'now\'))').bind(ch.id, result.responseTime, result.ping, result.success ? 1 : 0).run()
      results.push({ channel_id: ch.id, name: ch.name, ...result })
    } catch (e: any) {
      await db.prepare('INSERT INTO channel_tests (channel_id, response_time_ms, ping_ms, success, tested_at) VALUES (?, ?, 0, 0, datetime(\'now\'))').bind(ch.id, 0).run()
      results.push({ channel_id: ch.id, name: ch.name, error: e.message })
    }
  }
  return c.json({ code: 0, data: results })
})

// ===== IQ Test (candy) =====
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
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: CANDY_PROMPT }], max_tokens: 4096, stream: false }),
      signal: AbortSignal.timeout(120000)
    })
    const responseTime = Date.now() - startTime
    if (!resp.ok) return { result: 'degraded', score: 0, rawResponse: `HTTP ${resp.status}`, reasoningTokens: 0, inputTokens: 0, outputTokens: 0, responseTime }
    const data: any = await resp.json()
    const content = data.choices?.[0]?.message?.content || ''
    const usage = data.usage || {}
    const hasCorrect = /(?<!\d)21(?!\d)/.test(content)
    let result = 'degraded', score = 0
    if (hasCorrect) {
      if (content.length > 200 && (content.includes('最少') || content.includes('保证'))) { result = 'pass'; score = 100 }
      else { result = 'works'; score = 70 }
    }
    return { result, score, rawResponse: content.substring(0, 2000), reasoningTokens: usage.completion_tokens_details?.reasoning_tokens || 0, inputTokens: usage.prompt_tokens || 0, outputTokens: usage.completion_tokens || 0, responseTime }
  } catch (e: any) { return { result: 'degraded', score: 0, rawResponse: `Error: ${e.message}`, reasoningTokens: 0, inputTokens: 0, outputTokens: 0, responseTime: Date.now() - startTime } }
}

// Generate pelican riding bicycle illustration (community benchmark)
const PELICAN_POEMS = [
  '面朝海风，情如潮涌。', '海风，情如潮。', '今天，趁风出发。',
  '海风入怀，骑行远方。', '慢一点，海边有你就好。', '面朝大海，骑行未来。',
  '海风，一位骑行者。', '向前迈进，去远方。', '风起时，鹈鹕在路上。',
  '踏浪而行，逐风而歌。', '阳光正好，微风不燥。', '骑上单车，与海对话。',
]

async function generatePelicanImage(baseUrl: string, apiKey: string, tier: string) {
  try {
    const poem = PELICAN_POEMS[Math.floor(Math.random() * PELICAN_POEMS.length)]
    const resp = await fetch(baseUrl + '/v1/images/generations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: `A cute pelican riding a bicycle on a seaside road, sunny day, gentle breeze, watercolor illustration style, warm and soft tones, healing art, with Chinese text "${poem}" elegantly placed in the corner. The pelican looks happy and determined. Background has ocean, green hills, and golden sunlight.`,
        n: 1,
        size: '1024x1024'
      }),
      signal: AbortSignal.timeout(120000)
    })
    if (!resp.ok) return null
    const data: any = await resp.json()
    return data.data?.[0]?.url || null
  } catch { return null }
}

app.post('/api/run-iq-test', async (c) => {
  const db = c.env.DB
  const { model, tier, provider } = await c.req.json()
  const config = await db.prepare('SELECT * FROM api_configs WHERE provider = ? AND tier = ?').bind(provider || 'openai', tier || 'lite').first()
  if (!config) return c.json({ code: -1, message: `未配置 ${provider}/${tier} 分组的API密钥，请先在管理设置中配置` }, 400)
  const cfg = JSON.parse(config.config_json as string)
  
  // Run candy test + pelican image generation in parallel
  const [result, imageUrl] = await Promise.all([
    runCandyTest(cfg.url, cfg.key, model),
    generatePelicanImage(cfg.url, cfg.key, tier).catch(() => null)
  ])
  
  await db.prepare(`INSERT INTO iq_tests (provider, tier, model, test_type, result, score, raw_response, reasoning_tokens, input_tokens, output_tokens, response_time_ms, image_url, tested_at) VALUES (?, ?, ?, 'pelican', ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
    .bind(provider || 'openai', tier || 'lite', model, result.result, result.score, result.rawResponse, result.reasoningTokens, result.inputTokens, result.outputTokens, result.responseTime, imageUrl || '').run()
  return c.json({ code: 0, data: { ...result, imageUrl } })
})

// ===== Seed with REAL keys =====
app.post('/api/admin/seed', authMiddleware, async (c) => {
  const db = c.env.DB

  // Insert the 3 real API configs for OpenAI
  const openaiConfigs = [
    { tier: 'lite', key: 'sk-Y8QC5oQFlBdfgATUsFgmwf60IO51ao2RS4ZP57IJ9yLBjTmp' },
    { tier: 'standard', key: 'sk-sxtlBE2piAtKCj7omSKm5MQBuHTS8ZjHODuAXOVhhFQQeSia' },
    { tier: 'ultra', key: 'sk-eJAA9WMiZdR99TXkQblvEZi1RwWVRAEpss9vp9TAlrSc4py0' },
  ]
  for (const cfg of openaiConfigs) {
    const json = JSON.stringify({ _type: 'newapi_channel_conn', key: cfg.key, url: 'https://api.icloud99.cn' })
    await db.prepare(`INSERT INTO api_configs (provider, tier, config_json, updated_at) VALUES ('openai', ?, ?, datetime('now')) ON CONFLICT(provider, tier) DO UPDATE SET config_json = excluded.config_json, updated_at = datetime('now')`)
      .bind(cfg.tier, json).run()
  }

  // Clear old channels
  await db.prepare('DELETE FROM channels').run()
  await db.prepare('DELETE FROM channel_tests').run()

  // Create channels grouped by provider+tier+model
  const channels = [
    // OpenAI - each tier has both models
    { name: 'Lite · GPT-5.6-SOL', provider: 'openai', tier: 'lite', model_id: 'gpt-5.6-sol', icon: '⚡', sort: 1 },
    { name: 'Lite · GPT-6-ASTRA', provider: 'openai', tier: 'lite', model_id: 'gpt-6-astra', icon: '🌟', sort: 2 },
    { name: 'Standard · GPT-5.6-SOL', provider: 'openai', tier: 'standard', model_id: 'gpt-5.6-sol', icon: '⚡', sort: 1 },
    { name: 'Standard · GPT-6-ASTRA', provider: 'openai', tier: 'standard', model_id: 'gpt-6-astra', icon: '🌟', sort: 2 },
    { name: 'Ultra · GPT-5.6-SOL', provider: 'openai', tier: 'ultra', model_id: 'gpt-5.6-sol', icon: '⚡', sort: 1 },
    { name: 'Ultra · GPT-6-ASTRA', provider: 'openai', tier: 'ultra', model_id: 'gpt-6-astra', icon: '🌟', sort: 2 },
    // Anthropic - each tier has both models
    { name: 'Lite · Claude-Opus-4-7', provider: 'anthropic', tier: 'lite', model_id: 'claude-opus-4-7', icon: '✨', sort: 1 },
    { name: 'Lite · Claude-Opus-4-8', provider: 'anthropic', tier: 'lite', model_id: 'claude-opus-4-8', icon: '🔮', sort: 2 },
    { name: 'Standard · Claude-Opus-4-7', provider: 'anthropic', tier: 'standard', model_id: 'claude-opus-4-7', icon: '✨', sort: 1 },
    { name: 'Standard · Claude-Opus-4-8', provider: 'anthropic', tier: 'standard', model_id: 'claude-opus-4-8', icon: '🔮', sort: 2 },
    { name: 'Ultra · Claude-Opus-4-7', provider: 'anthropic', tier: 'ultra', model_id: 'claude-opus-4-7', icon: '✨', sort: 1 },
    { name: 'Ultra · Claude-Opus-4-8', provider: 'anthropic', tier: 'ultra', model_id: 'claude-opus-4-8', icon: '🔮', sort: 2 },
  ]

  for (const ch of channels) {
    await db.prepare('INSERT INTO channels (name, provider, tier, model_id, icon, rate_multiplier, sort_order) VALUES (?, ?, ?, ?, ?, 1.0, ?)').bind(ch.name, ch.provider, ch.tier, ch.model_id, ch.icon, ch.sort).run()
  }

  return c.json({ code: 0, message: '初始化完成！已配置 OpenAI 3组密钥 + 12个检测渠道。请配置 Anthropic 密钥后使用完整功能。' })
})

// ===== Frontend =====
app.get('*', (c) => c.html(getIndexHtml()))

function getIndexHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>元擎智算可视化</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <script>
    tailwind.config = {
      darkMode: ['selector', '[data-theme="dark"]'],
      theme: { extend: { colors: {
        primary: { 50:'#f0eeff',100:'#d9d4ff',200:'#b3a9ff',300:'#8d7eff',400:'#7a68ff',500:'#6C5CE7',600:'#513CC8',700:'#3f2ea0',800:'#2d2178',900:'#1b1450' }
      }}}
    }
  </script>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
    .scrollbar-thin::-webkit-scrollbar{width:4px}
    .scrollbar-thin::-webkit-scrollbar-thumb{background:#94a3b8;border-radius:2px}
    [data-theme="dark"] .scrollbar-thin::-webkit-scrollbar-thumb{background:#475569}
    .glass{backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}
    @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    .fade-in{animation:fadeIn .3s ease}
    @keyframes pulse-dot{0%,100%{opacity:1}50%{opacity:.5}}
    .pulse-dot{animation:pulse-dot 2s ease-in-out infinite}
    .bar-chart-mini{display:flex;align-items:flex-end;gap:1px;height:32px}
    .bar-chart-mini .bar{min-width:3px;flex:1;border-radius:1px 1px 0 0;transition:all .2s;cursor:pointer}
    .bar-chart-mini .bar:hover{opacity:.8;transform:scaleY(1.1);transform-origin:bottom}
    [data-theme="dark"] body{background:#0f172a;color:#e2e8f0}
    input:focus,textarea:focus{outline:none;border-color:#6C5CE7;box-shadow:0 0 0 2px rgba(108,92,231,.2)}
    @keyframes toastIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}
    @keyframes toastOut{from{transform:translateX(0);opacity:1}to{transform:translateX(100%);opacity:0}}
    .toast-in{animation:toastIn .3s ease}
    .toast-out{animation:toastOut .3s ease forwards}
    @keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
    .shimmer{background:linear-gradient(90deg,transparent 25%,rgba(108,92,231,.08) 50%,transparent 75%);background-size:200% 100%;animation:shimmer 2s infinite}
  </style>
</head>
<body>
  <div id="app"></div>
  <div id="toast-container" class="fixed top-4 right-4 z-[9999] flex flex-col gap-2" style="pointer-events:none"></div>
  <div id="modal-root"></div>
  <script src="/static/app.js"></script>
</body>
</html>`
}

export default app
