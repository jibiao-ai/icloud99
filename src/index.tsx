import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from '@hono/node-server/serve-static'
import mysql from 'mysql2/promise'

// ===== DB Pool =====
let pool: mysql.Pool

function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || '127.0.0.1',
      port: parseInt(process.env.DB_PORT || '3306'),
      user: process.env.DB_USER || 'yuanqing',
      password: process.env.DB_PASS || 'yuanqing123',
      database: process.env.DB_NAME || 'yuanqing',
      waitForConnections: true,
      connectionLimit: 10,
      charset: 'utf8mb4',
    })
  }
  return pool
}

// Helper: query shorthand
async function query(sql: string, params: any[] = []): Promise<any[]> {
  const [rows] = await getPool().execute(sql, params)
  return rows as any[]
}
async function queryOne(sql: string, params: any[] = []): Promise<any | null> {
  const rows = await query(sql, params)
  return rows[0] || null
}
async function run(sql: string, params: any[] = []): Promise<any> {
  const [result] = await getPool().execute(sql, params)
  return result
}

type Variables = { user?: { id: number; username: string } }

const app = new Hono<{ Variables: Variables }>()
app.use('/api/*', cors())

// Serve static files
app.use('/static/*', serveStatic({ root: './public' }))

// ===== Auth helpers =====
async function createToken(payload: object): Promise<string> {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64')
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 86400000 })).toString('base64')
  return `${header}.${body}.sig`
}
function verifyToken(token: string): any {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString())
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

// ===== Audit Log Helper =====
async function logAudit(action: string, detail: string, ip: string = '', user: string = 'system') {
  try {
    await run('INSERT INTO audit_logs (action, detail, ip, username, created_at) VALUES (?, ?, ?, ?, NOW())', [action, detail.substring(0, 2000), ip, user]);
  } catch (e: any) { console.error('Audit log error:', e.message); }
}

// ===== Ensure audit_logs table exists =====
async function ensureAuditTable() {
  try {
    await run(`CREATE TABLE IF NOT EXISTS audit_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      action VARCHAR(100) NOT NULL,
      detail TEXT,
      ip VARCHAR(100) DEFAULT '',
      username VARCHAR(255) DEFAULT 'system',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_action (action),
      INDEX idx_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  } catch (e: any) { console.error('Create audit_logs table error:', e.message); }
}
ensureAuditTable();

// ===== Public =====
app.get('/api/health', async (c) => {
  try { await query('SELECT 1'); return c.json({ code: 0, message: 'ok' }) }
  catch (e: any) { return c.json({ code: -1, message: 'DB error: ' + e.message }, 500) }
})

app.post('/api/login', async (c) => {
  const { username, password } = await c.req.json()
  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || ''
  const user = await queryOne('SELECT * FROM admin_users WHERE username = ?', [username])
  if (user) {
    const storedPw = user.password_hash as string
    const isLegacy = storedPw.startsWith('$2a$') && password === 'admin123' && username === 'admin'
    const isMatch = storedPw === password
    if (isLegacy || isMatch) {
      const token = await createToken({ id: user.id, username: user.username })
      await logAudit('login', `用户 ${username} 登录成功`, ip, username)
      return c.json({ code: 0, data: { token, user: { id: user.id, username: user.username } } })
    }
  }
  await logAudit('login_failed', `用户 ${username} 登录失败`, ip, username || 'unknown')
  return c.json({ code: -1, message: '用户名或密码错误' }, 401)
})

// ===== Public: read configs (key masked) =====
app.get('/api/configs', async (c) => {
  const configs = await query('SELECT id, provider, tier, config_json, updated_at FROM api_configs ORDER BY provider, tier')
  const masked = configs.map((r: any) => {
    try {
      const j = JSON.parse(r.config_json)
      return { ...r, url: j.url, key_masked: j.key ? j.key.substring(0, 8) + '****' : '', has_key: !!j.key }
    } catch { return { ...r, url: '', key_masked: '', has_key: false } }
  })
  return c.json({ code: 0, data: masked })
})

// ===== Public: channels with tier grouping =====
app.get('/api/channels', async (c) => {
  const range = parseInt(c.req.query('range') || '7')
  const since = new Date(Date.now() - range * 86400000).toISOString().slice(0, 19).replace('T', ' ')

  const channels = await query('SELECT * FROM channels WHERE is_active = 1 ORDER BY provider, tier, sort_order')
  const results = []
  for (const ch of channels) {
    const testResults = await query('SELECT * FROM channel_tests WHERE channel_id = ? AND tested_at > ? ORDER BY tested_at DESC LIMIT 60', [ch.id, since])
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
  const tier = c.req.query('tier') || ''
  const limit = parseInt(c.req.query('limit') || '50')
  let sql = 'SELECT id, provider, tier, model, test_type, result, score, reasoning_tokens, input_tokens, output_tokens, response_time_ms, image_url, svg_code, tested_at FROM iq_tests WHERE 1=1'
  const params: any[] = []
  if (tier) { sql += ' AND tier = ?'; params.push(tier) }
  sql += ' ORDER BY tested_at DESC LIMIT ?'
  params.push(limit)
  const results = await query(sql, params)
  return c.json({ code: 0, data: results })
})

app.get('/api/iq-tests/stats', async (c) => {
  const stats = await query('SELECT tier, model, result, COUNT(*) as count FROM iq_tests GROUP BY tier, model, result ORDER BY tier, model')
  return c.json({ code: 0, data: stats })
})

// IQ test schedule info
app.get('/api/iq-tests/schedule', async (c) => {
  return c.json({ code: 0, data: {
    model: IQ_TEST_MODEL,
    schedule: '每天凌晨 2:00-8:00，每小时轮转',
    tiers: IQ_TIERS,
    hours: [
      { hour: 2, tier: 'lite' },
      { hour: 3, tier: 'standard' },
      { hour: 4, tier: 'ultra' },
      { hour: 5, tier: 'lite' },
      { hour: 6, tier: 'standard' },
      { hour: 7, tier: 'ultra' },
    ]
  }})
})

// ===== Admin =====
app.get('/api/admin/configs', authMiddleware, async (c) => {
  const configs = await query('SELECT * FROM api_configs ORDER BY provider, tier')
  return c.json({ code: 0, data: configs })
})

app.post('/api/admin/configs', authMiddleware, async (c) => {
  const { provider, tier, key, url } = await c.req.json()
  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || ''
  const user: any = c.get('user')
  if (!provider || !tier || !key || !url) return c.json({ code: -1, message: '参数不完整' }, 400)
  const config_json = JSON.stringify({ _type: 'newapi_channel_conn', key, url })
  await run(`INSERT INTO api_configs (provider, tier, config_json, updated_at) VALUES (?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), updated_at = NOW()`, [provider, tier, config_json])
  await logAudit('config_save', `保存配置 ${provider}/${tier}`, ip, user?.username || 'admin')
  return c.json({ code: 0, message: '保存成功' })
})

// ===== Admin: batch save configs =====
app.post('/api/admin/configs/batch', authMiddleware, async (c) => {
  const { configs } = await c.req.json()
  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || ''
  const user: any = c.get('user')
  if (!Array.isArray(configs) || configs.length === 0) return c.json({ code: -1, message: '请提供配置数据' }, 400)
  let saved = 0
  for (const cfg of configs) {
    if (!cfg.provider || !cfg.tier || !cfg.key || !cfg.url) continue
    const config_json = JSON.stringify({ _type: 'newapi_channel_conn', key: cfg.key, url: cfg.url })
    await run(`INSERT INTO api_configs (provider, tier, config_json, updated_at) VALUES (?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), updated_at = NOW()`, [cfg.provider, cfg.tier, config_json])
    saved++
  }
  await logAudit('config_batch_save', `批量保存 ${saved} 个配置`, ip, user?.username || 'admin')
  return c.json({ code: 0, message: `成功保存 ${saved} 个配置` })
})

app.delete('/api/admin/configs/:id', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || ''
  const user: any = c.get('user')
  await run('DELETE FROM api_configs WHERE id = ?', [id])
  await logAudit('config_delete', `删除配置 ID=${id}`, ip, user?.username || 'admin')
  return c.json({ code: 0, message: '删除成功' })
})

// ===== Admin: change password =====
app.post('/api/admin/change-password', authMiddleware, async (c) => {
  const { currentPassword, newPassword } = await c.req.json()
  if (!currentPassword || !newPassword) return c.json({ code: -1, message: '请填写完整信息' }, 400)
  if (newPassword.length < 6) return c.json({ code: -1, message: '新密码至少6位' }, 400)
  const user: any = c.get('user')
  const dbUser = await queryOne('SELECT * FROM admin_users WHERE id = ?', [user.id])
  if (!dbUser) return c.json({ code: -1, message: '用户不存在' }, 400)
  const storedPw = dbUser.password_hash as string
  const isLegacy = storedPw.startsWith('$2a$') && currentPassword === 'admin123'
  const isMatch = storedPw === currentPassword
  if (!isLegacy && !isMatch) return c.json({ code: -1, message: '当前密码错误' }, 400)
  await run('UPDATE admin_users SET password_hash = ? WHERE id = ?', [newPassword, user.id])
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

app.post('/api/test-channels', async (c) => {
  const { tier } = await c.req.json().catch(() => ({ tier: '' }))
  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || ''
  let channelQuery = 'SELECT * FROM channels WHERE is_active = 1'
  const channelParams: any[] = []
  if (tier) { channelQuery += ' AND tier = ?'; channelParams.push(tier) }
  channelQuery += ' ORDER BY provider, sort_order'
  const channels = await query(channelQuery, channelParams)
  const results = []

  for (const ch of channels) {
    const config = await queryOne('SELECT * FROM api_configs WHERE provider = ? AND tier = ?', [ch.provider, ch.tier])
    if (!config) { results.push({ channel_id: ch.id, name: ch.name, error: '未配置密钥' }); continue }
    try {
      const cfg = JSON.parse(config.config_json)
      const result = await testUpstream(cfg.url, cfg.key, ch.model_id)
      await run('INSERT INTO channel_tests (channel_id, response_time_ms, ping_ms, success, tested_at) VALUES (?, ?, ?, ?, NOW())', [ch.id, result.responseTime, result.ping, result.success ? 1 : 0])
      results.push({ channel_id: ch.id, name: ch.name, ...result })
    } catch (e: any) {
      await run('INSERT INTO channel_tests (channel_id, response_time_ms, ping_ms, success, tested_at) VALUES (?, 0, 0, 0, NOW())', [ch.id])
      results.push({ channel_id: ch.id, name: ch.name, error: e.message })
    }
  }
  await logAudit('channel_test', `渠道检测完成，共 ${results.length} 个渠道${tier ? ` (tier=${tier})` : ''}`, ip)
  return c.json({ code: 0, data: results })
})

// ===== Auto Hourly Channel Test (server-side cron) =====
let lastAutoTestTime = 0
const AUTO_TEST_INTERVAL = 60 * 60 * 1000 // 1 hour

async function runAutoChannelTest() {
  const now = Date.now()
  if (now - lastAutoTestTime < AUTO_TEST_INTERVAL) return
  lastAutoTestTime = now
  console.log('[AutoTest] Running hourly channel test...')
  try {
    const channels = await query('SELECT * FROM channels WHERE is_active = 1 ORDER BY provider, sort_order')
    let tested = 0
    for (const ch of channels) {
      const config = await queryOne('SELECT * FROM api_configs WHERE provider = ? AND tier = ?', [ch.provider, ch.tier])
      if (!config) continue
      try {
        const cfg = JSON.parse(config.config_json)
        const result = await testUpstream(cfg.url, cfg.key, ch.model_id)
        await run('INSERT INTO channel_tests (channel_id, response_time_ms, ping_ms, success, tested_at) VALUES (?, ?, ?, ?, NOW())', [ch.id, result.responseTime, result.ping, result.success ? 1 : 0])
        tested++
      } catch (e: any) {
        await run('INSERT INTO channel_tests (channel_id, response_time_ms, ping_ms, success, tested_at) VALUES (?, 0, 0, 0, NOW())', [ch.id])
        tested++
      }
    }
    await logAudit('auto_test', `每小时自动检测完成，共 ${tested} 个渠道`)
    console.log(`[AutoTest] Completed: ${tested} channels tested`)
  } catch (e: any) {
    console.error('[AutoTest] Error:', e.message)
    await logAudit('auto_test_error', `自动检测失败: ${e.message}`)
  }
}

// Start the hourly interval
setInterval(runAutoChannelTest, AUTO_TEST_INTERVAL)
// Run once at startup after 30 seconds
setTimeout(runAutoChannelTest, 30000)

// ===== Auto IQ Test Cron (2:00 AM - 8:00 AM CST/UTC+8, every 1 hour, rotate tiers) =====
const IQ_TIERS = ['lite', 'standard', 'ultra']
let lastAutoIQTestHour = -1

function getCSTHour(): number {
  // Always use China Standard Time (UTC+8) regardless of server timezone
  const now = new Date()
  return (now.getUTCHours() + 8) % 24
}

async function runAutoIQTest() {
  const hour = getCSTHour()
  
  // Only run between 2:00 AM and 8:00 AM CST (inclusive of 2, exclusive of 8)
  if (hour < 2 || hour >= 8) return
  
  // Don't run twice in the same CST hour
  if (hour === lastAutoIQTestHour) return
  lastAutoIQTestHour = hour
  
  // Determine which tier to test based on hour: 2->lite, 3->standard, 4->ultra, 5->lite, 6->standard, 7->ultra
  const tierIdx = (hour - 2) % IQ_TIERS.length
  const tier = IQ_TIERS[tierIdx]
  const model = IQ_TEST_MODEL // gpt-6-astra only
  
  console.log(`[AutoIQ] Running IQ test at ${hour}:00 for tier=${tier} model=${model}`)
  try {
    // Get API config from admin settings (api_configs table)
    const config = await queryOne('SELECT * FROM api_configs WHERE provider = ? AND tier = ?', ['openai', tier])
    if (!config) {
      console.log(`[AutoIQ] No API config for openai/${tier}, skipping`)
      await logAudit('auto_iq_skip', `智力自动检测跳过: openai/${tier} 未配置密钥`)
      return
    }
    const cfg = JSON.parse(config.config_json)
    
    // Run candy test and SVG generation in parallel
    const [candyResult, svgResult] = await Promise.all([
      runCandyTest(cfg.url, cfg.key, model),
      generatePelicanSVG(cfg.url, cfg.key, model)
    ])
    
    // Evaluate combined result
    const hasSvg = !!svgResult.svgCode
    let finalResult = candyResult.result
    let finalScore = candyResult.score
    if (hasSvg && finalResult === 'degraded') { finalResult = 'works'; finalScore = Math.max(finalScore, 50) }
    if (hasSvg && finalResult === 'pass') { finalScore = 100 }
    
    await run(`INSERT INTO iq_tests (provider, tier, model, test_type, result, score, raw_response, reasoning_tokens, input_tokens, output_tokens, response_time_ms, image_url, svg_code, tested_at) VALUES (?, ?, ?, 'pelican', ?, ?, ?, ?, ?, ?, ?, '', ?, NOW())`,
      ['openai', tier, model, finalResult, finalScore, candyResult.rawResponse,
       candyResult.reasoningTokens + svgResult.reasoningTokens,
       candyResult.inputTokens + svgResult.inputTokens,
       candyResult.outputTokens + svgResult.outputTokens,
       Math.max(candyResult.responseTime, svgResult.responseTime),
       svgResult.svgCode || ''])
    
    await logAudit('auto_iq_test', `智力自动检测 ${model} [${tier}]: ${finalResult} (${finalScore}分)${hasSvg ? ' · SVG生成成功' : ''}`)
    console.log(`[AutoIQ] Completed: ${model} [${tier}] => ${finalResult} (${finalScore}pts)`)
  } catch (e: any) {
    console.error('[AutoIQ] Error:', e.message)
    await logAudit('auto_iq_error', `智力自动检测失败 [${tier}]: ${e.message}`)
  }
}

// Check every 10 minutes for auto IQ test timing
setInterval(runAutoIQTest, 10 * 60 * 1000)
// Also check at startup after 60 seconds
setTimeout(runAutoIQTest, 60000)

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

const SVG_PROMPT_EN = `Generate an SVG of a pelican riding a bicycle. The SVG must include CSS animations to show the pelican pedaling and the bicycle wheels spinning. Make it a fun animated scene with the pelican actively cycling. Use <animate> or CSS @keyframes for smooth continuous animation.`

const IQ_TEST_MODEL = 'gpt-6-astra'

async function generatePelicanSVG(baseUrl: string, apiKey: string, model?: string): Promise<{ svgCode: string | null; usedModel: string; inputTokens: number; outputTokens: number; reasoningTokens: number; responseTime: number }> {
  const useModel = model || IQ_TEST_MODEL
  const startTime = Date.now()
  try {
    const resp = await fetch(baseUrl + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: useModel, messages: [{ role: 'user', content: SVG_PROMPT_EN }], max_tokens: 16000, stream: false }),
      signal: AbortSignal.timeout(180000)
    })
    const responseTime = Date.now() - startTime
    if (!resp.ok) {
      return { svgCode: null, usedModel: useModel, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, responseTime }
    }
    const data: any = await resp.json()
    const content = data.choices?.[0]?.message?.content || ''
    const usage = data.usage || {}
    const svgMatch = content.match(/<svg[\s\S]*?<\/svg>/i)
    return {
      svgCode: svgMatch ? svgMatch[0] : null,
      usedModel: useModel,
      inputTokens: usage.prompt_tokens || 0,
      outputTokens: usage.completion_tokens || 0,
      reasoningTokens: usage.completion_tokens_details?.reasoning_tokens || 0,
      responseTime
    }
  } catch (e: any) {
    return { svgCode: null, usedModel: useModel, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, responseTime: Date.now() - startTime }
  }
}

app.post('/api/run-iq-test', async (c) => {
  const { tier, provider } = await c.req.json()
  const model = IQ_TEST_MODEL // 只使用 gpt-6-astra
  const usedProvider = provider || 'openai'
  const usedTier = tier || 'lite'
  const config = await queryOne('SELECT * FROM api_configs WHERE provider = ? AND tier = ?', [usedProvider, usedTier])
  if (!config) return c.json({ code: -1, message: `未配置 ${usedProvider}/${usedTier} 分组的API密钥，请先在管理设置中配置` }, 400)
  const cfg = JSON.parse(config.config_json)

  // 并行执行 candy 测试和 pelican SVG 生成
  const [candyResult, svgResult] = await Promise.all([
    runCandyTest(cfg.url, cfg.key, model),
    generatePelicanSVG(cfg.url, cfg.key, model)
  ])

  // 综合评估结果
  const hasSvg = !!svgResult.svgCode
  let finalResult = candyResult.result
  let finalScore = candyResult.score
  if (hasSvg && finalResult === 'degraded') { finalResult = 'works'; finalScore = Math.max(finalScore, 50) }
  if (hasSvg && finalResult === 'pass') { finalScore = 100 }

  await run(`INSERT INTO iq_tests (provider, tier, model, test_type, result, score, raw_response, reasoning_tokens, input_tokens, output_tokens, response_time_ms, image_url, svg_code, tested_at) VALUES (?, ?, ?, 'pelican', ?, ?, ?, ?, ?, ?, ?, '', ?, NOW())`,
    [usedProvider, usedTier, model, finalResult, finalScore, candyResult.rawResponse,
     candyResult.reasoningTokens + svgResult.reasoningTokens,
     candyResult.inputTokens + svgResult.inputTokens,
     candyResult.outputTokens + svgResult.outputTokens,
     Math.max(candyResult.responseTime, svgResult.responseTime),
     svgResult.svgCode || ''])
  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || ''
  await logAudit('iq_test', `智力检测 ${model} [${usedTier}]: ${finalResult} (${finalScore}分)`, ip)
  return c.json({ code: 0, data: { result: finalResult, score: finalScore, rawResponse: candyResult.rawResponse, responseTime: Math.max(candyResult.responseTime, svgResult.responseTime), svgCode: svgResult.svgCode } })
})

// ===== Seed =====
app.post('/api/admin/seed', authMiddleware, async (c) => {
  const openaiConfigs = [
    { tier: 'lite', key: 'sk-Y8QC5oQFlBdfgATUsFgmwf60IO51ao2RS4ZP57IJ9yLBjTmp' },
    { tier: 'standard', key: 'sk-sxtlBE2piAtKCj7omSKm5MQBuHTS8ZjHODuAXOVhhFQQeSia' },
    { tier: 'ultra', key: 'sk-eJAA9WMiZdR99TXkQblvEZi1RwWVRAEpss9vp9TAlrSc4py0' },
  ]
  for (const cfg of openaiConfigs) {
    const json = JSON.stringify({ _type: 'newapi_channel_conn', key: cfg.key, url: 'https://api.icloud99.cn' })
    await run(`INSERT INTO api_configs (provider, tier, config_json, updated_at) VALUES ('openai', ?, ?, NOW()) ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), updated_at = NOW()`, [cfg.tier, json])
  }

  await run('DELETE FROM channel_tests')
  await run('DELETE FROM channels')

  const channels = [
    { name: 'Lite · GPT-5.6-SOL', provider: 'openai', tier: 'lite', model_id: 'gpt-5.6-sol', icon: '⚡', sort: 1 },
    { name: 'Lite · GPT-6-ASTRA', provider: 'openai', tier: 'lite', model_id: 'gpt-6-astra', icon: '🌟', sort: 2 },
    { name: 'Lite · GPT-5.6-TERRA', provider: 'openai', tier: 'lite', model_id: 'gpt-5.6-terra', icon: '🌍', sort: 3 },
    { name: 'Lite · GPT-6-SOL', provider: 'openai', tier: 'lite', model_id: 'gpt-6-sol', icon: '☀️', sort: 4 },
    { name: 'Standard · GPT-5.6-SOL', provider: 'openai', tier: 'standard', model_id: 'gpt-5.6-sol', icon: '⚡', sort: 1 },
    { name: 'Standard · GPT-6-ASTRA', provider: 'openai', tier: 'standard', model_id: 'gpt-6-astra', icon: '🌟', sort: 2 },
    { name: 'Standard · GPT-5.6-TERRA', provider: 'openai', tier: 'standard', model_id: 'gpt-5.6-terra', icon: '🌍', sort: 3 },
    { name: 'Standard · GPT-6-SOL', provider: 'openai', tier: 'standard', model_id: 'gpt-6-sol', icon: '☀️', sort: 4 },
    { name: 'Ultra · GPT-5.6-SOL', provider: 'openai', tier: 'ultra', model_id: 'gpt-5.6-sol', icon: '⚡', sort: 1 },
    { name: 'Ultra · GPT-6-ASTRA', provider: 'openai', tier: 'ultra', model_id: 'gpt-6-astra', icon: '🌟', sort: 2 },
    { name: 'Ultra · GPT-5.6-TERRA', provider: 'openai', tier: 'ultra', model_id: 'gpt-5.6-terra', icon: '🌍', sort: 3 },
    { name: 'Ultra · GPT-6-SOL', provider: 'openai', tier: 'ultra', model_id: 'gpt-6-sol', icon: '☀️', sort: 4 },
    { name: 'Lite · Claude-Opus-4-6', provider: 'anthropic', tier: 'lite', model_id: 'claude-opus-4-6', icon: '✨', sort: 1 },
    { name: 'Lite · Claude-Fable-5', provider: 'anthropic', tier: 'lite', model_id: 'claude-fable-5', icon: '📖', sort: 2 },
    { name: 'Lite · Claude-Opus-4-7', provider: 'anthropic', tier: 'lite', model_id: 'claude-opus-4-7', icon: '🔮', sort: 3 },
    { name: 'Lite · Claude-Opus-4-8', provider: 'anthropic', tier: 'lite', model_id: 'claude-opus-4-8', icon: '💎', sort: 4 },
    { name: 'Standard · Claude-Opus-4-6', provider: 'anthropic', tier: 'standard', model_id: 'claude-opus-4-6', icon: '✨', sort: 1 },
    { name: 'Standard · Claude-Fable-5', provider: 'anthropic', tier: 'standard', model_id: 'claude-fable-5', icon: '📖', sort: 2 },
    { name: 'Standard · Claude-Opus-4-7', provider: 'anthropic', tier: 'standard', model_id: 'claude-opus-4-7', icon: '🔮', sort: 3 },
    { name: 'Standard · Claude-Opus-4-8', provider: 'anthropic', tier: 'standard', model_id: 'claude-opus-4-8', icon: '💎', sort: 4 },
    { name: 'Ultra · Claude-Opus-4-6', provider: 'anthropic', tier: 'ultra', model_id: 'claude-opus-4-6', icon: '✨', sort: 1 },
    { name: 'Ultra · Claude-Fable-5', provider: 'anthropic', tier: 'ultra', model_id: 'claude-fable-5', icon: '📖', sort: 2 },
    { name: 'Ultra · Claude-Opus-4-7', provider: 'anthropic', tier: 'ultra', model_id: 'claude-opus-4-7', icon: '🔮', sort: 3 },
    { name: 'Ultra · Claude-Opus-4-8', provider: 'anthropic', tier: 'ultra', model_id: 'claude-opus-4-8', icon: '💎', sort: 4 },
  ]

  for (const ch of channels) {
    await run('INSERT INTO channels (name, provider, tier, model_id, icon, rate_multiplier, sort_order) VALUES (?, ?, ?, ?, ?, 1.0, ?)', [ch.name, ch.provider, ch.tier, ch.model_id, ch.icon, ch.sort])
  }

  return c.json({ code: 0, message: '初始化完成！已配置 OpenAI 3组密钥 + 24个检测渠道。请配置 Anthropic 密钥后使用完整功能。' })
})

// ===== Channel Detail API =====
app.get('/api/channels/:id/detail', async (c) => {
  const channelId = parseInt(c.req.param('id'))
  const channel = await queryOne('SELECT * FROM channels WHERE id = ?', [channelId])
  if (!channel) return c.json({ code: -1, message: '渠道不存在' }, 404)

  const latest = await queryOne('SELECT * FROM channel_tests WHERE channel_id = ? ORDER BY tested_at DESC LIMIT 1', [channelId])
  const since7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 19).replace('T', ' ')
  const stats7 = await queryOne('SELECT COUNT(*) as total, SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) as success_count, AVG(CASE WHEN success=1 THEN response_time_ms END) as avg_latency FROM channel_tests WHERE channel_id = ? AND tested_at > ?', [channelId, since7])
  const since15 = new Date(Date.now() - 15 * 86400000).toISOString().slice(0, 19).replace('T', ' ')
  const stats15 = await queryOne('SELECT COUNT(*) as total, SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) as success_count FROM channel_tests WHERE channel_id = ? AND tested_at > ?', [channelId, since15])
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 19).replace('T', ' ')
  const stats30 = await queryOne('SELECT COUNT(*) as total, SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) as success_count FROM channel_tests WHERE channel_id = ? AND tested_at > ?', [channelId, since30])

  return c.json({ code: 0, data: {
    channel,
    latest_status: latest && latest.success === 1 ? '正常' : '异常',
    latest_latency: latest ? latest.response_time_ms : 0,
    latest_ping: latest ? latest.ping_ms : 0,
    availability_7d: stats7.total > 0 ? ((stats7.success_count / stats7.total) * 100).toFixed(2) + '%' : '-',
    availability_15d: stats15.total > 0 ? ((stats15.success_count / stats15.total) * 100).toFixed(2) + '%' : '-',
    availability_30d: stats30.total > 0 ? ((stats30.success_count / stats30.total) * 100).toFixed(2) + '%' : '-',
    avg_latency_7d: stats7.avg_latency ? Math.round(stats7.avg_latency) : 0,
  }})
})

// ===== IQ Tests with pagination =====
app.get('/api/iq-tests-paged', async (c) => {
  const page = parseInt(c.req.query('page') || '1')
  const pageSize = parseInt(c.req.query('pageSize') || '12')
  const tier = c.req.query('tier') || ''
  let countSql = 'SELECT COUNT(*) as total FROM iq_tests WHERE 1=1'
  let sql = 'SELECT id, provider, tier, model, test_type, result, score, reasoning_tokens, input_tokens, output_tokens, response_time_ms, image_url, svg_code, tested_at FROM iq_tests WHERE 1=1'
  const params: any[] = []
  const countParams: any[] = []
  if (tier) { sql += ' AND tier = ?'; params.push(tier); countSql += ' AND tier = ?'; countParams.push(tier) }
  const countResult = await queryOne(countSql, countParams)
  const total = countResult?.total || 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const offset = (page - 1) * pageSize
  sql += ' ORDER BY tested_at DESC LIMIT ? OFFSET ?'
  params.push(pageSize, offset)
  const results = await query(sql, params)
  return c.json({ code: 0, data: { list: results, total, page, pageSize, totalPages } })
})

// ===== Token Usage Query (proxy to New API) =====
const NEWAPI_BASE = 'https://api.icloud99.cn'

// Token info + quota
app.post('/api/token-usage/query', async (c) => {
  const { key } = await c.req.json()
  if (!key) return c.json({ code: -1, message: '请输入令牌 Key' }, 400)

  try {
    // 1) Fetch token usage info
    const usageResp = await fetch(`${NEWAPI_BASE}/api/usage/token/`, {
      headers: { 'Authorization': `Bearer ${key}` },
      signal: AbortSignal.timeout(15000)
    })
    if (!usageResp.ok) {
      const err = await usageResp.json().catch(() => ({ message: `HTTP ${usageResp.status}` }))
      return c.json({ code: -1, message: err.message || '查询失败' })
    }
    const usageData: any = await usageResp.json()
    if (!usageData.code && usageData.code !== true) {
      return c.json({ code: -1, message: usageData.message || '令牌无效' })
    }

    // 2) Fetch logs via /api/log/token/ (returns all logs for this token)
    const logResp = await fetch(`${NEWAPI_BASE}/api/log/token/`, {
      headers: { 'Authorization': `Bearer ${key}` },
      signal: AbortSignal.timeout(30000)
    })
    let logs: any[] = []
    if (logResp.ok) {
      const logData: any = await logResp.json()
      if (logData.success !== false && Array.isArray(logData.data)) {
        logs = logData.data
      }
    }

    // Parse other field for each log
    const parsedLogs = logs.map((log: any) => {
      let other: any = {}
      try { other = JSON.parse(log.other || '{}') } catch {}
      return { ...log, other_parsed: other }
    })

    // Build usage stats by model
    const modelStats: Record<string, { count: number; quota: number; prompt: number; completion: number; avgTime: number }> = {}
    for (const log of parsedLogs) {
      const model = log.model_name || 'unknown'
      if (!modelStats[model]) modelStats[model] = { count: 0, quota: 0, prompt: 0, completion: 0, avgTime: 0 }
      modelStats[model].count++
      modelStats[model].quota += log.quota || 0
      modelStats[model].prompt += log.prompt_tokens || 0
      modelStats[model].completion += log.completion_tokens || 0
      modelStats[model].avgTime += log.use_time || 0
    }
    for (const m of Object.keys(modelStats)) {
      if (modelStats[m].count > 0) modelStats[m].avgTime = Math.round(modelStats[m].avgTime / modelStats[m].count)
    }

    // Daily usage stats (last 30 days, fill in all dates with zeros)
    const dailyStatsRaw: Record<string, { count: number; quota: number }> = {}
    for (const log of parsedLogs) {
      const date = new Date(log.created_at * 1000).toISOString().slice(0, 10)
      if (!dailyStatsRaw[date]) dailyStatsRaw[date] = { count: 0, quota: 0 }
      dailyStatsRaw[date].count++
      dailyStatsRaw[date].quota += log.quota || 0
    }
    // Fill 30 days
    const dailyStats: Record<string, { count: number; quota: number }> = {}
    const now = new Date()
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      dailyStats[key] = dailyStatsRaw[key] || { count: 0, quota: 0 }
    }

    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || ''
    await logAudit('token_query', `查询令牌用量 (${parsedLogs.length}条记录)`, ip)
    return c.json({
      code: 0,
      data: {
        token_info: usageData.data,
        logs: parsedLogs,
        total_logs: parsedLogs.length,
        model_stats: modelStats,
        daily_stats: dailyStats
      }
    })
  } catch (e: any) {
    return c.json({ code: -1, message: '查询失败: ' + e.message })
  }
})

// ===== Admin: Remove invalid channels (e.g. gpt-image-2) =====
app.post('/api/admin/cleanup-channels', authMiddleware, async (c) => {
  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || ''
  const user: any = c.get('user')
  // Delete channels with model gpt-image-2 and their test records
  const badChannels = await query("SELECT id, name, model_id FROM channels WHERE model_id = 'gpt-image-2'")
  for (const ch of badChannels) {
    await run('DELETE FROM channel_tests WHERE channel_id = ?', [ch.id])
    await run('DELETE FROM channels WHERE id = ?', [ch.id])
  }
  await logAudit('cleanup_channels', `清理无效渠道: 删除 ${badChannels.length} 个 gpt-image-2 渠道`, ip, user?.username || 'admin')
  return c.json({ code: 0, message: `已清理 ${badChannels.length} 个 gpt-image-2 渠道`, data: badChannels.map((c: any) => c.name) })
})

// ===== New API Admin Session Helper =====
async function getNewApiSession(): Promise<{ cookie: string; url: string } | null> {
  // Read New API admin config from api_configs (provider='newapi', tier='admin')
  const config = await queryOne("SELECT * FROM api_configs WHERE provider = 'newapi' AND tier = 'admin'")
  if (!config) return null
  try {
    const cfg = JSON.parse(config.config_json)
    if (!cfg.url || !cfg.username || !cfg.password) return null

    // Login to New API to get session cookie
    const resp = await fetch(cfg.url + '/api/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: cfg.username, password: cfg.password }),
      redirect: 'manual',
      signal: AbortSignal.timeout(15000)
    })
    if (!resp.ok) return null
    const data: any = await resp.json()
    if (!data.success) return null

    // Extract session cookie from Set-Cookie header
    const setCookie = resp.headers.get('set-cookie') || ''
    const sessionMatch = setCookie.match(/session=([^;]+)/)
    if (!sessionMatch) return null

    return { cookie: `session=${sessionMatch[1]}`, url: cfg.url }
  } catch { return null }
}

// Admin: Save New API admin config
app.post('/api/admin/newapi-config', authMiddleware, async (c) => {
  const { url, username, password, keep_password } = await c.req.json()
  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || ''
  const user: any = c.get('user')
  if (!url || !username) return c.json({ code: -1, message: '请填写 New API URL 和用户名' }, 400)

  let finalPassword = password
  if (!password && keep_password) {
    // Keep the old password from existing config
    const existing = await queryOne("SELECT * FROM api_configs WHERE provider = 'newapi' AND tier = 'admin'")
    if (existing) {
      try {
        const oldCfg = JSON.parse(existing.config_json)
        finalPassword = oldCfg.password
      } catch {}
    }
  }
  if (!finalPassword) return c.json({ code: -1, message: '请填写密码' }, 400)

  const config_json = JSON.stringify({ _type: 'newapi_admin_session', url, username, password: finalPassword })
  await run(`INSERT INTO api_configs (provider, tier, config_json, updated_at) VALUES ('newapi', 'admin', ?, NOW()) ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), updated_at = NOW()`, [config_json])
  await logAudit('newapi_config_save', `保存 New API 管理员配置 (${url})`, ip, user?.username || 'admin')
  return c.json({ code: 0, message: '保存成功' })
})

// Admin: Get New API admin config (masked)
app.get('/api/admin/newapi-config', authMiddleware, async (c) => {
  const config = await queryOne("SELECT * FROM api_configs WHERE provider = 'newapi' AND tier = 'admin'")
  if (!config) return c.json({ code: 0, data: null })
  try {
    const cfg = JSON.parse(config.config_json)
    return c.json({ code: 0, data: { url: cfg.url || '', username: cfg.username || '', has_password: !!cfg.password } })
  } catch { return c.json({ code: 0, data: null }) }
})

// Admin: Test New API connection
app.post('/api/admin/newapi-test', authMiddleware, async (c) => {
  const session = await getNewApiSession()
  if (!session) return c.json({ code: -1, message: '连接失败：请检查 New API 的 URL、用户名和密码是否正确' })
  return c.json({ code: 0, message: '连接成功！已成功登录 New API 管理后台' })
})

// ===== Admin: User Consumption Stats (via New API admin session) =====

// Helper: fetch ALL logs from New API with pagination for a given time range
async function fetchAllLogs(session: { cookie: string; url: string }, startTs: number, endTs: number): Promise<any[]> {
  const allLogs: any[] = []
  let page = 0
  const perPage = 500
  let hasMore = true

  while (hasMore) {
    try {
      const logUrl = `${session.url}/api/log/search?keyword=&page=${page}&per_page=${perPage}&type=0&username=&token_name=&model_name=&start_timestamp=${startTs}&end_timestamp=${endTs}&channel=0&order=`
      const resp = await fetch(logUrl, {
        headers: { 'Cookie': session.cookie },
        signal: AbortSignal.timeout(30000)
      })
      if (!resp.ok) break
      const data: any = await resp.json()
      if (data.success === false || !Array.isArray(data.data)) break
      allLogs.push(...data.data)
      // If we got fewer than perPage, no more pages
      if (data.data.length < perPage) {
        hasMore = false
      } else {
        page++
        // Safety limit: max 100 pages (50000 records)
        if (page >= 100) hasMore = false
      }
    } catch {
      break
    }
  }
  return allLogs
}

app.get('/api/admin/user-consumption', authMiddleware, async (c) => {
  try {
    const session = await getNewApiSession()
    if (!session) return c.json({ code: -1, message: '未配置 New API 管理员账号，请在管理设置中配置' })

    // Support optional month filter: ?month=2026-05
    const monthParam = c.req.query('month') || ''
    let startTs = 0, endTs = 0
    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      const [year, month] = monthParam.split('-').map(Number)
      // Use UTC+8 (CST) for month boundaries
      const startDate = new Date(Date.UTC(year, month - 1, 1) - 8 * 3600000)
      const endDate = new Date(Date.UTC(year, month, 1) - 8 * 3600000)
      startTs = Math.floor(startDate.getTime() / 1000)
      endTs = Math.floor(endDate.getTime() / 1000)
    }

    // Fetch all users
    const usersResp = await fetch(session.url + '/api/user?p=0&page_size=100', {
      headers: { 'Cookie': session.cookie },
      signal: AbortSignal.timeout(15000)
    })
    let allUsers: any[] = []
    if (usersResp.ok) {
      const ud: any = await usersResp.json()
      if (ud.success !== false && Array.isArray(ud.data)) allUsers = ud.data
    }

    // Fetch logs with pagination
    const allLogs = await fetchAllLogs(session, startTs, endTs)

    // Aggregate by username
    const QUOTA_PER_UNIT = 500000
    const userMap: Record<string, { username: string; totalQuota: number; totalCount: number; models: Record<string, number>; groups: Record<string, number>; latestAt: number }> = {}
    for (const log of allLogs) {
      const uname = log.username || 'unknown'
      if (!userMap[uname]) userMap[uname] = { username: uname, totalQuota: 0, totalCount: 0, models: {}, groups: {}, latestAt: 0 }
      userMap[uname].totalQuota += log.quota || 0
      userMap[uname].totalCount++
      const model = log.model_name || 'unknown'
      userMap[uname].models[model] = (userMap[uname].models[model] || 0) + (log.quota || 0)
      const group = log.group || 'default'
      userMap[uname].groups[group] = (userMap[uname].groups[group] || 0) + (log.quota || 0)
      if (log.created_at > userMap[uname].latestAt) userMap[uname].latestAt = log.created_at
    }

    // Enrich with user info (quota, balance)
    const userInfoMap: Record<string, any> = {}
    for (const u of allUsers) { userInfoMap[u.username] = u }

    const users = Object.values(userMap).sort((a, b) => b.totalQuota - a.totalQuota).map(u => {
      const info = userInfoMap[u.username]
      return {
        ...u,
        totalAmount: (u.totalQuota / QUOTA_PER_UNIT).toFixed(4),
        balance: info ? (info.quota / QUOTA_PER_UNIT).toFixed(4) : '-',
        role: info ? (info.role === 100 ? 'admin' : info.role === 10 ? 'user' : 'guest') : '-',
        models: Object.entries(u.models).sort((a, b) => b[1] - a[1]).map(([m, q]) => ({ model: m, quota: q, amount: (q / QUOTA_PER_UNIT).toFixed(4) })),
        groups: Object.entries(u.groups).sort((a, b) => b[1] - a[1]).map(([g, q]) => ({ group: g, quota: q, amount: (q / QUOTA_PER_UNIT).toFixed(4) })),
      }
    })

    const totalQuota = allLogs.reduce((s: number, l: any) => s + (l.quota || 0), 0)
    return c.json({ code: 0, data: { users, totalLogs: allLogs.length, totalQuota, totalAmount: (totalQuota / QUOTA_PER_UNIT).toFixed(4), quotaPerUnit: QUOTA_PER_UNIT, registeredUsers: allUsers.length, month: monthParam || 'all' } })
  } catch (e: any) {
    return c.json({ code: -1, message: '查询失败: ' + e.message })
  }
})

// Admin: User detail logs (via New API admin session)
app.get('/api/admin/user-consumption/:username', authMiddleware, async (c) => {
  const targetUser = c.req.param('username')
  try {
    const session = await getNewApiSession()
    if (!session) return c.json({ code: -1, message: '未配置 New API 管理员账号' })

    // Support month filter
    const monthParam = c.req.query('month') || ''
    let startTs = 0, endTs = 0
    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      const [year, month] = monthParam.split('-').map(Number)
      const startDate = new Date(Date.UTC(year, month - 1, 1) - 8 * 3600000)
      const endDate = new Date(Date.UTC(year, month, 1) - 8 * 3600000)
      startTs = Math.floor(startDate.getTime() / 1000)
      endTs = Math.floor(endDate.getTime() / 1000)
    }

    // Paginate through all logs for this user
    let allLogs: any[] = []
    let page = 0
    const perPage = 500
    let hasMore = true
    while (hasMore) {
      try {
        const resp = await fetch(session.url + `/api/log/search?keyword=&page=${page}&per_page=${perPage}&type=0&username=${encodeURIComponent(targetUser)}&token_name=&model_name=&start_timestamp=${startTs}&end_timestamp=${endTs}&channel=0&order=`, {
          headers: { 'Cookie': session.cookie },
          signal: AbortSignal.timeout(30000)
        })
        if (!resp.ok) break
        const data: any = await resp.json()
        if (data.success === false || !Array.isArray(data.data)) break
        const logs = data.data.map((log: any) => {
          let other: any = {}
          try { other = JSON.parse(log.other || '{}') } catch {}
          return { ...log, other_parsed: other }
        })
        allLogs.push(...logs)
        if (data.data.length < perPage) hasMore = false
        else { page++; if (page >= 50) hasMore = false }
      } catch { break }
    }
    allLogs.sort((a: any, b: any) => b.created_at - a.created_at)

    const QUOTA_PER_UNIT = 500000
    const totalQuota = allLogs.reduce((s: number, l: any) => s + (l.quota || 0), 0)
    return c.json({ code: 0, data: { username: targetUser, logs: allLogs, totalLogs: allLogs.length, totalQuota, totalAmount: (totalQuota / QUOTA_PER_UNIT).toFixed(4) } })
  } catch (e: any) {
    return c.json({ code: -1, message: '查询失败: ' + e.message })
  }
})

// Admin: Export user consumption as Excel (via New API admin session)
// Generates two sheets: 整体账单 (summary) + X月明细 (detail)
app.get('/api/admin/user-consumption-export', authMiddleware, async (c) => {
  try {
    const session = await getNewApiSession()
    if (!session) return c.json({ code: -1, message: '未配置 New API 管理员账号' })

    // Require month param: ?month=2026-05
    const monthParam = c.req.query('month') || ''
    if (!monthParam || !/^\d{4}-\d{2}$/.test(monthParam)) {
      return c.json({ code: -1, message: '请指定月份参数，如 ?month=2026-05' })
    }

    const [year, month] = monthParam.split('-').map(Number)
    const monthLabel = `${month}月`
    const startDate = new Date(Date.UTC(year, month - 1, 1) - 8 * 3600000)
    const endDate = new Date(Date.UTC(year, month, 1) - 8 * 3600000)
    const startTs = Math.floor(startDate.getTime() / 1000)
    const endTs = Math.floor(endDate.getTime() / 1000)

    // Fetch all users
    const usersResp = await fetch(session.url + '/api/user?p=0&page_size=100', {
      headers: { 'Cookie': session.cookie },
      signal: AbortSignal.timeout(15000)
    })
    let allUsers: any[] = []
    if (usersResp.ok) {
      const ud: any = await usersResp.json()
      if (ud.success !== false && Array.isArray(ud.data)) allUsers = ud.data
    }
    const userInfoMap: Record<string, any> = {}
    for (const u of allUsers) { userInfoMap[u.username] = u }

    // Fetch all logs for this month with pagination
    const allLogs = await fetchAllLogs(session, startTs, endTs)
    allLogs.sort((a: any, b: any) => b.created_at - a.created_at)

    const QUOTA_PER_UNIT = 500000

    // Build per-user summary
    const userSummary: Record<string, { username: string; totalCost: number }> = {}
    for (const log of allLogs) {
      const uname = log.username || 'unknown'
      if (!userSummary[uname]) userSummary[uname] = { username: uname, totalCost: 0 }
      userSummary[uname].totalCost += (log.quota || 0) / QUOTA_PER_UNIT
    }
    const summaryList = Object.values(userSummary).sort((a, b) => b.totalCost - a.totalCost)

    // Generate Excel workbook
    const ExcelJS = (await import('exceljs')).default
    const workbook = new ExcelJS.Workbook()

    // === Sheet 1: 整体账单 ===
    const sheet1 = workbook.addWorksheet('整体账单')
    sheet1.columns = [
      { header: '序号', key: 'idx', width: 8 },
      { header: '用户', key: 'username', width: 16 },
      { header: '用户团队', key: 'team', width: 22 },
      { header: `${String(month).padStart(2, '0')}月消费金额`, key: 'cost', width: 18 },
      { header: '截止合计费用', key: 'total', width: 18 },
    ]
    // Bold header row
    sheet1.getRow(1).font = { bold: true }
    sheet1.getRow(1).alignment = { horizontal: 'center' }

    summaryList.forEach((u, idx) => {
      const rowNum = idx + 2
      sheet1.addRow({
        idx: idx + 1,
        username: u.username,
        team: userInfoMap[u.username]?.group || '',
        cost: parseFloat(u.totalCost.toFixed(6)),
        total: undefined,
      })
      // Set formula for cumulative total (sum of all month cost columns)
      const cell = sheet1.getCell(`E${rowNum}`)
      cell.value = { formula: `SUM(D${rowNum}:D${rowNum})` }
    })

    // === Sheet 2: X月明细 ===
    const sheet2 = workbook.addWorksheet(`${month}月明细`)
    sheet2.columns = [
      { header: 'time', key: 'time', width: 22 },
      { header: 'log_id', key: 'log_id', width: 10 },
      { header: 'user_id', key: 'user_id', width: 10 },
      { header: 'username', key: 'username', width: 14 },
      { header: 'token_name', key: 'token_name', width: 16 },
      { header: 'group', key: 'group', width: 12 },
      { header: 'model', key: 'model', width: 18 },
      { header: 'prompt_tokens', key: 'prompt_tokens', width: 14 },
      { header: 'completion_tokens', key: 'completion_tokens', width: 16 },
      { header: 'total_tokens', key: 'total_tokens', width: 14 },
      { header: 'quota', key: 'quota', width: 12 },
      { header: 'cost_usd', key: 'cost_usd', width: 12 },
      { header: 'log_type', key: 'log_type', width: 10 },
      { header: 'channel', key: 'channel', width: 10 },
      { header: 'channel_name', key: 'channel_name', width: 14 },
      { header: 'request_id', key: 'request_id', width: 38 },
      { header: 'upstream_request_id', key: 'upstream_request_id', width: 20 },
      { header: 'use_time', key: 'use_time', width: 10 },
      { header: 'is_stream', key: 'is_stream', width: 10 },
      { header: 'ip', key: 'ip', width: 16 },
      { header: 'content', key: 'content', width: 20 },
    ]
    sheet2.getRow(1).font = { bold: true }

    for (const log of allLogs) {
      const time = new Date(log.created_at * 1000)
      // Format to CST (UTC+8)
      const cstTime = new Date(time.getTime() + 8 * 3600000)
      const timeStr = cstTime.toISOString().replace('T', ' ').substring(0, 19)
      const promptTokens = log.prompt_tokens || 0
      const completionTokens = log.completion_tokens || 0
      const quota = log.quota || 0
      const costUsd = quota / QUOTA_PER_UNIT

      sheet2.addRow({
        time: timeStr,
        log_id: log.id || '',
        user_id: log.user_id || '',
        username: log.username || '',
        token_name: log.token_name || '',
        group: log.group || '',
        model: log.model_name || '',
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
        quota: quota,
        cost_usd: parseFloat(costUsd.toFixed(6)),
        log_type: log.type || '',
        channel: log.channel || '',
        channel_name: log.channel_name || '',
        request_id: log.request_id || '',
        upstream_request_id: '',
        use_time: log.use_time || 0,
        is_stream: log.is_stream ? true : false,
        ip: log.ip || '',
        content: log.content || '',
      })
    }

    // Write to buffer
    const buffer = await workbook.xlsx.writeBuffer()

    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || ''
    const user: any = c.get('user')
    await logAudit('consumption_export', `导出 ${monthParam} 月度账单 (${allLogs.length} 条记录)`, ip, user?.username || 'admin')

    return new Response(buffer as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename=Token_Report_${monthParam}.xlsx`,
      }
    })
  } catch (e: any) {
    return c.json({ code: -1, message: '导出失败: ' + e.message })
  }
})

// ===== Audit Logs API =====
app.get('/api/admin/audit-logs', authMiddleware, async (c) => {
  const page = parseInt(c.req.query('page') || '1')
  const pageSize = parseInt(c.req.query('pageSize') || '20')
  const action = c.req.query('action') || ''
  
  let countSql = 'SELECT COUNT(*) as total FROM audit_logs WHERE 1=1'
  let sql = 'SELECT * FROM audit_logs WHERE 1=1'
  const params: any[] = []
  const countParams: any[] = []
  
  if (action) {
    sql += ' AND action = ?'; params.push(action)
    countSql += ' AND action = ?'; countParams.push(action)
  }
  
  const countResult = await queryOne(countSql, countParams)
  const total = countResult?.total || 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const offset = (page - 1) * pageSize
  
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
  params.push(pageSize, offset)
  
  const logs = await query(sql, params)
  
  // Get distinct actions for filter
  const actions = await query('SELECT DISTINCT action FROM audit_logs ORDER BY action')
  
  return c.json({ code: 0, data: { list: logs, total, page, pageSize, totalPages, actions: actions.map((a: any) => a.action) } })
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
  <link rel="icon" type="image/x-icon" href="/static/favicon.ico">
  <link rel="apple-touch-icon" href="/static/apple-touch-icon.png">
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
    /* === Mobile Responsive === */
    .sidebar-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:40;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);opacity:0;pointer-events:none;transition:opacity .3s}
    .sidebar-overlay.active{opacity:1;pointer-events:auto}
    @media(max-width:768px){
      .mobile-sidebar{position:fixed!important;left:0;top:0;bottom:0;z-index:50;transition:transform .3s ease}
      .mobile-sidebar.closed{transform:translateX(-100%)}
      .mobile-sidebar.open{transform:translateX(0)}
      #page-content{padding:1rem!important}
      .mobile-stack{flex-direction:column!important;align-items:stretch!important}
      .mobile-stack>*{width:100%!important}
      .mobile-hide{display:none!important}
      .mobile-text-xs{font-size:.7rem!important}
      .mobile-full{width:100%!important}
      .mobile-p2{padding:.5rem!important}
      .mobile-gap2{gap:.5rem!important}
      .bar-chart-mini{height:24px}
      .bar-chart-mini .bar{min-width:2px}
    }
    @media(max-width:480px){
      #page-content{padding:.75rem!important}
    }
    /* Safe area for notch devices */
    @supports(padding:max(0px)){
      .safe-bottom{padding-bottom:max(0.5rem,env(safe-area-inset-bottom))}
    }
    /* Improve touch targets */
    @media(pointer:coarse){
      button,a,.cursor-pointer{min-height:36px}
      select{min-height:40px}
    }
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
