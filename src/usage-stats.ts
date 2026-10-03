// ============================================================================
// 用户用量统计（指定周期内全站所有用户的账单统计）
// ----------------------------------------------------------------------------
// 数据源策略（参考 fetch_token_billing_v2.py，并针对 New API v0.13 优化）：
//   · 用户列表   : /api/user/ （p 从 1 开始，page_size=100）
//   · 用户汇总   : /api/data/?username=X  小时级 × 模型 预聚合（quota / count / token_used）
//                  只对 request_count>0 的用户请求，0 消耗用户直接跳过
//   · 全站校验   : /api/log/stat（type=2），与各用户合计对账；不一致时回退到逐用户 stat
//   · 调用明细   : /api/log/ （分页，p 从 1 开始）
// 时间口径：北京时间（UTC+8）自然日/自然月
// ============================================================================
import type { Hono } from 'hono'
import * as na from './newapi-client.js'

type Deps = {
  queryOne: (sql: string, params?: any[]) => Promise<any>
  run: (sql: string, params?: any[]) => Promise<any>
  logAudit: (action: string, detail: string, ip?: string, user?: string) => Promise<void>
  authMiddleware: any
}

const TZ_OFFSET_SEC = 8 * 3600
const MAX_RANGE_DAYS = 400
const CACHE_TTL_MS = 5 * 60 * 1000
const USER_CONCURRENCY = 3

// ---------------------------------------------------------------------------
// 时间工具（北京时间）
// ---------------------------------------------------------------------------
/** 'YYYY-MM-DD' -> 当日 00:00:00 CST 的 unix 秒 */
function dayStartTs(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 1000) - TZ_OFFSET_SEC
}
/** unix 秒 -> 'YYYY-MM-DD' (CST) */
function tsToDay(ts: number): string {
  return new Date((ts + TZ_OFFSET_SEC) * 1000).toISOString().slice(0, 10)
}
function tsToDateTime(ts: number): string {
  return new Date((ts + TZ_OFFSET_SEC) * 1000).toISOString().replace('T', ' ').slice(0, 19)
}
function todayCST(): string { return tsToDay(Math.floor(Date.now() / 1000)) }

type Period = { start: string; end: string; startTs: number; endTs: number; days: number; label: string }

/** 解析周期：支持 start/end（YYYY-MM-DD，含首尾）或 month=YYYY-MM */
function parsePeriod(q: (k: string) => string | undefined): Period {
  let start = q('start') || '', end = q('end') || ''
  const month = q('month') || ''
  if (!start && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split('-').map(Number)
    start = `${month}-01`
    end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  }
  if (!start) { const t = todayCST(); start = t.slice(0, 8) + '01'; end = t }
  if (!end) end = todayCST()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new Error('日期格式应为 YYYY-MM-DD')
  if (start > end) [start, end] = [end, start]
  const startTs = dayStartTs(start)
  const endTs = dayStartTs(end) + 86400 - 1
  const days = Math.round((endTs + 1 - startTs) / 86400)
  if (days > MAX_RANGE_DAYS) throw new Error(`统计周期最长 ${MAX_RANGE_DAYS} 天`)
  return { start, end, startTs, endTs, days, label: start === end ? start : `${start} ~ ${end}` }
}

function listDays(p: Period): string[] {
  const out: string[] = []
  for (let ts = p.startTs; ts <= p.endTs; ts += 86400) out.push(tsToDay(ts))
  return out
}
function listMonths(p: Period): string[] {
  const out: string[] = []
  let [y, m] = p.start.slice(0, 7).split('-').map(Number)
  const [ey, em] = p.end.slice(0, 7).split('-').map(Number)
  while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++ } }
  return out
}

// ---------------------------------------------------------------------------
// 货币显示（跟随 New API 站点设置）
// ---------------------------------------------------------------------------
type Currency = { quotaPerUnit: number; symbol: string; rate: number; code: string }
async function getCurrency(cfg: na.NewApiCfg): Promise<Currency> {
  const st = await na.getStatus(cfg)
  const quotaPerUnit = Number(st.quota_per_unit) || 500000
  const type = String(st.quota_display_type || 'USD').toUpperCase()
  if (type === 'CNY') return { quotaPerUnit, symbol: '¥', rate: Number(st.usd_exchange_rate) || 7.3, code: 'CNY' }
  if (type === 'CUSTOM') return { quotaPerUnit, symbol: st.custom_currency_symbol || '¤', rate: Number(st.custom_currency_exchange_rate) || 1, code: 'CUSTOM' }
  return { quotaPerUnit, symbol: '$', rate: 1, code: 'USD' }
}
const toMoney = (quota: number, c: Currency) => (quota / c.quotaPerUnit) * c.rate
const round6 = (n: number) => Math.round(n * 1e6) / 1e6

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------
async function loadCfg(deps: Deps): Promise<na.NewApiCfg | null> {
  const row = await deps.queryOne("SELECT config_json FROM api_configs WHERE provider = 'newapi' AND tier = 'admin'")
  if (!row) return null
  try {
    const c = JSON.parse(row.config_json)
    if (!c.url || !c.username || !c.password) return null
    return { url: String(c.url).replace(/\/+$/, ''), username: c.username, password: c.password }
  } catch { return null }
}

// ---------------------------------------------------------------------------
// 核心：周期汇总
// ---------------------------------------------------------------------------
type UserAgg = {
  id: number; username: string; displayName: string; group: string; role: number; status: number
  balanceQuota: number; quota: number; count: number; tokens: number
  models: Record<string, { quota: number; count: number; tokens: number }>
  days: Record<string, number>; months: Record<string, number>
  firstAt: number; lastAt: number
}

const summaryCache = new Map<string, { at: number; data: any }>()
const inflight = new Map<string, Promise<any>>()

async function buildSummary(cfg: na.NewApiCfg, p: Period) {
  const t0 = Date.now()
  const [currency, users] = await Promise.all([getCurrency(cfg), na.listAllUsers(cfg)])

  // 只有历史上产生过请求的用户才可能在周期内有消费
  const candidates = users.filter(u => Number(u.request_count || 0) > 0 || Number(u.used_quota || 0) > 0)
  const errors: string[] = []

  const aggs: UserAgg[] = users.map(u => ({
    id: u.id, username: u.username, displayName: u.display_name || '', group: u.group || '', role: Number(u.role || 0),
    status: Number(u.status || 0), balanceQuota: Number(u.quota || 0), quota: 0, count: 0, tokens: 0,
    models: {}, days: {}, months: {}, firstAt: 0, lastAt: 0,
  }))
  const byName = new Map(aggs.map(a => [a.username, a]))

  await na.mapPool(candidates, USER_CONCURRENCY, async (u) => {
    const a = byName.get(u.username)!
    try {
      const rows = await na.quotaData(cfg, p.startTs, p.endTs, u.username)
      for (const r of rows) {
        if (r.username && r.username !== u.username) continue
        const q = Number(r.quota || 0), c = Number(r.count || 0), t = Number(r.token_used || 0), ts = Number(r.created_at || 0)
        if (ts < p.startTs || ts > p.endTs) continue
        a.quota += q; a.count += c; a.tokens += t
        const mk = r.model_name || 'unknown'
        const m = a.models[mk] || (a.models[mk] = { quota: 0, count: 0, tokens: 0 })
        m.quota += q; m.count += c; m.tokens += t
        const day = tsToDay(ts)
        a.days[day] = (a.days[day] || 0) + q
        const mon = day.slice(0, 7)
        a.months[mon] = (a.months[mon] || 0) + q
        if (!a.firstAt || ts < a.firstAt) a.firstAt = ts
        if (ts > a.lastAt) a.lastAt = ts
      }
    } catch (e: any) {
      errors.push(`${u.username}: ${e.message}`)
    }
  })

  // 全站对账：/api/log/stat 是 New API 后台「消耗统计」的同一口径
  let siteQuota = -1
  try { siteQuota = await na.logStat(cfg, p.startTs, p.endTs) } catch (e: any) { errors.push(`site stat: ${e.message}`) }
  let sumQuota = aggs.reduce((s, a) => s + a.quota, 0)
  let source = 'quota_data'

  // 若 quota_data 未开启或数据不全（误差 > 0.1%），回退：逐用户 /api/log/stat 校正金额
  if (siteQuota >= 0 && Math.abs(siteQuota - sumQuota) > Math.max(1000, siteQuota * 0.001)) {
    source = 'log_stat_fallback'
    await na.mapPool(candidates, USER_CONCURRENCY, async (u) => {
      const a = byName.get(u.username)!
      try { a.quota = await na.logStat(cfg, p.startTs, p.endTs, u.username) } catch (e: any) { errors.push(`stat ${u.username}: ${e.message}`) }
    })
    sumQuota = aggs.reduce((s, a) => s + a.quota, 0)
  }

  const allDays = listDays(p)
  const allMonths = listMonths(p)
  const dailyQuota: Record<string, number> = Object.fromEntries(allDays.map(d => [d, 0]))
  const modelTotals: Record<string, { quota: number; count: number; tokens: number; users: number }> = {}
  const groupTotals: Record<string, { quota: number; users: number }> = {}
  for (const a of aggs) {
    for (const [d, q] of Object.entries(a.days)) if (d in dailyQuota) dailyQuota[d] += q
    for (const [m, v] of Object.entries(a.models)) {
      const t = modelTotals[m] || (modelTotals[m] = { quota: 0, count: 0, tokens: 0, users: 0 })
      t.quota += v.quota; t.count += v.count; t.tokens += v.tokens; t.users++
    }
    if (a.quota > 0) {
      const g = groupTotals[a.group || 'default'] || (groupTotals[a.group || 'default'] = { quota: 0, users: 0 })
      g.quota += a.quota; g.users++
    }
  }

  const m = (q: number) => round6(toMoney(q, currency))
  const userRows = aggs
    .sort((x, y) => y.quota - x.quota || x.id - y.id)
    .map(a => ({
      id: a.id, username: a.username, displayName: a.displayName, group: a.group, role: a.role, status: a.status,
      quota: a.quota, amount: m(a.quota), count: a.count, tokens: a.tokens,
      balance: m(a.balanceQuota),
      share: sumQuota > 0 ? a.quota / sumQuota : 0,
      monthAmounts: Object.fromEntries(allMonths.map(mm => [mm, m(a.months[mm] || 0)])),
      topModels: Object.entries(a.models).sort((x, y) => y[1].quota - x[1].quota).slice(0, 5)
        .map(([model, v]) => ({ model, quota: v.quota, amount: m(v.quota), count: v.count, tokens: v.tokens })),
      firstAt: a.firstAt, lastAt: a.lastAt,
    }))

  const activeUsers = userRows.filter(u => u.quota > 0 || u.count > 0).length
  return {
    period: p,
    currency: { symbol: currency.symbol, code: currency.code, rate: currency.rate, quotaPerUnit: currency.quotaPerUnit },
    totals: {
      quota: sumQuota, amount: m(sumQuota), count: aggs.reduce((s, a) => s + a.count, 0),
      tokens: aggs.reduce((s, a) => s + a.tokens, 0),
      registeredUsers: users.length, activeUsers,
      avgPerActiveUser: activeUsers ? m(sumQuota / activeUsers) : 0,
      siteQuota, siteAmount: siteQuota >= 0 ? m(siteQuota) : null,
      reconciled: siteQuota >= 0 ? Math.abs(siteQuota - sumQuota) <= Math.max(1000, siteQuota * 0.001) : null,
    },
    months: allMonths,
    daily: allDays.map(d => ({ day: d, quota: dailyQuota[d], amount: m(dailyQuota[d]) })),
    models: Object.entries(modelTotals).sort((x, y) => y[1].quota - x[1].quota)
      .map(([model, v]) => ({ model, ...v, amount: m(v.quota) })),
    groups: Object.entries(groupTotals).sort((x, y) => y[1].quota - x[1].quota)
      .map(([group, v]) => ({ group, ...v, amount: m(v.quota) })),
    users: userRows,
    meta: { source, candidates: candidates.length, errors, elapsedMs: Date.now() - t0, generatedAt: Date.now() },
  }
}

async function getSummary(cfg: na.NewApiCfg, p: Period, refresh = false) {
  const key = `${cfg.url}|${p.startTs}|${p.endTs}`
  const hit = summaryCache.get(key)
  // 包含今天的周期缓存 5 分钟；纯历史周期缓存 1 小时
  const ttl = p.endTs >= Math.floor(Date.now() / 1000) - 86400 ? CACHE_TTL_MS : 12 * CACHE_TTL_MS
  if (!refresh && hit && Date.now() - hit.at < ttl) return { ...hit.data, meta: { ...hit.data.meta, cached: true } }
  if (inflight.has(key)) return inflight.get(key)!
  const job = buildSummary(cfg, p)
    .then(data => { summaryCache.set(key, { at: Date.now(), data }); if (summaryCache.size > 50) summaryCache.delete(summaryCache.keys().next().value!); return data })
    .finally(() => inflight.delete(key))
  inflight.set(key, job)
  return job
}

// ---------------------------------------------------------------------------
// 明细拉取（导出用）：按时间倒序取最新 maxRows 行
// ---------------------------------------------------------------------------
async function fetchDetailRows(cfg: na.NewApiCfg, p: Period, maxRows: number, username = ''): Promise<{ rows: any[]; total: number }> {
  const first = await na.listLogs(cfg, { page: 1, startTs: p.startTs, endTs: p.endTs, username })
  const total = first.total
  const want = Math.min(total, maxRows)
  const pages = Math.ceil(want / na.NEWAPI_PAGE_SIZE)
  const rest = Array.from({ length: Math.max(0, pages - 1) }, (_, i) => i + 2)
  const chunks = await na.mapPool(rest, 2, async (pg) => (await na.listLogs(cfg, { page: pg, startTs: p.startTs, endTs: p.endTs, username })).items)
  const seen = new Set<number>()
  const rows: any[] = []
  for (const it of [first.items, ...chunks].flat()) {
    if (it && !seen.has(it.id)) { seen.add(it.id); rows.push(it) }
  }
  return { rows: rows.slice(0, maxRows), total }
}

// ---------------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------------
export function registerUsageRoutes(app: Hono<any>, deps: Deps) {
  const { authMiddleware } = deps
  const ipOf = (c: any) => c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || ''
  const fail = (c: any, e: any, prefix = '查询失败') => c.json({ code: -1, message: `${prefix}: ${e?.message || e}` })

  // ---- New API 管理员配置 ----
  app.post('/api/admin/newapi-config', authMiddleware, async (c: any) => {
    const { url, username, password, keep_password } = await c.req.json()
    if (!url || !username) return c.json({ code: -1, message: '请填写 New API URL 和用户名' }, 400)
    let finalPassword = password
    if (!password && keep_password) {
      const old = await loadCfg(deps)
      finalPassword = old?.password
    }
    if (!finalPassword) return c.json({ code: -1, message: '请填写密码' }, 400)
    const config_json = JSON.stringify({ _type: 'newapi_admin_session', url: String(url).trim().replace(/\/+$/, ''), username: String(username).trim(), password: finalPassword })
    await deps.run(`INSERT INTO api_configs (provider, tier, config_json, updated_at) VALUES ('newapi', 'admin', ?, NOW()) ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), updated_at = NOW()`, [config_json])
    na.clearSession(); summaryCache.clear()
    await deps.logAudit('newapi_config_save', `保存 New API 管理员配置 (${url})`, ipOf(c), c.get('user')?.username || 'admin')
    return c.json({ code: 0, message: '保存成功' })
  })

  app.get('/api/admin/newapi-config', authMiddleware, async (c: any) => {
    const cfg = await loadCfg(deps)
    if (!cfg) return c.json({ code: 0, data: null })
    return c.json({ code: 0, data: { url: cfg.url, username: cfg.username, has_password: !!cfg.password } })
  })

  app.post('/api/admin/newapi-test', authMiddleware, async (c: any) => {
    const cfg = await loadCfg(deps)
    if (!cfg) return c.json({ code: -1, message: '请先保存 New API 管理员配置' })
    try {
      const r = await na.testConnection(cfg)
      return c.json({ code: 0, message: `连接成功！管理员 uid=${r.uid}，共 ${r.totalUsers} 个用户` })
    } catch (e: any) { return fail(c, e, '连接失败') }
  })

  // ---- 周期汇总 ----
  // GET /api/admin/usage/summary?start=YYYY-MM-DD&end=YYYY-MM-DD[&refresh=1]   或 ?month=YYYY-MM
  app.get('/api/admin/usage/summary', authMiddleware, async (c: any) => {
    const cfg = await loadCfg(deps)
    if (!cfg) return c.json({ code: -1, message: '未配置 New API 管理员账号，请在「管理设置 → New API」中配置' })
    try {
      const p = parsePeriod(k => c.req.query(k))
      const data = await getSummary(cfg, p, c.req.query('refresh') === '1')
      return c.json({ code: 0, data })
    } catch (e: any) { return fail(c, e) }
  })

  // ---- 单用户周期详情：模型分布 + 每日趋势 ----
  app.get('/api/admin/usage/user/:username', authMiddleware, async (c: any) => {
    const cfg = await loadCfg(deps)
    if (!cfg) return c.json({ code: -1, message: '未配置 New API 管理员账号' })
    const username = c.req.param('username')
    try {
      const p = parsePeriod(k => c.req.query(k))
      const [currency, rows] = await Promise.all([getCurrency(cfg), na.quotaData(cfg, p.startTs, p.endTs, username)])
      const days: Record<string, { quota: number; count: number; tokens: number }> = Object.fromEntries(listDays(p).map(d => [d, { quota: 0, count: 0, tokens: 0 }]))
      const models: Record<string, { quota: number; count: number; tokens: number }> = {}
      let quota = 0, count = 0, tokens = 0
      for (const r of rows) {
        if (r.username && r.username !== username) continue
        const q = Number(r.quota || 0), n = Number(r.count || 0), t = Number(r.token_used || 0)
        quota += q; count += n; tokens += t
        const d = tsToDay(Number(r.created_at))
        if (days[d]) { days[d].quota += q; days[d].count += n; days[d].tokens += t }
        const mm = models[r.model_name || 'unknown'] || (models[r.model_name || 'unknown'] = { quota: 0, count: 0, tokens: 0 })
        mm.quota += q; mm.count += n; mm.tokens += t
      }
      const m = (q: number) => round6(toMoney(q, currency))
      return c.json({ code: 0, data: {
        username, period: p, currency: { symbol: currency.symbol, code: currency.code },
        totals: { quota, amount: m(quota), count, tokens },
        daily: Object.entries(days).map(([day, v]) => ({ day, ...v, amount: m(v.quota) })),
        models: Object.entries(models).sort((a, b) => b[1].quota - a[1].quota).map(([model, v]) => ({ model, ...v, amount: m(v.quota) })),
      } })
    } catch (e: any) { return fail(c, e) }
  })

  // ---- 单用户调用明细（服务端分页）----
  app.get('/api/admin/usage/user/:username/logs', authMiddleware, async (c: any) => {
    const cfg = await loadCfg(deps)
    if (!cfg) return c.json({ code: -1, message: '未配置 New API 管理员账号' })
    try {
      const p = parsePeriod(k => c.req.query(k))
      const page = Math.max(1, parseInt(c.req.query('page') || '1'))
      const pageSize = Math.min(100, Math.max(10, parseInt(c.req.query('pageSize') || '50')))
      const [currency, r] = await Promise.all([
        getCurrency(cfg),
        na.listLogs(cfg, { page, pageSize, startTs: p.startTs, endTs: p.endTs, username: c.req.param('username'), model: c.req.query('model') || '' }),
      ])
      const items = r.items.map(x => ({
        id: x.id, time: tsToDateTime(x.created_at), created_at: x.created_at, model: x.model_name, group: x.group,
        token_name: x.token_name, prompt_tokens: x.prompt_tokens || 0, completion_tokens: x.completion_tokens || 0,
        quota: x.quota || 0, amount: round6(toMoney(x.quota || 0, currency)), use_time: x.use_time || 0,
        is_stream: !!x.is_stream, ip: x.ip || '', channel: x.channel_name || x.channel || '',
      }))
      return c.json({ code: 0, data: { items, total: r.total, page, pageSize, totalPages: Math.max(1, Math.ceil(r.total / pageSize)), currency: { symbol: currency.symbol } } })
    } catch (e: any) { return fail(c, e) }
  })

  // ---- 导出 Excel ----
  // GET /api/admin/usage/export?start=&end=&details=0|1&maxRows=10000
  app.get('/api/admin/usage/export', authMiddleware, async (c: any) => {
    const cfg = await loadCfg(deps)
    if (!cfg) return c.json({ code: -1, message: '未配置 New API 管理员账号' })
    try {
      const p = parsePeriod(k => c.req.query(k))
      const includeDetails = c.req.query('details') === '1'
      const maxRows = Math.min(50000, Math.max(100, parseInt(c.req.query('maxRows') || '10000')))
      const includeZero = c.req.query('includeZero') !== '0'
      const s = await getSummary(cfg, p, false)
      const cur = s.currency
      const amountFmt = '#,##0.000000'

      const ExcelJS = (await import('exceljs')).default
      const wb = new ExcelJS.Workbook()
      wb.creator = '元擎智算'; wb.created = new Date()
      const styleHeader = (ws: any) => {
        const row = ws.getRow(1)
        row.font = { bold: true, color: { argb: 'FFFFFFFF' } }
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF305496' } }
        row.alignment = { horizontal: 'center', vertical: 'middle' }
        ws.views = [{ state: 'frozen', ySplit: 1 }]
      }

      // Sheet 1: 整体账单（参考脚本格式：序号/用户/用户团队/各月消费金额/合计费用）
      const ws1 = wb.addWorksheet('整体账单')
      const monthCols = s.months.map((mm: string) => ({ header: `${mm.slice(0, 4)}年${mm.slice(5)}月消费金额(${cur.symbol})`, key: 'm_' + mm, width: 20 }))
      ws1.columns = [
        { header: '序号', key: 'idx', width: 7 }, { header: '用户', key: 'username', width: 20 },
        { header: '显示名', key: 'displayName', width: 16 }, { header: '用户团队', key: 'group', width: 12 },
        ...monthCols,
        { header: `合计费用(${cur.symbol})`, key: 'amount', width: 18 }, { header: '占比', key: 'share', width: 9 },
        { header: '调用次数', key: 'count', width: 12 }, { header: 'Tokens', key: 'tokens', width: 16 },
        { header: `当前余额(${cur.symbol})`, key: 'balance', width: 16 }, { header: '最近调用', key: 'lastAt', width: 20 },
      ]
      const users = includeZero ? s.users : s.users.filter((u: any) => u.quota > 0)
      users.forEach((u: any, i: number) => {
        const row: any = { idx: i + 1, username: u.username, displayName: u.displayName, group: u.group, amount: u.amount, share: u.share, count: u.count, tokens: u.tokens, balance: u.balance, lastAt: u.lastAt ? tsToDateTime(u.lastAt) : '' }
        for (const mm of s.months) row['m_' + mm] = u.monthAmounts[mm] || 0
        ws1.addRow(row)
      })
      const totalRow: any = { username: '合计', amount: s.totals.amount, share: 1, count: s.totals.count, tokens: s.totals.tokens }
      for (const mm of s.months) totalRow['m_' + mm] = round6(s.users.reduce((t: number, u: any) => t + (u.monthAmounts[mm] || 0), 0))
      const tr = ws1.addRow(totalRow); tr.font = { bold: true }
      styleHeader(ws1)
      ws1.eachRow((row: any, n: number) => {
        if (n === 1) return
        for (const k of [...s.months.map((mm: string) => 'm_' + mm), 'amount', 'balance']) row.getCell(k).numFmt = amountFmt
        row.getCell('share').numFmt = '0.00%'
        row.getCell('count').numFmt = '#,##0'; row.getCell('tokens').numFmt = '#,##0'
      })

      // Sheet 2: 模型汇总
      const ws2 = wb.addWorksheet('模型汇总')
      ws2.columns = [
        { header: '模型', key: 'model', width: 28 }, { header: `消费金额(${cur.symbol})`, key: 'amount', width: 18 },
        { header: '调用次数', key: 'count', width: 12 }, { header: 'Tokens', key: 'tokens', width: 16 }, { header: '使用人数', key: 'users', width: 10 },
      ]
      s.models.forEach((x: any) => ws2.addRow(x))
      styleHeader(ws2)
      ws2.getColumn('amount').numFmt = amountFmt

      // Sheet 3: 每日汇总
      const ws3 = wb.addWorksheet('每日汇总')
      ws3.columns = [{ header: '日期', key: 'day', width: 14 }, { header: `消费金额(${cur.symbol})`, key: 'amount', width: 18 }, { header: 'quota', key: 'quota', width: 16 }]
      s.daily.forEach((x: any) => ws3.addRow(x))
      styleHeader(ws3)
      ws3.getColumn('amount').numFmt = amountFmt

      // Sheet 4: 调用明细（可选，最新 maxRows 行）
      let detailNote = ''
      if (includeDetails) {
        const { rows, total } = await fetchDetailRows(cfg, p, maxRows)
        detailNote = rows.length < total ? `（共 ${total} 条，仅导出最新 ${rows.length} 条）` : `（共 ${total} 条）`
        const ws4 = wb.addWorksheet('调用明细')
        ws4.columns = [
          { header: 'time', key: 'time', width: 20 }, { header: 'log_id', key: 'id', width: 10 }, { header: 'user_id', key: 'user_id', width: 9 },
          { header: 'username', key: 'username', width: 16 }, { header: 'token_name', key: 'token_name', width: 14 }, { header: 'group', key: 'group', width: 10 },
          { header: 'model', key: 'model', width: 20 }, { header: 'prompt_tokens', key: 'pt', width: 13 }, { header: 'completion_tokens', key: 'ct', width: 15 },
          { header: 'total_tokens', key: 'tt', width: 13 }, { header: 'quota', key: 'quota', width: 11 }, { header: `cost(${cur.symbol})`, key: 'cost', width: 12 },
          { header: 'channel', key: 'channel', width: 9 }, { header: 'channel_name', key: 'channel_name', width: 16 }, { header: 'request_id', key: 'request_id', width: 40 },
          { header: 'use_time', key: 'use_time', width: 9 }, { header: 'is_stream', key: 'is_stream', width: 9 }, { header: 'ip', key: 'ip', width: 16 },
        ]
        const cc = { quotaPerUnit: cur.quotaPerUnit, rate: cur.rate } as any
        for (const x of rows) {
          const pt = x.prompt_tokens || 0, ct = x.completion_tokens || 0
          ws4.addRow({
            time: tsToDateTime(x.created_at), id: x.id, user_id: x.user_id, username: x.username, token_name: x.token_name, group: x.group,
            model: x.model_name, pt, ct, tt: pt + ct, quota: x.quota || 0, cost: round6(toMoney(x.quota || 0, cc)),
            channel: x.channel, channel_name: x.channel_name, request_id: x.request_id, use_time: x.use_time, is_stream: !!x.is_stream, ip: x.ip,
          })
        }
        styleHeader(ws4)
      }

      // Sheet: 说明
      const ws0 = wb.addWorksheet('说明')
      ws0.columns = [{ header: '项目', key: 'k', width: 18 }, { header: '内容', key: 'v', width: 70 }]
      ;[
        ['统计周期', `${p.label}（北京时间，含首尾两天）`],
        ['数据来源', `${cfg.url}（New API 管理接口 /api/data + /api/log/stat 对账）`],
        ['全站合计', `${cur.symbol}${s.totals.amount}`],
        ['后台口径校验', s.totals.reconciled === null ? '未校验' : s.totals.reconciled ? `一致（/api/log/stat = ${cur.symbol}${s.totals.siteAmount}）` : `存在差异（/api/log/stat = ${cur.symbol}${s.totals.siteAmount}）`],
        ['注册用户 / 有消费用户', `${s.totals.registeredUsers} / ${s.totals.activeUsers}`],
        ['金额换算', `1 ${cur.code} = ${cur.quotaPerUnit} quota${cur.rate !== 1 ? ` × ${cur.rate}` : ''}`],
        ['调用明细', includeDetails ? `已包含${detailNote}` : '未包含（导出时勾选「包含调用明细」）'],
        ['生成时间', tsToDateTime(Math.floor(Date.now() / 1000))],
      ].forEach(([k, v]) => ws0.addRow({ k, v }))
      styleHeader(ws0)

      const buf = await wb.xlsx.writeBuffer()
      await deps.logAudit('usage_export', `导出用量账单 ${p.label}${includeDetails ? ' (含明细' + detailNote + ')' : ''}`, ipOf(c), c.get('user')?.username || 'admin')
      const fname = `用户用量账单_${p.start}_${p.end}.xlsx`
      return new Response(buf as ArrayBuffer, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="usage_${p.start}_${p.end}.xlsx"; filename*=UTF-8''${encodeURIComponent(fname)}`,
        },
      })
    } catch (e: any) { return fail(c, e, '导出失败') }
  })
}
