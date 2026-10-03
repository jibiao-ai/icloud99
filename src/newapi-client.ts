// ============================================================================
// New API 管理端客户端（适配 New API v0.13.x）
// ----------------------------------------------------------------------------
// 实测约束（api.icloud99.cn, v0.13.2）：
//   1. /api/user/login 返回 body 不含 access_token，鉴权靠 Set-Cookie: session=...
//   2. 所有管理接口必须带 `New-Api-User: <uid>` 头，否则 401
//   3. 分页从 p=1 开始（p=0 等价于 p=1），page_size 硬上限 100
//   4. /api/log/search 已废弃；明细用 /api/log/，汇总用 /api/log/stat
//   5. /api/data/ 返回按「小时 × 用户 × 模型」预聚合的数据（quota/count/token_used），
//      金额与 /api/log/stat 完全一致，是做区间统计最高效的数据源
// ============================================================================

export type NewApiCfg = { url: string; username: string; password: string }

type Session = { url: string; cookie: string; uid: number; expiresAt: number; cfgKey: string }

export class NewApiError extends Error {
  constructor(msg: string, public kind: 'auth' | 'rate' | 'server' | 'api' | 'net' = 'api') { super(msg) }
}

const SESSION_TTL_MS = 20 * 60 * 1000
const PAGE_SIZE = 100
const FIRST_PAGE = 1

let session: Session | null = null
let loginPromise: Promise<Session> | null = null

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const cfgKeyOf = (c: NewApiCfg) => `${c.url}|${c.username}|${c.password}`

export function clearSession() { session = null }

async function login(cfg: NewApiCfg): Promise<Session> {
  const url = cfg.url.replace(/\/+$/, '')
  let resp: Response
  try {
    resp = await fetch(url + '/api/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ username: cfg.username, password: cfg.password }),
      signal: AbortSignal.timeout(15000),
    })
  } catch (e: any) {
    throw new NewApiError(`无法连接 New API (${url}): ${e.message}`, 'net')
  }
  if (resp.status === 429) throw new NewApiError('登录被限流 (429)，请 1~2 分钟后再试', 'rate')
  let body: any = {}
  try { body = await resp.json() } catch { /* ignore */ }
  if (!resp.ok || body.success === false) {
    throw new NewApiError(`登录失败: ${body.message || 'HTTP ' + resp.status}`, 'auth')
  }
  const data = body.data || {}
  const uid = Number(data.id || data.user?.id || 0)
  if (data.role !== undefined && Number(data.role) < 10) {
    throw new NewApiError('该账号不是 New API 管理员（role < 10），无法查询全站用量', 'auth')
  }

  // Cookie 模式（v0.13+ 默认）
  const setCookies: string[] = (resp.headers as any).getSetCookie?.() || []
  const raw = setCookies.length ? setCookies : [resp.headers.get('set-cookie') || '']
  let cookie = ''
  for (const sc of raw) { const m = sc.match(/session=([^;]+)/); if (m) { cookie = `session=${m[1]}`; break } }

  // 部分版本在 body 里返回 access_token
  const token = data.access_token || data.token
  if (!cookie && token) cookie = `Bearer ${token}`
  if (!cookie) throw new NewApiError('登录成功但未拿到 session cookie / access_token', 'auth')
  if (!uid) throw new NewApiError('登录成功但未拿到用户 id（New-Api-User 头必需）', 'auth')

  return { url, cookie, uid, expiresAt: Date.now() + SESSION_TTL_MS, cfgKey: cfgKeyOf(cfg) }
}

async function getSession(cfg: NewApiCfg, force = false): Promise<Session> {
  if (!force && session && session.expiresAt > Date.now() && session.cfgKey === cfgKeyOf(cfg)) return session
  if (!loginPromise) {
    loginPromise = login(cfg).then(s => { session = s; return s }).finally(() => { loginPromise = null })
  }
  return loginPromise
}

function isAuthFailure(status: number, body: any): boolean {
  if (status === 401 || status === 403) return true
  const msg = String(body?.message || '')
  return body?.success === false && /未登录|access token|Unauthorized|无权/i.test(msg)
}

/** 带鉴权、限流重试、会话过期自动重登的 GET */
export async function apiGet(cfg: NewApiCfg, path: string, params: Record<string, any> = {}, maxRetry = 4): Promise<any> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  let relogged = false
  let lastErr: any = null
  for (let attempt = 0; attempt < maxRetry; attempt++) {
    const s = await getSession(cfg)
    const headers: Record<string, string> = { 'Accept': 'application/json', 'New-Api-User': String(s.uid) }
    if (s.cookie.startsWith('Bearer ')) headers['Authorization'] = s.cookie
    else headers['Cookie'] = s.cookie
    try {
      const resp = await fetch(`${s.url}${path}${qs.toString() ? '?' + qs : ''}`, { headers, signal: AbortSignal.timeout(60000) })
      let body: any = null
      try { body = await resp.json() } catch { body = null }
      if (isAuthFailure(resp.status, body)) {
        if (relogged) throw new NewApiError(`鉴权失败: ${body?.message || resp.status}`, 'auth')
        relogged = true; clearSession(); await getSession(cfg, true); attempt--; continue
      }
      if (resp.status === 429 || /rate|限流|频繁/i.test(String(body?.message || ''))) {
        throw new NewApiError('请求被限流 (429)', 'rate')
      }
      if (resp.status >= 500) throw new NewApiError(`服务器错误 HTTP ${resp.status}`, 'server')
      if (!resp.ok) throw new NewApiError(`HTTP ${resp.status}: ${body?.message || ''}`, 'api')
      if (body?.success === false) throw new NewApiError(body.message || '接口返回失败', 'api')
      return body?.data
    } catch (e: any) {
      lastErr = e
      const retriable = !(e instanceof NewApiError) || e.kind === 'rate' || e.kind === 'server' || e.kind === 'net'
      if (!retriable) throw e
      await sleep(Math.min(15000, 1000 * 2 ** attempt) + Math.random() * 500)
    }
  }
  throw lastErr instanceof NewApiError ? lastErr : new NewApiError(`请求失败: ${lastErr?.message || lastErr}`, 'net')
}

/** 简易并发池 */
export async function mapPool<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let idx = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const i = idx++
      if (i >= items.length) return
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

// ---------------------------------------------------------------------------
// 业务接口
// ---------------------------------------------------------------------------
export async function testConnection(cfg: NewApiCfg) {
  clearSession()
  const s = await getSession(cfg, true)
  const d = await apiGet(cfg, '/api/user/', { p: FIRST_PAGE, page_size: 1 })
  return { uid: s.uid, totalUsers: Number(d?.total || 0) }
}

export async function getStatus(cfg: NewApiCfg): Promise<any> {
  try {
    const r = await fetch(cfg.url.replace(/\/+$/, '') + '/api/status', { signal: AbortSignal.timeout(10000) })
    const b: any = await r.json()
    return b?.data || {}
  } catch { return {} }
}

/** 拉取全部用户（修复：p 从 1 开始、page_size=100、按 id 去重） */
export async function listAllUsers(cfg: NewApiCfg): Promise<any[]> {
  const seen = new Set<number>()
  const out: any[] = []
  for (let p = FIRST_PAGE; p < FIRST_PAGE + 1000; p++) {
    const d = await apiGet(cfg, '/api/user/', { p, page_size: PAGE_SIZE })
    const items: any[] = d?.items || (Array.isArray(d) ? d : [])
    if (!items.length) break
    let added = 0
    for (const u of items) { if (!seen.has(u.id)) { seen.add(u.id); out.push(u); added++ } }
    if (!added) break
    const total = Number(d?.total || 0)
    if (total && out.length >= total) break
    if (items.length < Number(d?.page_size || PAGE_SIZE)) break
  }
  return out
}

/** /api/log/stat：区间消费 quota（type=2 消费） */
export async function logStat(cfg: NewApiCfg, startTs: number, endTs: number, username = ''): Promise<number> {
  const d = await apiGet(cfg, '/api/log/stat', { type: 2, start_timestamp: startTs, end_timestamp: endTs, username })
  return Number(d?.quota || 0)
}

/** /api/data/：小时级 × 模型 预聚合数据 */
export async function quotaData(cfg: NewApiCfg, startTs: number, endTs: number, username = ''): Promise<any[]> {
  const d = await apiGet(cfg, '/api/data/', { start_timestamp: startTs, end_timestamp: endTs, username })
  return Array.isArray(d) ? d : []
}

/** /api/log/：消费明细分页 */
export async function listLogs(cfg: NewApiCfg, opt: { page: number; pageSize?: number; startTs: number; endTs: number; username?: string; model?: string }) {
  const d = await apiGet(cfg, '/api/log/', {
    p: Math.max(FIRST_PAGE, opt.page), page_size: Math.min(PAGE_SIZE, opt.pageSize || PAGE_SIZE), type: 2,
    start_timestamp: opt.startTs, end_timestamp: opt.endTs, username: opt.username || '', model_name: opt.model || '',
  })
  return { items: (d?.items || []) as any[], total: Number(d?.total || 0) }
}

export const NEWAPI_PAGE_SIZE = PAGE_SIZE
