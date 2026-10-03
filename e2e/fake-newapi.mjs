// 假 New API + 假上游模型服务，仅用于本地 e2e（不进生产）。端口 4010。
import http from 'node:http';

const NOW = Math.floor(Date.now() / 1000);
const users = [
  { id: 1, username: 'root', display_name: '管理员', group: 'default', role: 100, status: 1, quota: 5000000, used_quota: 0, request_count: 0 },
  { id: 2, username: 'alice', display_name: 'Alice', group: 'vip', role: 1, status: 1, quota: 8000000, used_quota: 3000000, request_count: 120 },
  { id: 3, username: 'bob', display_name: '', group: 'default', role: 1, status: 1, quota: 100000, used_quota: 900000, request_count: 40 },
  { id: 4, username: 'carol', display_name: 'Carol', group: 'vip', role: 1, status: 1, quota: 0, used_quota: 0, request_count: 0 },
];
const MODELS = ['gpt-5.6-sol', 'claude-opus-4-7', 'gpt-6-astra'];
// 为 alice/bob 生成近 40 天的小时级数据
const rows = [];
for (const [u, base] of [['alice', 400000], ['bob', 90000]]) {
  for (let d = 0; d < 40; d++) {
    for (const m of MODELS.slice(0, u === 'alice' ? 3 : 2)) {
      const ts = NOW - d * 86400 - (d % 5) * 3600;
      rows.push({ username: u, model_name: m, quota: Math.round(base * (1 + (d % 4) * 0.3) / (MODELS.indexOf(m) + 1)), count: 3 + (d % 7), token_used: 1200 + d * 10, created_at: ts - (ts % 3600) });
    }
  }
}
const inRange = (r, s, e) => r.created_at >= s && r.created_at <= e;
const logsFor = (name, s, e, model) => {
  const out = [];
  let id = 1000;
  for (const r of rows.filter((x) => (!name || x.username === name) && inRange(x, s, e) && (!model || x.model_name === model))) {
    out.push({ id: id++, user_id: r.username === 'alice' ? 2 : 3, username: r.username, created_at: r.created_at, model_name: r.model_name, token_name: 'k1', group: 'vip',
      prompt_tokens: 500, completion_tokens: 300, quota: Math.round(r.quota / r.count), use_time: 4, is_stream: true, ip: '10.0.0.1', channel: 1, channel_name: 'ch-a', request_id: `req-${id}` });
  }
  return out.sort((a, b) => b.created_at - a.created_at);
};

const send = (res, body, status = 200, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
let rateLimitNext = false;

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname, q = u.searchParams;
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    // ---- 令牌用量查询（访客 Key）----
    if (p === '/api/usage/token/') {
      if (req.headers.authorization !== 'Bearer sk-demo-token') return send(res, { code: false, message: '令牌无效' });
      return send(res, { code: true, data: { name: 'demo-token', total_granted: 10000000, total_used: 2500000, total_available: 7500000, unlimited_quota: false, model_limits_enabled: true, model_limits: { 'gpt-5.6-sol': true }, expires_at: 0 } });
    }
    if (p === '/api/log/token/') {
      if (req.headers.authorization !== 'Bearer sk-demo-token') return send(res, { success: false });
      const data = logsFor('alice', NOW - 86400 * 30, NOW).slice(0, 80).map((l) => ({ ...l, other: JSON.stringify({ model_ratio: 2.5, group_ratio: 1, billing_source: 'wallet', request_path: '/v1/chat/completions' }) }));
      return send(res, { success: true, data });
    }
    // ---- 公开状态 ----
    if (p === '/api/status') return send(res, { data: { quota_per_unit: 500000, quota_display_type: 'USD' } });
    // ---- 管理端 ----
    if (p === '/api/user/login') {
      const b = JSON.parse(body || '{}');
      if (b.username !== 'root' || b.password !== 'rootpw') return send(res, { success: false, message: '用户名或密码错误' });
      return send(res, { success: true, data: { id: 1, role: 100 } }, 200, { 'Set-Cookie': 'session=fake-session; Path=/; HttpOnly' });
    }
    if (p.startsWith('/api/') && !p.startsWith('/v1/')) {
      if (req.headers.cookie !== 'session=fake-session' || req.headers['new-api-user'] !== '1') return send(res, { success: false, message: '未登录' }, 401);
      if (p === '/api/user/') {
        const ps = Math.min(100, Number(q.get('page_size')) || 10), pg = Math.max(1, Number(q.get('p')) || 1);
        return send(res, { success: true, data: { items: users.slice((pg - 1) * ps, pg * ps), total: users.length, page_size: ps } });
      }
      const s = Number(q.get('start_timestamp')), e = Number(q.get('end_timestamp'));
      if (p === '/api/data/') return send(res, { success: true, data: rows.filter((r) => (!q.get('username') || r.username === q.get('username')) && inRange(r, s, e)) });
      if (p === '/api/log/stat') {
        const name = q.get('username');
        const quota = rows.filter((r) => (!name || r.username === name) && inRange(r, s, e)).reduce((t, r) => t + r.quota, 0);
        return send(res, { success: true, data: { quota } });
      }
      if (p === '/api/log/') {
        const all = logsFor(q.get('username'), s, e, q.get('model_name'));
        const ps = Math.min(100, Number(q.get('page_size')) || 10), pg = Math.max(1, Number(q.get('p')) || 1);
        return send(res, { success: true, data: { items: all.slice((pg - 1) * ps, pg * ps), total: all.length } });
      }
    }
    // ---- 假上游模型（OpenAI 兼容）----
    if (p === '/v1/models') return send(res, { data: [] });
    if (p === '/v1/chat/completions') {
      const b = JSON.parse(body || '{}');
      const prompt = b.messages?.[0]?.content || '';
      if (req.headers.authorization !== 'Bearer sk-upstream-ok') return send(res, { error: 'bad key' }, 401);
      if (prompt.includes('pelican')) {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 250"><style>@keyframes spin{to{transform:rotate(360deg)}}.w{transform-origin:center;transform-box:fill-box;animation:spin 1s linear infinite}</style><rect width="400" height="250" fill="#dfeafc"/><g class="w"><circle cx="110" cy="170" r="38" fill="none" stroke="#333" stroke-width="5"/></g><g class="w"><circle cx="290" cy="170" r="38" fill="none" stroke="#333" stroke-width="5"/></g><path d="M110 170 L200 110 L290 170" stroke="#c0392b" stroke-width="6" fill="none"/><ellipse cx="200" cy="90" rx="34" ry="24" fill="#fff" stroke="#333" stroke-width="3"/><path d="M225 88 L300 96 L228 106Z" fill="#f5a623"/></svg>';
        return send(res, { choices: [{ message: { content: '```svg\n' + svg + '\n```' } }], usage: { prompt_tokens: 40, completion_tokens: 600, completion_tokens_details: { reasoning_tokens: 100 } } });
      }
      return send(res, { choices: [{ message: { content: 'Hello' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    }
    send(res, { success: false, message: 'not found' }, 404);
  });
}).listen(4010, '127.0.0.1', () => console.log('fake newapi on 4010'));
