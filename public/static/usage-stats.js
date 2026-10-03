// ============================================================================
// 用量统计（管理员）— 指定周期内全站所有用户的账单统计
// 依赖 app.js 中的: store, api, cls, isDark, isLoggedIn, toast, showModal, closeModal, timeAgo
// ============================================================================
(function () {
  const PAGE_SIZE = 20;

  // ---------- 日期工具（北京时间）----------
  const cstNow = () => new Date(Date.now() + 8 * 3600000);
  const ymd = (d) => d.toISOString().slice(0, 10);
  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
  const today = () => ymd(cstNow());
  function presetRange(key) {
    const t = today(); const [y, m] = t.split('-').map(Number);
    switch (key) {
      case 'today': return [t, t];
      case 'yesterday': { const y1 = addDays(t, -1); return [y1, y1]; }
      case '7d': return [addDays(t, -6), t];
      case '30d': return [addDays(t, -29), t];
      case 'month': return [t.slice(0, 8) + '01', t];
      case 'lastMonth': {
        const first = new Date(Date.UTC(y, m - 2, 1)); const last = new Date(Date.UTC(y, m - 1, 0));
        return [ymd(first), ymd(last)];
      }
      case 'quarter': { const qm = Math.floor((m - 1) / 3) * 3; return [ymd(new Date(Date.UTC(y, qm, 1))), t]; }
      case 'year': return [`${y}-01-01`, t];
    }
    return [t.slice(0, 8) + '01', t];
  }
  const PRESETS = [
    ['today', '今日'], ['yesterday', '昨日'], ['7d', '近7天'], ['30d', '近30天'],
    ['month', '本月'], ['lastMonth', '上月'], ['quarter', '本季度'], ['year', '今年'],
  ];

  // ---------- 状态 ----------
  const [s0, e0] = presetRange('month');
  const us = window.ucStore = {
    start: s0, end: e0, preset: 'month',
    data: null, loading: false, error: '',
    search: '', group: '', hideZero: true, sortKey: 'amount', sortDir: 'desc', page: 1,
    detailUser: null, detail: null, detailLogs: null, logPage: 1, logModel: '',
  };

  // ---------- 格式化 ----------
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const jsArg = (v) => esc(JSON.stringify(String(v)));
  const sym = () => us.data?.currency?.symbol || '$';
  const money = (n, digits = 2) => sym() + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const num = (n) => Number(n || 0).toLocaleString('en-US');
  function compact(n) {
    n = Number(n || 0);
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
  }
  const tsStr = (ts) => ts ? new Date((ts + 8 * 3600) * 1000).toISOString().replace('T', ' ').slice(0, 16) : '-';
  const qs = () => `start=${us.start}&end=${us.end}`;

  // ---------- 数据加载 ----------
  async function loadSummary(refresh = false) {
    us.loading = true; us.error = '';
    renderUserConsumption();
    try {
      const resp = await api.get(`/admin/usage/summary?${qs()}${refresh ? '&refresh=1' : ''}`);
      if (resp.code === 0) { us.data = resp.data; us.page = 1; if (refresh) toast('数据已刷新', 'success'); }
      else { us.error = resp.message || '查询失败'; us.data = null; }
    } catch (e) { us.error = '查询失败: ' + e.message; us.data = null; }
    us.loading = false;
    if (store.currentPage === 'user-consumption') renderUserConsumption();
  }

  // ---------- 主页面 ----------
  window.renderUserConsumption = function () {
    const ct = document.getElementById('page-content');
    if (!ct) return;
    if (!isLoggedIn()) {
      ct.innerHTML = `<div class="text-center py-20 fade-in"><i class="fas fa-lock text-4xl ${cls.textMuted()} mb-3"></i><p class="${cls.text()} font-semibold">请先登录管理员账号</p><button onclick="store.setPage('admin-settings')" class="${cls.btn()} mt-4">前往登录</button></div>`;
      return;
    }
    if (us.detailUser) { renderDetail(); return; }
    if (!us.data && !us.loading && !us.error) { loadSummary(); return; }

    let html = renderToolbar();
    if (us.loading) {
      html += `<div class="flex flex-col items-center justify-center h-64 fade-in"><div class="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mb-4"></div><p class="${cls.text()} text-sm">正在从 New API 统计 ${esc(us.start)} ~ ${esc(us.end)} 的全站用户账单...</p><p class="${cls.textMuted()} text-xs mt-1">首次统计约需 5~15 秒，结果会缓存 5 分钟</p></div>`;
    } else if (us.error) {
      const needCfg = /未配置/.test(us.error);
      html += `<div class="${cls.card()} p-10 text-center fade-in"><i class="fas fa-triangle-exclamation text-3xl text-amber-500 mb-3"></i><p class="${cls.text()} text-sm font-medium mb-1">${esc(us.error)}</p>
        <div class="flex justify-center gap-2 mt-4">${needCfg ? `<button onclick="store.setPage('admin-settings');setTimeout(()=>window.switchSettingsTab&&switchSettingsTab('newapi'),50)" class="${cls.btn()} text-xs"><i class="fas fa-cog mr-1"></i>去配置 New API</button>` : ''}
        <button onclick="ucStore.error='';ucReload(true)" class="${cls.btnSec()} text-xs"><i class="fas fa-sync-alt mr-1"></i>重试</button></div></div>`;
    } else if (us.data) {
      html += renderCards() + renderCharts() + renderUserTable();
    }
    ct.innerHTML = html;
    if (us.data && !us.loading) requestAnimationFrame(drawDailyChart);
  };

  function renderToolbar() {
    const d = isDark();
    const btn = (k, label) => `<button onclick="ucPreset('${k}')" class="px-2.5 py-1.5 rounded-md text-xs whitespace-nowrap transition-all ${us.preset === k ? 'bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-sm' : (d ? 'text-slate-300 hover:bg-slate-700' : 'text-gray-600 hover:bg-gray-100')}">${label}</button>`;
    const meta = us.data?.meta;
    return `<div class="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4 fade-in">
      <div><h2 class="text-base sm:text-lg font-semibold ${cls.text()}"><i class="fas fa-file-invoice-dollar mr-2 text-primary-500"></i>用户用量统计</h2>
        <p class="${cls.textSub()} text-xs mt-1">统计指定周期内全站所有用户的消费账单（北京时间，数据来自 New API 管理接口）${meta ? ` · ${meta.cached ? '缓存' : '实时'} · ${(meta.elapsedMs / 1000).toFixed(1)}s` : ''}</p></div>
      <div class="flex items-center gap-2 flex-wrap">
        <button onclick="ucExportDialog()" ${us.data ? '' : 'disabled'} class="${us.data ? cls.btn() : cls.btnDisabled()} text-xs !py-2"><i class="fas fa-file-excel mr-1"></i>导出账单</button>
        <button onclick="ucReload(true)" class="${cls.btnSec()} text-xs !py-2"><i class="fas fa-sync-alt mr-1 ${us.loading ? 'animate-spin' : ''}"></i>刷新</button>
      </div></div>
    <div class="${cls.card()} p-3 mb-4 fade-in flex flex-col xl:flex-row xl:items-center gap-3">
      <div class="flex items-center gap-1 overflow-x-auto scrollbar-thin pb-1 xl:pb-0">${PRESETS.map(([k, l]) => btn(k, l)).join('')}</div>
      <div class="flex items-center gap-2 xl:ml-auto flex-wrap">
        <span class="${cls.textMuted()} text-xs"><i class="far fa-calendar mr-1"></i>自定义</span>
        <input id="uc-start" type="date" value="${us.start}" max="${today()}" class="${cls.input()} !py-1.5 text-xs">
        <span class="${cls.textMuted()} text-xs">至</span>
        <input id="uc-end" type="date" value="${us.end}" max="${today()}" class="${cls.input()} !py-1.5 text-xs">
        <button onclick="ucApplyRange()" class="${cls.btn()} text-xs !py-1.5"><i class="fas fa-search mr-1"></i>统计</button>
      </div></div>`;
  }

  function card(label, value, sub, icon, color) {
    return `<div class="${cls.card()} overflow-hidden"><div class="h-0.5 bg-gradient-to-r ${color[0]}"></div><div class="p-4">
      <div class="flex items-center justify-between mb-2"><span class="${cls.textMuted()} text-xs">${label}</span><div class="w-8 h-8 rounded-lg ${color[1]} flex items-center justify-center"><i class="${icon} text-sm"></i></div></div>
      <div class="text-lg sm:text-xl font-bold ${cls.text()} font-mono truncate" title="${esc(value)}">${value}</div>
      <div class="${cls.textMuted()} text-[11px] mt-0.5 truncate">${sub}</div></div></div>`;
  }

  function renderCards() {
    const t = us.data.totals, p = us.data.period;
    const rec = t.reconciled === null ? '<span class="text-gray-400">未校验</span>'
      : t.reconciled ? `<span class="text-emerald-500"><i class="fas fa-check-circle mr-0.5"></i>与后台一致</span>`
      : `<span class="text-amber-500" title="后台 /api/log/stat = ${money(t.siteAmount, 4)}"><i class="fas fa-exclamation-circle mr-0.5"></i>与后台有差异</span>`;
    return `<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4 fade-in">
      ${card('周期总消费', money(t.amount), `${esc(p.label)} · ${p.days}天 · ${rec}`, 'fas fa-coins text-cyan-500', ['from-cyan-400 to-cyan-600', 'bg-cyan-500/10'])}
      ${card('调用次数', num(t.count), `日均 ${num(Math.round(t.count / Math.max(1, p.days)))} 次`, 'fas fa-bolt text-purple-500', ['from-purple-400 to-purple-600', 'bg-purple-500/10'])}
      ${card('Token 用量', compact(t.tokens), `${num(t.tokens)} tokens`, 'fas fa-layer-group text-emerald-500', ['from-emerald-400 to-emerald-600', 'bg-emerald-500/10'])}
      ${card('有消费用户', `${t.activeUsers} <span class="text-xs font-normal ${cls.textMuted()}">/ ${t.registeredUsers}</span>`, `人均消费 ${money(t.avgPerActiveUser)}`, 'fas fa-users text-amber-500', ['from-amber-400 to-orange-500', 'bg-amber-500/10'])}
    </div>`;
  }

  function renderCharts() {
    const d = isDark();
    const models = us.data.models.slice(0, 8);
    const maxQ = Math.max(1, ...models.map(m => m.quota));
    const total = Math.max(1, us.data.totals.quota);
    const palette = ['#6C5CE7', '#00B894', '#0984E3', '#FDCB6E', '#E17055', '#E84393', '#00CEC9', '#A29BFE'];
    const modelBars = models.length ? models.map((m, i) => `<div class="mb-2.5">
        <div class="flex items-center justify-between text-xs mb-1"><span class="font-mono ${cls.text()} truncate mr-2" title="${esc(m.model)}">${esc(m.model)}</span><span class="font-mono ${cls.textSub()} whitespace-nowrap">${money(m.amount)} <span class="${cls.textMuted()}">· ${(m.quota / total * 100).toFixed(1)}%</span></span></div>
        <div class="h-2 rounded-full ${d ? 'bg-slate-700' : 'bg-gray-100'} overflow-hidden"><div class="h-full rounded-full" style="width:${(m.quota / maxQ * 100).toFixed(1)}%;background:${palette[i % palette.length]}"></div></div>
      </div>`).join('') : `<p class="${cls.textMuted()} text-xs text-center py-10">暂无数据</p>`;
    return `<div class="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4 fade-in">
      <div class="${cls.card()} p-4 lg:col-span-2"><div class="flex items-center gap-2 mb-3"><i class="fas fa-chart-column text-primary-500 text-sm"></i><h3 class="text-sm font-semibold ${cls.text()}">每日消费趋势</h3><span id="uc-chart-tip" class="${cls.textMuted()} text-xs ml-auto font-mono"></span></div>
        <div class="relative" style="height:220px"><canvas id="uc-daily-chart" class="w-full h-full"></canvas></div></div>
      <div class="${cls.card()} p-4"><div class="flex items-center gap-2 mb-3"><i class="fas fa-cubes text-primary-500 text-sm"></i><h3 class="text-sm font-semibold ${cls.text()}">模型消费 Top 8</h3><span class="${cls.textMuted()} text-xs ml-auto">共 ${us.data.models.length} 个</span></div>${modelBars}</div>
    </div>`;
  }

  function drawBars(canvasId, tipId, points) {
    const cv = document.getElementById(canvasId);
    if (!cv) return;
    const d = isDark();
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr);
    const padL = 56, padB = 22, padT = 8, padR = 6;
    const cw = W - padL - padR, ch = H - padT - padB;
    const maxV = Math.max(1e-9, ...points.map(p => p.amount));
    g.font = '10px ui-monospace,monospace'; g.fillStyle = d ? '#64748b' : '#9ca3af'; g.strokeStyle = d ? '#334155' : '#f1f5f9';
    for (let i = 0; i <= 4; i++) {
      const y = padT + ch - ch * i / 4;
      g.beginPath(); g.moveTo(padL, y); g.lineTo(W - padR, y); g.stroke();
      g.textAlign = 'right'; g.fillText(sym() + compact(Math.round(maxV * i / 4)), padL - 6, y + 3);
    }
    const n = points.length, slot = cw / Math.max(1, n), bw = Math.max(1, Math.min(28, slot * 0.7));
    const grad = g.createLinearGradient(0, padT, 0, padT + ch); grad.addColorStop(0, '#8d7eff'); grad.addColorStop(1, '#6C5CE7');
    const step = Math.ceil(n / Math.max(1, Math.floor(cw / 60)));
    points.forEach((p, i) => {
      const x = padL + slot * i + (slot - bw) / 2, h = ch * p.amount / maxV;
      g.fillStyle = grad; g.fillRect(x, padT + ch - h, bw, h);
      if (i % step === 0) { g.fillStyle = d ? '#64748b' : '#9ca3af'; g.textAlign = 'center'; g.fillText(p.day.slice(5), x + bw / 2, H - 6); }
    });
    cv.onmousemove = (ev) => {
      const r = cv.getBoundingClientRect(); const i = Math.floor((ev.clientX - r.left - padL) / slot);
      const tip = document.getElementById(tipId);
      if (tip) tip.textContent = points[i] ? `${points[i].day}  ${money(points[i].amount)}${points[i].count !== undefined ? '  ' + num(points[i].count) + '次' : ''}` : '';
    };
  }
  function drawDailyChart() { if (us.data) drawBars('uc-daily-chart', 'uc-chart-tip', us.data.daily); }
  window.addEventListener('resize', () => {
    if (store.currentPage !== 'user-consumption') return;
    if (us.detailUser && us.detail) drawBars('uc-user-chart', 'uc-user-tip', us.detail.daily); else drawDailyChart();
  });

  function filteredUsers() {
    const q = us.search.trim().toLowerCase();
    let list = us.data.users.filter(u =>
      (!us.hideZero || u.quota > 0 || u.count > 0) &&
      (!us.group || u.group === us.group) &&
      (!q || u.username.toLowerCase().includes(q) || (u.displayName || '').toLowerCase().includes(q) || String(u.id) === q));
    const k = us.sortKey, dir = us.sortDir === 'asc' ? 1 : -1;
    list = list.slice().sort((a, b) => {
      const va = k.startsWith('m_') ? a.monthAmounts[k.slice(2)] : a[k];
      const vb = k.startsWith('m_') ? b.monthAmounts[k.slice(2)] : b[k];
      if (typeof va === 'string') return dir * va.localeCompare(vb);
      return dir * ((va || 0) - (vb || 0));
    });
    return list;
  }

  function renderUserTable() {
    const d = isDark();
    const months = us.data.months;
    const multiMonth = months.length > 1 && months.length <= 12;
    const list = filteredUsers();
    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    us.page = Math.min(us.page, totalPages);
    const rows = list.slice((us.page - 1) * PAGE_SIZE, us.page * PAGE_SIZE);
    const groups = [...new Set(us.data.users.map(u => u.group).filter(Boolean))].sort();
    const listQuota = list.reduce((s, u) => s + u.quota, 0);

    const th = (key, label, align = 'left') => {
      const active = us.sortKey === key;
      return `<th onclick="ucSort('${key}')" class="px-3 py-3 text-xs font-semibold ${cls.textSub()} cursor-pointer select-none whitespace-nowrap text-${align} hover:text-primary-500">${label}<i class="fas fa-sort${active ? (us.sortDir === 'asc' ? '-up' : '-down') : ''} ml-1 text-[10px] ${active ? 'text-primary-500' : 'opacity-40'}"></i></th>`;
    };

    let html = `<div class="${cls.card()} overflow-hidden fade-in">
      <div class="px-4 py-3 border-b ${d ? 'border-slate-700' : 'border-gray-100'} flex flex-col md:flex-row md:items-center gap-2">
        <div class="flex items-center gap-2"><i class="fas fa-ranking-star text-primary-500 text-sm"></i><h3 class="text-sm font-semibold ${cls.text()}">用户账单</h3>
          <span class="${cls.textMuted()} text-xs">${list.length} 位用户 · 小计 ${money(listQuota / us.data.currency.quotaPerUnit * us.data.currency.rate)}</span></div>
        <div class="flex items-center gap-2 md:ml-auto flex-wrap">
          <div class="relative"><i class="fas fa-search absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] ${cls.textMuted()}"></i>
            <input id="uc-search" value="${esc(us.search)}" oninput="ucSearch(this.value)" placeholder="搜索用户名 / ID" class="${cls.input()} !py-1.5 pl-7 text-xs w-40"></div>
          <select onchange="ucGroup(this.value)" class="${cls.input()} !py-1.5 text-xs"><option value="">全部分组</option>${groups.map(g => `<option ${g === us.group ? 'selected' : ''} value="${esc(g)}">${esc(g)}</option>`).join('')}</select>
          <label class="flex items-center gap-1.5 text-xs ${cls.textSub()} cursor-pointer"><input type="checkbox" ${us.hideZero ? 'checked' : ''} onchange="ucHideZero(this.checked)" class="accent-primary-500">隐藏零消费</label>
        </div></div>
      <div class="overflow-x-auto scrollbar-thin"><table class="w-full text-sm">
        <thead><tr class="${d ? 'bg-slate-700/50' : 'bg-gray-50'}">
          <th class="px-3 py-3 text-xs font-semibold ${cls.textSub()} text-left">#</th>
          ${th('username', '用户')}${th('group', '分组')}
          ${multiMonth ? months.map(m => th('m_' + m, `${Number(m.slice(5))}月`, 'right')).join('') : ''}
          ${th('amount', '周期消费', 'right')}${th('count', '调用次数', 'right')}${th('tokens', 'Tokens', 'right')}
          <th class="px-3 py-3 text-xs font-semibold ${cls.textSub()} text-left whitespace-nowrap">主要模型</th>
          ${th('balance', '当前余额', 'right')}${th('lastAt', '最近调用')}
          <th class="px-3 py-3 text-xs font-semibold ${cls.textSub()}"></th>
        </tr></thead><tbody>`;

    if (!rows.length) {
      html += `<tr><td colspan="${10 + (multiMonth ? months.length : 0)}" class="px-4 py-12 text-center ${cls.textMuted()}"><i class="fas fa-inbox text-2xl mb-2 block"></i>该周期内没有符合条件的用户</td></tr>`;
    }
    rows.forEach((u, i) => {
      const idx = (us.page - 1) * PAGE_SIZE + i + 1;
      const top = u.topModels[0];
      const medal = idx <= 3 && us.sortKey === 'amount' && us.sortDir === 'desc' && !us.search ? ['🥇', '🥈', '🥉'][idx - 1] : idx;
      html += `<tr class="border-t ${d ? 'border-slate-700/60 hover:bg-slate-700/30' : 'border-gray-100 hover:bg-primary-50/40'} transition-colors cursor-pointer" onclick="ucShowUser(${jsArg(u.username)})">
        <td class="px-3 py-2.5 text-xs font-mono ${cls.textMuted()}">${medal}</td>
        <td class="px-3 py-2.5"><div class="font-medium ${cls.text()} whitespace-nowrap">${esc(u.username)}${u.status !== 1 ? ' <span class="text-[10px] px-1 rounded bg-red-500/10 text-red-500">已禁用</span>' : ''}</div><div class="${cls.textMuted()} text-[10px]">ID ${u.id}${u.displayName && u.displayName !== u.username ? ' · ' + esc(u.displayName) : ''}</div></td>
        <td class="px-3 py-2.5"><span class="px-2 py-0.5 rounded text-[11px] ${d ? 'bg-primary-500/15 text-primary-400' : 'bg-primary-50 text-primary-600'}">${esc(u.group || '-')}</span></td>
        ${multiMonth ? months.map(m => `<td class="px-3 py-2.5 text-right font-mono text-xs ${u.monthAmounts[m] ? cls.text() : cls.textMuted()}">${u.monthAmounts[m] ? money(u.monthAmounts[m]) : '-'}</td>`).join('') : ''}
        <td class="px-3 py-2.5 text-right whitespace-nowrap"><div class="font-mono font-bold ${u.amount >= 100 ? 'text-amber-500' : cls.text()}">${money(u.amount)}</div>
          <div class="h-1 mt-1 rounded-full ${d ? 'bg-slate-700' : 'bg-gray-100'} overflow-hidden"><div class="h-full bg-primary-500" style="width:${(u.share * 100).toFixed(1)}%"></div></div>
          <div class="${cls.textMuted()} text-[10px]">${(u.share * 100).toFixed(2)}%</div></td>
        <td class="px-3 py-2.5 text-right font-mono text-xs ${cls.text()}">${num(u.count)}</td>
        <td class="px-3 py-2.5 text-right font-mono text-xs ${cls.text()}" title="${num(u.tokens)}">${compact(u.tokens)}</td>
        <td class="px-3 py-2.5"><span class="font-mono text-[11px] ${cls.textSub()} whitespace-nowrap">${top ? esc(top.model) : '-'}</span></td>
        <td class="px-3 py-2.5 text-right font-mono text-xs ${cls.textSub()}">${money(u.balance)}</td>
        <td class="px-3 py-2.5 text-xs ${cls.textSub()} whitespace-nowrap" title="${tsStr(u.lastAt)}">${u.lastAt ? timeAgo(new Date(u.lastAt * 1000).toISOString()) : '-'}</td>
        <td class="px-3 py-2.5 text-right"><i class="fas fa-chevron-right text-xs ${cls.textMuted()}"></i></td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
    if (totalPages > 1) html += `<div class="px-4 py-3 border-t ${d ? 'border-slate-700' : 'border-gray-100'}">${renderGenericPagination(us.page, totalPages, list.length, 'ucGoPage', 'uc-page-jump', 'ucJumpPage', d)}</div>`;
    html += `</div>`;
    if (us.data.meta.errors?.length) {
      html += `<div class="mt-3 text-xs text-amber-500"><i class="fas fa-exclamation-triangle mr-1"></i>部分用户统计失败（${us.data.meta.errors.length}）：${esc(us.data.meta.errors.slice(0, 3).join('；'))}，可点击「刷新」重试</div>`;
    }
    return html;
  }

  // ---------- 交互 ----------
  window.ucReload = (refresh) => { us.data = null; loadSummary(!!refresh); };
  window.ucPreset = (k) => { const [s, e] = presetRange(k); us.start = s; us.end = e; us.preset = k; us.data = null; loadSummary(); };
  window.ucApplyRange = () => {
    let s = document.getElementById('uc-start').value, e = document.getElementById('uc-end').value;
    if (!s || !e) { toast('请选择开始和结束日期', 'warning'); return; }
    if (s > e) [s, e] = [e, s];
    if ((new Date(e) - new Date(s)) / 86400000 > 400) { toast('统计周期最长 400 天', 'warning'); return; }
    us.start = s; us.end = e; us.preset = (PRESETS.find(([k]) => { const [a, b] = presetRange(k); return a === s && b === e; }) || [''])[0];
    us.data = null; loadSummary();
  };
  window.ucSort = (k) => { if (us.sortKey === k) us.sortDir = us.sortDir === 'asc' ? 'desc' : 'asc'; else { us.sortKey = k; us.sortDir = (k === 'username' || k === 'group') ? 'asc' : 'desc'; } us.page = 1; renderUserConsumption(); };
  let searchTimer = null;
  window.ucSearch = (v) => {
    us.search = v; us.page = 1; clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { renderUserConsumption(); const el = document.getElementById('uc-search'); if (el) { el.focus(); el.setSelectionRange(v.length, v.length); } }, 250);
  };
  window.ucGroup = (g) => { us.group = g; us.page = 1; renderUserConsumption(); };
  window.ucHideZero = (b) => { us.hideZero = b; us.page = 1; renderUserConsumption(); };
  window.ucGoPage = (p) => { us.page = p; renderUserConsumption(); };
  window.ucJumpPage = () => { const v = parseInt(document.getElementById('uc-page-jump')?.value); if (v > 0) ucGoPage(v); };

  // ---------- 导出 ----------
  window.ucExportDialog = () => {
    if (!us.data) return;
    const t = us.data.totals;
    showModal('<i class="fas fa-file-excel text-emerald-500 mr-2"></i>导出用户账单', `
      <div class="space-y-3 text-sm">
        <div class="p-3 rounded-lg ${isDark() ? 'bg-slate-700/50' : 'bg-gray-50'} text-xs leading-6">
          统计周期：<b>${esc(us.data.period.label)}</b><br>全站合计：<b>${money(t.amount, 4)}</b> · 有消费用户 <b>${t.activeUsers}</b> 人 · 调用 <b>${num(t.count)}</b> 次</div>
        <p class="text-xs ${cls.textSub()}">包含工作表：整体账单（按月分列）、模型汇总、每日汇总、说明</p>
        <label class="flex items-center gap-2 cursor-pointer"><input id="ux-zero" type="checkbox" class="accent-primary-500"> 包含零消费用户</label>
        <label class="flex items-center gap-2 cursor-pointer"><input id="ux-details" type="checkbox" class="accent-primary-500" onchange="document.getElementById('ux-rows-wrap').style.display=this.checked?'flex':'none'"> 包含调用明细（逐条日志）</label>
        <div id="ux-rows-wrap" class="items-center gap-2 pl-6" style="display:none"><span class="text-xs ${cls.textSub()}">最多导出最新</span>
          <select id="ux-rows" class="${cls.input()} !py-1 text-xs">${[2000, 10000, 20000, 50000].map(n => `<option value="${n}" ${n === 10000 ? 'selected' : ''}>${num(n)}</option>`).join('')}</select>
          <span class="text-xs ${cls.textSub()}">条（共 ${num(t.count)} 条）</span></div>
      </div>`, [{ label: '<i class="fas fa-download mr-1"></i>导出 Excel', action: 'ucDoExport()' }]);
  };
  window.ucDoExport = async () => {
    const details = document.getElementById('ux-details')?.checked;
    const zero = document.getElementById('ux-zero')?.checked;
    const rows = document.getElementById('ux-rows')?.value || 10000;
    closeModal();
    toast(details ? `正在生成账单（含最多 ${num(rows)} 条明细，可能需要 1 分钟）...` : '正在生成账单...', 'info', 5000);
    try {
      const resp = await fetch(`/api/admin/usage/export?${qs()}&details=${details ? 1 : 0}&maxRows=${rows}&includeZero=${zero ? 1 : 0}`, { headers: { 'Authorization': 'Bearer ' + store.token } });
      const ctype = resp.headers.get('content-type') || '';
      if (!resp.ok || ctype.includes('json')) { const e = await resp.json().catch(() => ({})); toast(e.message || '导出失败', 'error'); return; }
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `用户用量账单_${us.start}_${us.end}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('导出成功！', 'success');
    } catch (e) { toast('导出失败: ' + e.message, 'error'); }
  };

  // ---------- 用户详情 ----------
  window.ucShowUser = async (username) => {
    us.detailUser = username; us.detail = null; us.detailLogs = null; us.logPage = 1; us.logModel = '';
    renderDetail();
    try {
      const [r1] = await Promise.all([api.get(`/admin/usage/user/${encodeURIComponent(username)}?${qs()}`), loadLogs(false)]);
      if (us.detailUser !== username) return;
      if (r1.code === 0) us.detail = r1.data; else { toast(r1.message, 'error'); }
    } catch (e) { toast('加载失败: ' + e.message, 'error'); }
    renderDetail();
  };
  async function loadLogs(rerender = true) {
    const u = us.detailUser;
    us.detailLogs = { loading: true };
    if (rerender) renderDetail();
    try {
      const r = await api.get(`/admin/usage/user/${encodeURIComponent(u)}/logs?${qs()}&page=${us.logPage}&pageSize=50${us.logModel ? '&model=' + encodeURIComponent(us.logModel) : ''}`);
      if (us.detailUser !== u) return;
      us.detailLogs = r.code === 0 ? r.data : { error: r.message };
    } catch (e) { us.detailLogs = { error: e.message }; }
    if (rerender) renderDetail();
  }
  window.ucBack = () => { us.detailUser = null; us.detail = null; us.detailLogs = null; renderUserConsumption(); };
  window.ucLogPage = (p) => { us.logPage = p; loadLogs(); };
  window.ucLogJump = () => { const v = parseInt(document.getElementById('uc-log-jump')?.value); if (v > 0) ucLogPage(v); };
  window.ucLogModel = (m) => { us.logModel = m; us.logPage = 1; loadLogs(); };

  function renderDetail() {
    const ct = document.getElementById('page-content');
    const d = isDark();
    const u = us.data?.users.find(x => x.username === us.detailUser) || { username: us.detailUser };
    const det = us.detail;
    let html = `<div class="flex items-center gap-3 mb-4 fade-in">
      <button onclick="ucBack()" class="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${d ? 'hover:bg-slate-700 text-slate-400 border border-slate-700' : 'hover:bg-gray-100 text-gray-500 border border-gray-200'}"><i class="fas fa-arrow-left text-sm"></i></button>
      <div class="min-w-0"><h2 class="text-base font-semibold ${cls.text()} truncate"><i class="fas fa-user mr-2 text-primary-500"></i>${esc(u.username)} <span class="${cls.textMuted()} text-xs font-normal">${u.id ? 'ID ' + u.id : ''} ${u.group ? '· ' + esc(u.group) : ''}</span></h2>
      <p class="${cls.textSub()} text-xs mt-0.5">${esc(us.start)} ~ ${esc(us.end)} 的消费账单</p></div></div>`;

    if (!det) {
      html += `<div class="flex items-center justify-center h-40"><div class="w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full animate-spin"></div></div>`;
      ct.innerHTML = html; return;
    }
    const t = det.totals;
    html += `<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4 fade-in">
      ${card('周期消费', money(t.amount, 4), u.share !== undefined ? `占全站 ${(u.share * 100).toFixed(2)}%` : '', 'fas fa-coins text-cyan-500', ['from-cyan-400 to-cyan-600', 'bg-cyan-500/10'])}
      ${card('调用次数', num(t.count), `单次均价 ${money(t.count ? t.amount / t.count : 0, 4)}`, 'fas fa-bolt text-purple-500', ['from-purple-400 to-purple-600', 'bg-purple-500/10'])}
      ${card('Token 用量', compact(t.tokens), num(t.tokens), 'fas fa-layer-group text-emerald-500', ['from-emerald-400 to-emerald-600', 'bg-emerald-500/10'])}
      ${card('当前余额', u.balance !== undefined ? money(u.balance) : '-', u.lastAt ? '最近调用 ' + tsStr(u.lastAt) : '', 'fas fa-wallet text-amber-500', ['from-amber-400 to-orange-500', 'bg-amber-500/10'])}
    </div>`;

    html += `<div class="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4 fade-in">
      <div class="${cls.card()} p-4 lg:col-span-2"><div class="flex items-center gap-2 mb-3"><i class="fas fa-chart-column text-primary-500 text-sm"></i><h3 class="text-sm font-semibold ${cls.text()}">每日消费</h3><span id="uc-user-tip" class="${cls.textMuted()} text-xs ml-auto font-mono"></span></div>
        <div style="height:200px"><canvas id="uc-user-chart" class="w-full h-full"></canvas></div></div>
      <div class="${cls.card()} overflow-hidden"><div class="px-4 py-3 border-b ${d ? 'border-slate-700' : 'border-gray-100'} text-sm font-semibold ${cls.text()}"><i class="fas fa-cubes text-primary-500 mr-2"></i>模型分布</div>
        <div class="max-h-[200px] overflow-y-auto scrollbar-thin"><table class="w-full text-xs">${det.models.map(m => `<tr class="border-b ${d ? 'border-slate-700/50' : 'border-gray-50'} cursor-pointer hover:${d ? 'bg-slate-700/30' : 'bg-gray-50'}" onclick="ucLogModel(${jsArg(m.model)})" title="点击筛选该模型的明细">
          <td class="px-4 py-2 font-mono ${cls.text()}">${esc(m.model)}</td><td class="px-2 py-2 text-right font-mono ${cls.textSub()}">${num(m.count)}次</td><td class="px-4 py-2 text-right font-mono font-medium ${cls.text()}">${money(m.amount)}</td></tr>`).join('') || `<tr><td class="p-6 text-center ${cls.textMuted()}">暂无</td></tr>`}</table></div></div>
    </div>`;

    // 明细
    const L = us.detailLogs;
    html += `<div class="${cls.card()} overflow-hidden fade-in"><div class="px-4 py-3 border-b ${d ? 'border-slate-700' : 'border-gray-100'} flex items-center gap-2 flex-wrap">
      <i class="fas fa-list text-primary-500 text-sm"></i><h3 class="text-sm font-semibold ${cls.text()}">调用明细</h3>
      ${L && L.total !== undefined ? `<span class="${cls.textMuted()} text-xs">共 ${num(L.total)} 条</span>` : ''}
      <select onchange="ucLogModel(this.value)" class="${cls.input()} !py-1 text-xs ml-auto"><option value="">全部模型</option>${det.models.map(m => `<option value="${esc(m.model)}" ${m.model === us.logModel ? 'selected' : ''}>${esc(m.model)}</option>`).join('')}</select></div>`;
    if (!L || L.loading) html += `<div class="py-10 text-center"><div class="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto"></div></div>`;
    else if (L.error) html += `<div class="py-10 text-center text-xs text-red-500">${esc(L.error)}</div>`;
    else {
      html += `<div class="overflow-x-auto scrollbar-thin"><table class="w-full text-xs"><thead><tr class="${d ? 'bg-slate-700/50' : 'bg-gray-50'} text-left">
        ${['时间', '模型', '分组', '令牌', '输入', '输出', '费用', '耗时', '渠道', 'IP'].map(h => `<th class="px-3 py-2.5 font-semibold ${cls.textSub()} whitespace-nowrap">${h}</th>`).join('')}</tr></thead><tbody>`;
      if (!L.items.length) html += `<tr><td colspan="10" class="py-10 text-center ${cls.textMuted()}">暂无记录</td></tr>`;
      for (const x of L.items) {
        html += `<tr class="border-t ${d ? 'border-slate-700/50' : 'border-gray-100'}">
          <td class="px-3 py-2 font-mono ${cls.textSub()} whitespace-nowrap">${esc(x.time)}</td>
          <td class="px-3 py-2"><span class="px-1.5 py-0.5 rounded font-mono ${d ? 'bg-slate-700 text-slate-200' : 'bg-gray-100 text-gray-800'}">${esc(x.model)}</span></td>
          <td class="px-3 py-2 ${cls.textSub()}">${esc(x.group || '-')}</td>
          <td class="px-3 py-2 ${cls.textSub()} whitespace-nowrap">${esc(x.token_name || '-')}</td>
          <td class="px-3 py-2 font-mono ${cls.text()}">${num(x.prompt_tokens)}</td>
          <td class="px-3 py-2 font-mono ${cls.text()}">${num(x.completion_tokens)}</td>
          <td class="px-3 py-2 font-mono font-medium ${x.amount >= 0.1 ? 'text-amber-500' : cls.text()}">${sym()}${x.amount.toFixed(6)}</td>
          <td class="px-3 py-2 font-mono ${cls.textSub()}">${x.use_time}s${x.is_stream ? ' <i class="fas fa-water text-[9px] text-primary-400" title="流式"></i>' : ''}</td>
          <td class="px-3 py-2 ${cls.textMuted()} whitespace-nowrap">${esc(x.channel)}</td>
          <td class="px-3 py-2 font-mono ${cls.textMuted()}">${esc(x.ip || '-')}</td></tr>`;
      }
      html += `</tbody></table></div>`;
      if (L.totalPages > 1) html += `<div class="px-4 py-3 border-t ${d ? 'border-slate-700' : 'border-gray-100'}">${renderGenericPagination(L.page, L.totalPages, L.total, 'ucLogPage', 'uc-log-jump', 'ucLogJump', d)}</div>`;
    }
    html += `</div>`;
    ct.innerHTML = html;
    requestAnimationFrame(() => drawBars('uc-user-chart', 'uc-user-tip', det.daily));
  }

  // app.js 先于本文件执行 render()，若当前就在本页则补渲染一次
  if (typeof store !== 'undefined' && store.currentPage === 'user-consumption') renderUserConsumption();
})();
