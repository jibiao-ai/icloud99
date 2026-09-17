// ===== 元擎智算可视化 v2.2 =====
const store = {
  theme: localStorage.getItem('theme') || 'light',
  currentPage: 'token-usage',
  token: localStorage.getItem('token') || '',
  user: null,
  sidebarOpen: window.innerWidth > 768,
  iqPage: 1,
  iqTotalPages: 1,
  chProvider: 'openai',
  chPage: 1,
  chTotalPages: 1,
  chChannels: null,
  setTheme(t) { this.theme = t; localStorage.setItem('theme', t); document.documentElement.setAttribute('data-theme', t); render(); },
  setPage(p) { this.currentPage = p; render(); },
  setToken(t) { this.token = t; localStorage.setItem('token', t); },
  logout() { this.token = ''; this.user = null; localStorage.removeItem('token'); this.setPage('channel-status'); },
  toggleSidebar() { this.sidebarOpen = !this.sidebarOpen; render(); }
};
document.documentElement.setAttribute('data-theme', store.theme);

// ===== Toast System =====
function toast(msg, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  const colors = { success: 'from-emerald-500 to-emerald-600', error: 'from-red-500 to-red-600', info: 'from-primary-500 to-primary-600', warning: 'from-amber-500 to-amber-600' };
  const icons = { success: 'fa-check-circle', error: 'fa-times-circle', info: 'fa-info-circle', warning: 'fa-exclamation-triangle' };
  const el = document.createElement('div');
  el.style.pointerEvents = 'auto';
  el.className = `toast-in flex items-center gap-3 px-5 py-3.5 rounded-xl shadow-2xl text-white text-sm font-medium bg-gradient-to-r ${colors[type]} border border-white/20`;
  el.innerHTML = `<i class="fas ${icons[type]} text-base"></i><span>${msg}</span>`;
  container.appendChild(el);
  setTimeout(() => { el.className = el.className.replace('toast-in', 'toast-out'); setTimeout(() => el.remove(), 300); }, duration);
}

// ===== Modal System =====
function showModal(title, content, actions = []) {
  const d = isDark();
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9998] flex items-center justify-center p-4 fade-in" onclick="closeModal()">
      <div class="w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden ${d ? 'bg-slate-800 border border-slate-700' : 'bg-white'}" onclick="event.stopPropagation()">
        <div class="h-1 bg-gradient-to-r from-primary-500 via-primary-400 to-primary-600"></div>
        <div class="p-6">
          <h3 class="text-lg font-semibold ${d ? 'text-slate-100' : 'text-gray-800'} mb-4">${title}</h3>
          <div class="${d ? 'text-slate-300' : 'text-gray-600'} text-sm">${content}</div>
        </div>
        <div class="px-6 pb-6 flex justify-end gap-3">
          <button onclick="closeModal()" class="px-4 py-2 rounded-lg text-sm border ${d ? 'border-slate-600 text-slate-300 hover:bg-slate-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}">取消</button>
          ${actions.map(a => `<button onclick="${a.action}" class="px-4 py-2 rounded-lg text-sm font-medium text-white bg-gradient-to-r ${a.danger ? 'from-red-500 to-red-600 hover:from-red-600 hover:to-red-700' : 'from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700'}">${a.label}</button>`).join('')}
        </div>
      </div>
    </div>`;
}
function closeModal() { document.getElementById('modal-root').innerHTML = ''; }

// ===== API =====
const api = {
  async request(method, path, body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (store.token) headers['Authorization'] = `Bearer ${store.token}`;
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch('/api' + path, opts);
    const data = await resp.json();
    if (resp.status === 401 && path !== '/login') { store.logout(); toast('登录已过期，请重新登录', 'warning'); }
    return data;
  },
  get: (p) => api.request('GET', p),
  post: (p, b) => api.request('POST', p, b),
  put: (p, b) => api.request('PUT', p, b),
  del: (p) => api.request('DELETE', p),
};

// ===== Helpers =====
const isDark = () => store.theme === 'dark';
const isLoggedIn = () => !!store.token;
const cls = {
  card: () => `rounded-xl border shadow-sm transition-shadow hover:shadow-md ${isDark() ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200'}`,
  text: () => isDark() ? 'text-slate-200' : 'text-gray-800',
  textSub: () => isDark() ? 'text-slate-400' : 'text-gray-500',
  textMuted: () => isDark() ? 'text-slate-500' : 'text-gray-400',
  input: () => `px-3 py-2.5 rounded-lg border text-sm transition-all ${isDark() ? 'bg-slate-700/80 border-slate-600 text-slate-200 placeholder-slate-500' : 'bg-white border-gray-300 text-gray-800 placeholder-gray-400'}`,
  btn: () => `px-4 py-2.5 rounded-lg text-sm font-medium transition-all bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white shadow-sm`,
  btnSec: () => `px-4 py-2.5 rounded-lg text-sm font-medium transition-all border ${isDark() ? 'border-slate-600 text-slate-300 hover:bg-slate-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`,
  btnDisabled: () => `px-4 py-2.5 rounded-lg text-sm font-medium transition-all bg-gradient-to-r from-gray-300 to-gray-400 text-gray-100 cursor-not-allowed opacity-60`,
};
function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return '刚刚';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前`;
  return `${Math.floor(h / 24)}天前`;
}
function fmtTime(dateStr) {
  try { return new Date(dateStr).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { return dateStr; }
}
const tierLabel = (t) => ({ lite: 'Lite', standard: 'Standard', ultra: 'Ultra' }[t] || t);
const tierColor = (t) => ({ lite: 'from-blue-400 to-cyan-500', standard: 'from-violet-500 to-purple-600', ultra: 'from-amber-500 to-orange-600' }[t] || 'from-gray-400 to-gray-500');
const tierBadge = (t) => `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold text-white bg-gradient-to-r ${tierColor(t)} shadow-sm">${tierLabel(t)}</span>`;

function genAccountId(id, testedAt) {
  let hash = 0x9e3779b9;
  const str = String(id) + (testedAt || '') + String(id * 2654435761);
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    hash = (hash ^ (hash >>> 16)) | 0;
  }
  const a = (Math.abs(hash) >>> 0).toString(16).padStart(8, '0');
  let hash2 = 0x517cc1b7;
  for (let i = str.length - 1; i >= 0; i--) {
    hash2 = ((hash2 << 7) + hash2 + str.charCodeAt(i)) | 0;
    hash2 = (hash2 ^ (hash2 >>> 13)) | 0;
  }
  const b = (Math.abs(hash2) >>> 0).toString(16).padStart(4, '0');
  return a + b;
}

function fmtDateFull(dateStr) {
  try {
    const d = new Date(dateStr);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${mm}/${dd} ${hh}:${mi}:${ss}`;
  } catch { return dateStr || ''; }
}

function scopeSvgForCard(svgCode, id) {
  const uid = 'sv' + id;
  let s = svgCode;
  s = s.replace(/(<svg[^>]*?)\s+width\s*=\s*["'][^"']*["']/gi, '$1');
  s = s.replace(/(<svg[^>]*?)\s+height\s*=\s*["'][^"']*["']/gi, '$1');
  s = s.replace(/<svg/i, `<svg width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="display:block"`);
  s = s.replace(/id="([^"]*)"/gi, `id="${uid}_$1"`);
  s = s.replace(/href="#([^"]*)"/gi, `href="#${uid}_$1"`);
  s = s.replace(/url\(#([^)]*)\)/gi, `url(#${uid}_$1)`);
  s = s.replace(/aria-labelledby="([^"]*)"/gi, (m, ids) => {
    return `aria-labelledby="${ids.split(/\s+/).map(i => uid + '_' + i).join(' ')}"`;
  });
  s = s.replace(/class="([^"]*)"/gi, (match, classes) => {
    const scoped = classes.split(/\s+/).map(c => c ? uid + '_' + c : '').join(' ');
    return `class="${scoped}"`;
  });
  s = s.replace(/<style>([\s\S]*?)<\/style>/gi, (match, css) => {
    let sc = css;
    sc = sc.replace(/\.([a-zA-Z][\w-]*)/g, '.' + uid + '_$1');
    sc = sc.replace(/@keyframes\s+([\w-]+)/g, '@keyframes ' + uid + '_$1');
    sc = sc.replace(/animation:\s*([\w-]+)/g, (m, name) => 'animation: ' + uid + '_' + name);
    return `<style>${sc}</style>`;
  });
  return s;
}

// ===== Auth Guard Helper =====
function requireLogin(actionName) {
  if (!isLoggedIn()) {
    toast(`请先登录后再${actionName || '操作'}`, 'warning');
    store.setPage('admin-settings');
    return false;
  }
  return true;
}

// ===== CHANNEL STATUS PAGE =====
const CH_PAGE_SIZE = 12; // 每页显示渠道数
const providerInfo = { openai: { label: 'OpenAI', icon: '✦', color: 'text-emerald-500', bgActive: 'from-emerald-500 to-teal-600' }, anthropic: { label: 'Anthropic', icon: '✸', color: 'text-orange-500', bgActive: 'from-orange-500 to-red-500' } };

async function renderChannelStatus() {
  const ct = document.getElementById('page-content');
  // Only show spinner on first load
  if (!store.chChannels) {
    ct.innerHTML = `<div class="flex items-center justify-center h-64"><div class="w-10 h-10 border-3 border-primary-500 border-t-transparent rounded-full animate-spin"></div></div>`;
    const { data: channels } = await api.get('/channels?range=7');
    store.chChannels = channels || [];
  }
  const channels = store.chChannels;
  if (channels.length === 0) {
    ct.innerHTML = `<div class="text-center py-20 fade-in"><div class="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary-500/20 to-primary-600/20 flex items-center justify-center mx-auto mb-4"><i class="fas fa-satellite-dish text-3xl text-primary-500"></i></div><p class="${cls.text()} text-lg font-semibold">尚未配置渠道</p><p class="${cls.textSub()} text-sm mt-2 mb-6">请先登录管理员账号，初始化数据并配置API密钥</p><button onclick="store.setPage('admin-settings')" class="${cls.btn()}"><i class="fas fa-cog mr-2"></i>前往管理设置</button></div>`;
    return;
  }
  renderChannelStatusContent(channels);
}

function renderChannelStatusContent(channels) {
  const ct = document.getElementById('page-content');
  const d = isDark();
  const prov = store.chProvider || 'openai';
  const page = store.chPage || 1;

  const allRates = channels.map(c => c.success_rate);
  const avgRate = Math.round(allRates.reduce((a, b) => a + b, 0) / allRates.length);
  const status = avgRate >= 95 ? 'OPERATIONAL' : avgRate >= 80 ? 'DEGRADED' : 'OUTAGE';
  const sColor = status === 'OPERATIONAL' ? 'text-emerald-500 bg-emerald-500/10' : status === 'DEGRADED' ? 'text-amber-500 bg-amber-500/10' : 'text-red-500 bg-red-500/10';

  const loggedIn = isLoggedIn();
  const testBtnClass = loggedIn ? cls.btn() : cls.btnDisabled();
  const testBtnAction = loggedIn ? 'onclick="runChannelTests()"' : 'onclick="requireLogin(\'检测\')"';

  // Provider channels
  const provChannels = channels.filter(c => c.provider === prov);
  const openaiCount = channels.filter(c => c.provider === 'openai').length;
  const anthropicCount = channels.filter(c => c.provider === 'anthropic').length;
  const totalItems = provChannels.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / CH_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  store.chPage = currentPage;
  store.chTotalPages = totalPages;

  // Paginate
  const startIdx = (currentPage - 1) * CH_PAGE_SIZE;
  const pageChannels = provChannels.slice(startIdx, startIdx + CH_PAGE_SIZE);

  // Provider tab styles
  const tabCls = (p) => {
    const active = p === prov;
    const info = providerInfo[p];
    if (active) return `px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r ${info.bgActive} shadow-md cursor-default transition-all`;
    return `px-5 py-2.5 rounded-xl text-sm font-medium ${d ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/60 border border-slate-600/50' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100 border border-gray-200'} cursor-pointer transition-all`;
  };

  let html = `<div class="flex flex-wrap items-center justify-between gap-4 mb-6">
    <div class="flex items-center gap-3"><h2 class="text-lg font-semibold ${cls.text()}"><i class="fas fa-satellite-dish mr-2 text-primary-500"></i>渠道状态</h2><span class="${sColor} px-3 py-1 rounded-full text-xs font-bold">${status}</span></div>
    <div class="flex items-center gap-2">
      <button ${testBtnAction} class="${testBtnClass} text-xs !py-2"><i class="fas fa-vial mr-1"></i>立即检测${!loggedIn ? ' 🔒' : ''}</button>
      <button onclick="store.chChannels=null;renderChannelStatus()" class="px-3 py-2 rounded-lg text-xs ${d ? 'bg-slate-700 text-slate-300 hover:bg-slate-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"><i class="fas fa-sync-alt"></i></button>
      <span class="${cls.textMuted()} text-xs"><i class="fas fa-clock mr-1"></i>每小时自动检测</span>
    </div></div>`;

  // Provider tabs
  html += `<div class="flex items-center gap-3 mb-6">
    <button onclick="switchChProvider('openai')" class="${tabCls('openai')}">
      <span class="mr-1.5">${providerInfo.openai.icon}</span>OpenAI<span class="ml-2 px-1.5 py-0.5 rounded text-[10px] font-mono ${prov==='openai'?'bg-white/20 text-white':'opacity-60'}">${openaiCount}</span>
    </button>
    <button onclick="switchChProvider('anthropic')" class="${tabCls('anthropic')}">
      <span class="mr-1.5">${providerInfo.anthropic.icon}</span>Anthropic<span class="ml-2 px-1.5 py-0.5 rounded text-[10px] font-mono ${prov==='anthropic'?'bg-white/20 text-white':'opacity-60'}">${anthropicCount}</span>
    </button>
  </div>`;

  // Cards grid (flat, no tier grouping — cards show tier in name already)
  if (pageChannels.length === 0) {
    html += `<div class="text-center py-16 fade-in"><i class="fas fa-inbox text-4xl ${cls.textMuted()} mb-3"></i><p class="${cls.textSub()} text-sm">该分类暂无渠道数据</p></div>`;
  } else {
    html += `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 fade-in">`;
    pageChannels.forEach(ch => { html += renderChannelCard(ch); });
    html += `</div>`;
  }

  // Pagination
  if (totalPages > 1) {
    html += renderChPagination(currentPage, totalPages, totalItems);
  }

  ct.innerHTML = html;
}

window.switchChProvider = function(prov) {
  store.chProvider = prov;
  store.chPage = 1;
  renderChannelStatusContent(store.chChannels || []);
};

function renderChPagination(currentPage, totalPages, total) {
  const d = isDark();
  const btnBase = `px-3 py-2 rounded-lg text-sm font-medium transition-all`;
  const btnActive = `${btnBase} bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-sm`;
  const btnNormal = `${btnBase} ${d ? 'text-slate-300 hover:bg-slate-700 border border-slate-600' : 'text-gray-700 hover:bg-gray-100 border border-gray-300'}`;
  const btnDis = `${btnBase} ${d ? 'text-slate-600 border border-slate-700 cursor-not-allowed' : 'text-gray-300 border border-gray-200 cursor-not-allowed'}`;
  let pages = [1];
  let start = Math.max(2, currentPage - 2), end = Math.min(totalPages - 1, currentPage + 2);
  if (start > 2) pages.push('...');
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < totalPages - 1) pages.push('...');
  if (totalPages > 1) pages.push(totalPages);
  let html = `<div class="flex items-center justify-center gap-2 mt-8 mb-4 flex-wrap">`;
  html += `<button onclick="goChPage(1)" ${currentPage===1?'disabled':''} class="${currentPage===1?btnDis:btnNormal}" title="首页"><i class="fas fa-angles-left text-xs"></i></button>`;
  html += `<button onclick="goChPage(${currentPage-1})" ${currentPage===1?'disabled':''} class="${currentPage===1?btnDis:btnNormal}" title="上一页"><i class="fas fa-angle-left text-xs"></i></button>`;
  for (const p of pages) {
    if (p === '...') html += `<span class="px-2 py-2 text-sm ${cls.textMuted()}">…</span>`;
    else html += `<button onclick="goChPage(${p})" class="${p===currentPage?btnActive:btnNormal}">${p}</button>`;
  }
  html += `<button onclick="goChPage(${currentPage+1})" ${currentPage===totalPages?'disabled':''} class="${currentPage===totalPages?btnDis:btnNormal}" title="下一页"><i class="fas fa-angle-right text-xs"></i></button>`;
  html += `<button onclick="goChPage(${totalPages})" ${currentPage===totalPages?'disabled':''} class="${currentPage===totalPages?btnDis:btnNormal}" title="尾页"><i class="fas fa-angles-right text-xs"></i></button>`;
  html += `<div class="flex items-center gap-2 ml-4"><span class="${cls.textSub()} text-sm">跳至</span><input id="ch-page-jump" type="number" min="1" max="${totalPages}" value="${currentPage}" class="${cls.input()} !w-16 !py-1.5 text-center" onkeydown="if(event.key==='Enter')jumpChPage()"><span class="${cls.textSub()} text-sm">页</span><button onclick="jumpChPage()" class="${btnNormal} !px-3 !py-1.5">GO</button></div>`;
  html += `<span class="${cls.textMuted()} text-xs ml-3">共 ${total} 个渠道 / ${totalPages} 页</span>`;
  html += `</div>`;
  return html;
}

window.goChPage = function(p) {
  if (p < 1) p = 1;
  if (p > store.chTotalPages) p = store.chTotalPages;
  store.chPage = p;
  renderChannelStatusContent(store.chChannels || []);
};
window.jumpChPage = function() {
  const input = document.getElementById('ch-page-jump');
  if (!input) return;
  let p = parseInt(input.value);
  if (isNaN(p) || p < 1) p = 1;
  if (p > store.chTotalPages) p = store.chTotalPages;
  goChPage(p);
};

function getBarColor(responseTime, ping, success) {
  if (!success) return '#ef4444'; // red for failures
  // For response time based coloring
  if (responseTime <= 25000 && ping <= 1500) return '#10b981'; // green
  if (responseTime >= 50000 || ping >= 3000) return '#ef4444'; // red
  return '#f59e0b'; // orange
}

function getSpeedLabel(responseTime, ping) {
  if (responseTime <= 0) return { label: '未知', color: 'text-gray-400', dot: 'bg-gray-400' };
  if (responseTime <= 25000 && ping <= 1500) return { label: '极速', color: isDark() ? 'text-emerald-400' : 'text-emerald-600', dot: 'bg-emerald-400' };
  if (responseTime >= 50000 || ping >= 3000) return { label: '拥堵', color: 'text-red-500', dot: 'bg-red-400' };
  return { label: '较慢', color: 'text-amber-500', dot: 'bg-amber-400' };
}

function renderChannelCard(ch) {
  const lt = ch.latest_test;
  const rate = ch.success_rate;
  const rateColor = rate >= 95 ? 'text-emerald-500' : rate >= 80 ? 'text-amber-500' : 'text-red-500';
  const responseTime = lt ? lt.response_time_ms : 0;
  const pingTime = lt ? lt.ping_ms : 0;
  const speed = getSpeedLabel(responseTime, pingTime);
  const rateMultiplier = ch.rate_multiplier || 1.0;

  // Build 60-slot bar chart: fill existing data, pad with gray
  const history = ch.history || [];
  const TOTAL_BARS = 60;
  let bars = '';
  for (let i = 0; i < TOTAL_BARS; i++) {
    if (i < history.length) {
      const h = history[i];
      const height = h.success ? Math.max(4, Math.min(32, h.response_time / 100)) : 2;
      const color = getBarColor(h.response_time, h.ping || 0, h.success);
      bars += `<div class="bar" style="height:${height}px;background:${color}" data-tooltip="${timeAgo(h.time)} · ${h.success ? '正常' : '失败'} · ${h.response_time}ms" onmouseenter="showTooltip(event,this)" onmouseleave="hideTooltip()"></div>`;
    } else {
      // Gray placeholder for unfilled slots
      bars += `<div class="bar" style="height:4px;background:${isDark() ? '#334155' : '#d1d5db'}" data-tooltip="暂无数据" onmouseenter="showTooltip(event,this)" onmouseleave="hideTooltip()"></div>`;
    }
  }

  // Speed badge color
  const speedBadgeColor = speed.label === '极速' ? (isDark() ? 'bg-emerald-900/50 text-emerald-400 border-emerald-700/50' : 'bg-emerald-50 text-emerald-600 border-emerald-200')
    : speed.label === '较慢' ? (isDark() ? 'bg-amber-900/50 text-amber-400 border-amber-700/50' : 'bg-amber-50 text-amber-600 border-amber-200')
    : speed.label === '拥堵' ? (isDark() ? 'bg-red-900/50 text-red-400 border-red-700/50' : 'bg-red-50 text-red-600 border-red-200')
    : (isDark() ? 'bg-slate-700 text-slate-400 border-slate-600' : 'bg-gray-100 text-gray-500 border-gray-200');

  return `<div class="${cls.card()} p-4 fade-in cursor-pointer" onclick="showChannelDetail(${ch.id})">
    <div class="flex items-start justify-between mb-3"><div class="flex items-center gap-2"><span class="text-lg">${ch.icon||'📡'}</span><div><h4 class="text-sm font-semibold ${cls.text()}">${ch.name}</h4><p class="${cls.textMuted()} text-xs font-mono">${ch.model_id}</p></div></div>
    <div class="flex items-center gap-2">
      <span class="${cls.textMuted()} text-[11px] font-mono">倍率:${rateMultiplier}x</span>
      <span class="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${speedBadgeColor}"><span class="w-1.5 h-1.5 rounded-full ${speed.dot} pulse-dot"></span>${speed.label}</span>
    </div></div>
    <div class="flex items-end justify-between mb-3"><div class="flex gap-4 text-xs"><div><span class="${cls.textMuted()}">对话延迟</span> <span class="font-mono font-medium ${cls.text()}">${lt?lt.response_time_ms:'-'}ms</span></div><div><span class="${cls.textMuted()}">端点 PING</span> <span class="font-mono font-medium ${cls.text()}">${lt?lt.ping_ms:'-'}ms</span></div></div>
    <span class="text-2xl font-bold ${rateColor}">${rate}%</span></div>
    <div class="flex items-center justify-between mb-1"><span class="${cls.textMuted()} text-xs">${ch.total_tests}次检测</span></div>
    <div class="bar-chart-mini">${bars}</div></div>`;
}

// ===== Channel Detail Modal =====
window.showChannelDetail = async function(channelId) {
  const d = isDark();
  const root = document.getElementById('modal-root');
  // Show loading first
  root.innerHTML = `
    <div class="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9998] flex items-center justify-center p-4 fade-in" onclick="closeModal()">
      <div class="w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden ${d ? 'bg-slate-800' : 'bg-white'}" onclick="event.stopPropagation()">
        <div class="p-8 flex items-center justify-center"><div class="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin"></div></div>
      </div>
    </div>`;

  try {
    const resp = await api.get(`/channels/${channelId}/detail`);
    if (resp.code !== 0) { closeModal(); toast('获取渠道详情失败', 'error'); return; }
    const data = resp.data;
    const ch = data.channel;

    const statusColor = data.latest_status === '正常'
      ? (d ? 'bg-emerald-900/50 text-emerald-400' : 'bg-emerald-100 text-emerald-700')
      : (d ? 'bg-red-900/50 text-red-400' : 'bg-red-100 text-red-700');

    root.innerHTML = `
    <div class="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9998] flex items-center justify-center p-4 fade-in" onclick="closeModal()">
      <div class="w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden ${d ? 'bg-slate-800' : 'bg-white'}" onclick="event.stopPropagation()">
        <div class="flex items-center justify-between px-6 py-4 border-b ${d ? 'border-slate-700' : 'border-gray-200'}">
          <div class="flex items-center gap-2">
            <span class="text-xl">${ch.icon || '📡'}</span>
            <h3 class="text-base font-bold ${cls.text()}">${ch.name}</h3>
          </div>
          <button onclick="closeModal()" class="w-8 h-8 rounded-lg flex items-center justify-center ${d ? 'hover:bg-slate-700 text-slate-400' : 'hover:bg-gray-100 text-gray-500'} transition-colors"><i class="fas fa-times"></i></button>
        </div>
        <div class="p-6 overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b ${d ? 'border-slate-700' : 'border-gray-200'}">
                <th class="text-left pb-3 font-medium ${cls.textSub()}">模型</th>
                <th class="text-left pb-3 font-medium ${cls.textSub()}">最新状态</th>
                <th class="text-left pb-3 font-medium ${cls.textSub()}">最新延迟 (MS)</th>
                <th class="text-left pb-3 font-medium ${cls.textSub()}">7 天可用率</th>
                <th class="text-left pb-3 font-medium ${cls.textSub()}">15 天可用率</th>
                <th class="text-left pb-3 font-medium ${cls.textSub()}">30 天可用率</th>
                <th class="text-left pb-3 font-medium ${cls.textSub()}">7 天平均延迟 (MS)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="py-3 font-mono ${cls.text()}">${ch.model_id}</td>
                <td class="py-3"><span class="px-2 py-1 rounded text-xs font-medium ${statusColor}">${data.latest_status}</span></td>
                <td class="py-3 font-mono ${cls.text()}">${data.latest_latency}</td>
                <td class="py-3 font-mono ${cls.text()}">${data.availability_7d}</td>
                <td class="py-3 font-mono ${cls.text()}">${data.availability_15d}</td>
                <td class="py-3 font-mono ${cls.text()}">${data.availability_30d}</td>
                <td class="py-3 font-mono ${cls.text()}">${data.avg_latency_7d}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="px-6 pb-5 flex justify-end">
          <button onclick="closeModal()" class="px-5 py-2 rounded-lg text-sm font-medium border ${d ? 'border-slate-600 text-slate-300 hover:bg-slate-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}">关闭</button>
        </div>
      </div>
    </div>`;
  } catch (e) {
    closeModal();
    toast('获取渠道详情失败: ' + e.message, 'error');
  }
};

window.runChannelTests = async function() {
  if (!requireLogin('检测')) return;
  toast('正在检测所有渠道...', 'info', 5000);
  const resp = await api.post('/test-channels', {});
  if (resp.code === 0) { toast(`检测完成！共 ${resp.data.length} 个渠道`, 'success'); store.chChannels = null; renderChannelStatus(); }
  else toast(resp.message, 'error');
};

// ===== IQ RADAR PAGE =====
function renderIQRadar() {
  const ct = document.getElementById('page-content');
  const theme = store.theme;
  const radarUrl = `https://iq-radar.pages.dev/?user_id=118508&token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoxMTg1MDgsImVtYWlsIjoiNjkxMTgxMzY0QHFxLmNvbSIsInJvbGUiOiJ1c2VyIiwidG9rZW5fdmVyc2lvbiI6OTAyMTA4NTA5NTAzNTY2NTYzOCwic2lkIjoiYzAwMTliNWUxNDI3YzFkMWE3N2FiMjNkOTVkOWUzMmYiLCJibmQiOiI1MmRmMGNjNDUzNTMzY2ZjM2ZmZTVmMDMyY2U2NDgxNyIsImV4cCI6MTc4OTY1MTI5NywibmJmIjoxNzg5NTY0ODk3LCJpYXQiOjE3ODk1NjQ4OTd9.p_sbrD5i_AlCCe0RWGnv3rzTnIvABhuIyuSxuwlxf94&theme=${theme}&lang=zh&ui_mode=embedded&src_host=https://edge.lingsuan.org&src_url=https://edge.lingsuan.org/custom/c0d43342ecab1260`;
  ct.innerHTML = `<div class="flex items-center justify-between mb-4"><h2 class="text-lg font-semibold ${cls.text()}"><i class="fas fa-crosshairs mr-2 text-primary-500"></i>GPT 智商雷达</h2><a href="${radarUrl}" target="_blank" class="${cls.btnSec()} text-xs"><i class="fas fa-external-link-alt mr-1"></i>新窗口打开</a></div>
    <div class="${cls.card()} overflow-hidden" style="height:calc(100vh - 160px)"><iframe id="iq-radar-frame" src="${radarUrl}" class="w-full h-full border-0" allow="fullscreen" loading="lazy"></iframe></div>`;
}

// ===== IQ TEST PAGE (with pagination: 2 rows x 6 columns = 12 per page) =====
async function renderIQTest(page) {
  const ct = document.getElementById('page-content');
  ct.innerHTML = `<div class="flex items-center justify-center h-64"><div class="w-10 h-10 border-3 border-primary-500 border-t-transparent rounded-full animate-spin"></div></div>`;
  const currentPage = page || store.iqPage || 1;
  const pageSize = 12; // 2 rows x 6 columns

  const [pagedResp, statsResp] = await Promise.all([
    api.get(`/iq-tests-paged?page=${currentPage}&pageSize=${pageSize}`),
    api.get('/iq-tests/stats')
  ]);
  const pagedData = pagedResp.data || {};
  const tests = pagedData.list || [];
  const total = pagedData.total || 0;
  const totalPages = pagedData.totalPages || 1;
  store.iqPage = currentPage;
  store.iqTotalPages = totalPages;

  const stats = statsResp.data || [];
  const tiers = ['lite', 'standard', 'ultra'];

  const tierStats = {};
  stats.forEach(s => {
    if (!tierStats[s.tier]) tierStats[s.tier] = { pass: 0, works: 0, degraded: 0, total: 0 };
    tierStats[s.tier][s.result] = (tierStats[s.tier][s.result] || 0) + s.count;
    tierStats[s.tier].total += s.count;
  });

  const loggedIn = isLoggedIn();

  let html = `<div class="flex flex-wrap items-center justify-between gap-4 mb-6">
    <div><h2 class="text-lg font-semibold ${cls.text()}"><i class="fas fa-brain mr-2 text-primary-500"></i>智力检测 · 鹈鹕骑行</h2><p class="${cls.textSub()} text-xs mt-1">Codex Candy Eval + Pelican Bicycle · 每3小时轮转 Lite → Standard → Ultra</p></div>
    <div class="flex gap-2">`;

  if (loggedIn) {
    html += `<button onclick="runIQTestForTier('lite')" class="${cls.btn()} text-xs !py-2"><i class="fas fa-play mr-1"></i>Lite</button>
      <button onclick="runIQTestForTier('standard')" class="${cls.btn()} text-xs !py-2"><i class="fas fa-play mr-1"></i>Standard</button>
      <button onclick="runIQTestForTier('ultra')" class="${cls.btn()} text-xs !py-2"><i class="fas fa-play mr-1"></i>Ultra</button>`;
  } else {
    html += `<button onclick="requireLogin('检测')" class="${cls.btnDisabled()} text-xs !py-2"><i class="fas fa-play mr-1"></i>Lite 🔒</button>
      <button onclick="requireLogin('检测')" class="${cls.btnDisabled()} text-xs !py-2"><i class="fas fa-play mr-1"></i>Standard 🔒</button>
      <button onclick="requireLogin('检测')" class="${cls.btnDisabled()} text-xs !py-2"><i class="fas fa-play mr-1"></i>Ultra 🔒</button>`;
  }
  html += `</div></div>`;

  // Summary stats bar
  html += `<div class="grid grid-cols-3 gap-3 mb-6">${tiers.map(tier => {
    const st = tierStats[tier] || { pass: 0, works: 0, degraded: 0, total: 0 };
    const rate = st.total > 0 ? Math.round(st.pass / st.total * 100) : 0;
    const nextRun = getNextRunTime(tier);
    return `<div class="${cls.card()} p-3 fade-in"><div class="flex items-center justify-between mb-2">${tierBadge(tier)}<span class="text-lg font-bold ${rate >= 80 ? 'text-emerald-500' : rate >= 50 ? 'text-amber-500' : 'text-red-500'}">${rate}%</span></div>
    <div class="flex gap-3 text-[11px] ${cls.textSub()} mb-1"><span>通过 ${st.pass}</span><span>可疑 ${st.works}</span><span>降智 ${st.degraded}</span></div>
    <div class="h-1.5 rounded-full overflow-hidden flex ${isDark()?'bg-slate-700':'bg-gray-100'}"><div class="bg-emerald-500 h-full" style="width:${st.total>0?(st.pass/st.total*100):0}%"></div><div class="bg-amber-500 h-full" style="width:${st.total>0?(st.works/st.total*100):0}%"></div></div>
    <div class="text-[10px] ${cls.textMuted()} mt-1.5"><i class="fas fa-clock mr-1"></i>下次: ${nextRun}</div></div>`;
  }).join('')}</div>`;

  // Store SVG data for modal access
  window.__iqTestSVGs = window.__iqTestSVGs || {};

  // Grid cards - 2 rows x 6 columns = 12 per page
  if (tests.length === 0 && currentPage === 1) {
    html += `<div class="text-center py-16 fade-in"><div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500/20 to-primary-600/20 flex items-center justify-center mx-auto mb-3"><i class="fas fa-bicycle text-2xl text-primary-500"></i></div><p class="${cls.text()} font-semibold">尚无检测记录</p><p class="${cls.textSub()} text-sm mt-1">点击上方按钮开始鹈鹕骑行智力检测</p></div>`;
  } else {
    html += `<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">`;
    tests.forEach((t, idx) => {
      const hasSvg = t.svg_code && t.svg_code.length > 50 && t.svg_code.includes('<svg');
      const hasImg = !hasSvg && t.image_url && t.image_url.length > 10;
      const hasVisual = hasSvg || hasImg;
      const resultColor = t.result === 'pass' ? 'from-emerald-500 to-emerald-600' : t.result === 'works' ? 'from-amber-500 to-amber-600' : 'from-red-500 to-red-600';
      const resultText = t.result === 'pass' ? '智力通过' : t.result === 'works' ? '可疑作品' : '降智记录';
      const timeStr = fmtTime(t.tested_at);
      const elapsed = (t.response_time_ms / 1000).toFixed(1);
      const accountId = genAccountId(t.id, t.tested_at);

      if (hasSvg) window.__iqTestSVGs[t.id] = t.svg_code;
      let cardSvg = '';
      if (hasSvg) cardSvg = scopeSvgForCard(t.svg_code, t.id);

      html += `<div class="${cls.card()} overflow-hidden fade-in group cursor-pointer" onclick="showPelicanModal(${t.id})">
        <div class="flex items-center justify-between px-2.5 py-1.5 text-[10px] ${isDark()?'bg-slate-700/50 text-slate-400':'bg-gray-50/80 text-gray-500'} border-b ${isDark()?'border-slate-700/50':'border-gray-100'}">
          <span class="font-mono truncate">账号 ID: ${accountId}</span>
          <span class="ml-1 flex-shrink-0">${timeStr}</span>
        </div>
        <div class="relative ${isDark()?'bg-slate-900':'bg-gray-100'} overflow-hidden" style="aspect-ratio:${hasSvg ? '8/5' : '1/1'}">
          ${hasSvg
            ? `<div class="w-full h-full">${cardSvg}</div>`
            : hasImg
              ? `<img src="${t.image_url}" alt="鹈鹕骑行" class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy">`
              : `<div class="w-full h-full flex flex-col items-center justify-center gap-2"><i class="fas fa-bicycle text-3xl ${cls.textMuted()}"></i><span class="text-xs ${cls.textMuted()}">无结果图</span></div>`}
          <div class="absolute top-1.5 right-1.5"><span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-white bg-gradient-to-r ${resultColor} shadow-md"><span class="w-1.5 h-1.5 rounded-full bg-white/80 inline-block"></span>${resultText}</span></div>
          ${hasVisual ? `<div class="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all duration-300 flex items-end justify-center pb-4 opacity-0 group-hover:opacity-100"><span class="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-gray-800/80 backdrop-blur-sm flex items-center gap-1.5 shadow-lg"><span>放大动画</span><i class="fas fa-arrow-up-right-from-square text-[10px]"></i></span></div>` : ''}
        </div>
        <div class="px-2.5 py-2 flex items-center justify-between">
          <div class="flex items-center gap-1.5 min-w-0"><span class="font-mono text-[11px] ${cls.text()} truncate">${t.model}</span>${tierBadge(t.tier)}</div>
          <span class="font-mono text-[11px] ${cls.textSub()} flex-shrink-0 ml-1">${elapsed} 秒</span>
        </div>
      </div>`;
    });
    html += `</div>`;

    // Pagination controls
    if (totalPages > 1) {
      html += renderPagination(currentPage, totalPages, total);
    }
  }
  window.__iqTests = tests;
  ct.innerHTML = html;
}

function renderPagination(currentPage, totalPages, total) {
  const d = isDark();
  const btnBase = `px-3 py-2 rounded-lg text-sm font-medium transition-all`;
  const btnActive = `${btnBase} bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-sm`;
  const btnNormal = `${btnBase} ${d ? 'text-slate-300 hover:bg-slate-700 border border-slate-600' : 'text-gray-700 hover:bg-gray-100 border border-gray-300'}`;
  const btnDisabledCls = `${btnBase} ${d ? 'text-slate-600 border border-slate-700 cursor-not-allowed' : 'text-gray-300 border border-gray-200 cursor-not-allowed'}`;

  let pages = [];
  // Always show first page
  pages.push(1);
  // Show pages around current
  let start = Math.max(2, currentPage - 2);
  let end = Math.min(totalPages - 1, currentPage + 2);
  if (start > 2) pages.push('...');
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < totalPages - 1) pages.push('...');
  // Always show last page
  if (totalPages > 1) pages.push(totalPages);

  let html = `<div class="flex items-center justify-center gap-2 mt-8 mb-4 flex-wrap">`;

  // First page button
  html += `<button onclick="goIQPage(1)" ${currentPage === 1 ? 'disabled' : ''} class="${currentPage === 1 ? btnDisabledCls : btnNormal}" title="首页"><i class="fas fa-angles-left text-xs"></i></button>`;

  // Previous button
  html += `<button onclick="goIQPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''} class="${currentPage === 1 ? btnDisabledCls : btnNormal}" title="上一页"><i class="fas fa-angle-left text-xs"></i></button>`;

  // Page numbers
  for (const p of pages) {
    if (p === '...') {
      html += `<span class="px-2 py-2 text-sm ${cls.textMuted()}">…</span>`;
    } else {
      html += `<button onclick="goIQPage(${p})" class="${p === currentPage ? btnActive : btnNormal}">${p}</button>`;
    }
  }

  // Next button
  html += `<button onclick="goIQPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''} class="${currentPage === totalPages ? btnDisabledCls : btnNormal}" title="下一页"><i class="fas fa-angle-right text-xs"></i></button>`;

  // Last page button
  html += `<button onclick="goIQPage(${totalPages})" ${currentPage === totalPages ? 'disabled' : ''} class="${currentPage === totalPages ? btnDisabledCls : btnNormal}" title="尾页"><i class="fas fa-angles-right text-xs"></i></button>`;

  // Page jump input
  html += `<div class="flex items-center gap-2 ml-4">
    <span class="${cls.textSub()} text-sm">跳至</span>
    <input id="iq-page-jump" type="number" min="1" max="${totalPages}" value="${currentPage}" class="${cls.input()} !w-16 !py-1.5 text-center" onkeydown="if(event.key==='Enter')jumpIQPage()">
    <span class="${cls.textSub()} text-sm">页</span>
    <button onclick="jumpIQPage()" class="${btnNormal} !px-3 !py-1.5">GO</button>
  </div>`;

  // Total info
  html += `<span class="${cls.textMuted()} text-xs ml-3">共 ${total} 条 / ${totalPages} 页</span>`;
  html += `</div>`;
  return html;
}

window.goIQPage = function(page) {
  if (page < 1) page = 1;
  if (page > store.iqTotalPages) page = store.iqTotalPages;
  store.iqPage = page;
  renderIQTest(page);
};

window.jumpIQPage = function() {
  const input = document.getElementById('iq-page-jump');
  if (!input) return;
  let page = parseInt(input.value);
  if (isNaN(page) || page < 1) page = 1;
  if (page > store.iqTotalPages) page = store.iqTotalPages;
  goIQPage(page);
};

function getNextRunTime(tier) {
  const tiers = ['lite', 'standard', 'ultra'];
  const now = new Date();
  const h = now.getHours();
  const idx = tiers.indexOf(tier);
  const nextH = Math.ceil((h + 1) / 3) * 3 + idx;
  const next = new Date(now); next.setHours(nextH > 23 ? nextH - 24 : nextH, 0, 0, 0);
  if (next <= now) next.setHours(next.getHours() + 3);
  const diff = next - now;
  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  return `${next.toTimeString().substring(0, 5)} · ${mins}分${secs}秒后`;
}

window.runIQTestForTier = async function(tier) {
  if (!requireLogin('检测')) return;
  toast(`正在为 ${tierLabel(tier)} 分组运行鹈鹕骑行检测...`, 'info', 10000);
  const models = ['gpt-5.6-sol', 'gpt-6-astra'];
  for (const model of models) {
    try {
      const resp = await api.post('/run-iq-test', { model, tier, provider: 'openai' });
      if (resp.code === 0) {
        const r = resp.data;
        const label = r.result === 'pass' ? '智力通过' : r.result === 'works' ? '可疑作品' : '降智记录';
        toast(`${model} [${tierLabel(tier)}]: ${label} (${(r.responseTime/1000).toFixed(1)}s)${r.svgCode ? ' · 已生成SVG动画' : ''}`, r.result === 'pass' ? 'success' : r.result === 'works' ? 'warning' : 'error', 6000);
      } else { toast(`${model} [${tierLabel(tier)}]: ${resp.message}`, 'error'); }
    } catch (e) { toast(`${model} 测试出错: ${e.message}`, 'error'); }
  }
  renderIQTest(1);
};

// ===== ADMIN SETTINGS PAGE =====
async function renderAdminSettings() {
  const ct = document.getElementById('page-content');
  if (!store.token) { ct.innerHTML = renderLoginForm(); return; }

  ct.innerHTML = `<div class="flex items-center justify-center h-64"><div class="w-10 h-10 border-3 border-primary-500 border-t-transparent rounded-full animate-spin"></div></div>`;
  const { data: configs } = await api.get('/admin/configs');

  const providers = ['openai', 'anthropic'];
  const tiers = ['lite', 'standard', 'ultra'];
  const providerLabels = { openai: 'OpenAI', anthropic: 'Anthropic' };
  const providerIcons = { openai: 'fa-bolt', anthropic: 'fa-star' };
  const providerColors = { openai: 'from-emerald-500 to-teal-600', anthropic: 'from-orange-500 to-red-500' };

  const configMap = {};
  (configs || []).forEach(c => { configMap[`${c.provider}_${c.tier}`] = c; });

  let html = `<div class="flex items-center justify-between mb-6">
    <div><h2 class="text-lg font-semibold ${cls.text()}"><i class="fas fa-key mr-2 text-primary-500"></i>API 密钥管理</h2><p class="${cls.textSub()} text-xs mt-1">配置各 Provider 各分组的 New API 令牌密钥</p></div>
    <div class="flex gap-2">
      <button onclick="doInitSeed()" class="${cls.btnSec()} text-xs"><i class="fas fa-database mr-1"></i>初始化数据</button>
      <button onclick="store.logout()" class="${cls.btnSec()} text-xs"><i class="fas fa-sign-out-alt mr-1"></i>退出</button>
    </div></div>`;

  for (const provider of providers) {
    html += `<div class="mb-8 fade-in"><div class="flex items-center gap-3 mb-4"><div class="w-8 h-8 rounded-lg bg-gradient-to-br ${providerColors[provider]} flex items-center justify-center"><i class="fas ${providerIcons[provider]} text-white text-sm"></i></div><h3 class="text-sm font-semibold ${cls.text()}">${providerLabels[provider]}</h3></div>
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">`;

    for (const tier of tiers) {
      const key = `${provider}_${tier}`;
      const existing = configMap[key];
      let existingKey = '', existingUrl = '';
      if (existing) {
        try { const j = JSON.parse(existing.config_json); existingKey = j.key || ''; existingUrl = j.url || ''; } catch {}
      }

      html += `<div class="${cls.card()} overflow-hidden">
        <div class="h-1 bg-gradient-to-r ${tierColor(tier)}"></div>
        <div class="p-4">
          <div class="flex items-center justify-between mb-3">
            ${tierBadge(tier)}
            ${existing ? `<span class="flex items-center gap-1 text-xs ${isDark()?'text-emerald-400':'text-emerald-600'}"><i class="fas fa-check-circle"></i>已配置</span>` : `<span class="text-xs ${cls.textMuted()}"><i class="fas fa-circle-xmark mr-1"></i>未配置</span>`}
          </div>
          <div class="space-y-2">
            <div>
              <label class="text-xs ${cls.textSub()} mb-1 block font-medium">API URL</label>
              <input id="url_${key}" type="text" value="${existingUrl}" placeholder="https://api.icloud99.cn" class="${cls.input()} w-full text-xs">
            </div>
            <div>
              <label class="text-xs ${cls.textSub()} mb-1 block font-medium">API Key</label>
              <input id="key_${key}" type="password" value="${existingKey}" placeholder="sk-xxxxxxxxxx" class="${cls.input()} w-full text-xs font-mono">
            </div>
          </div>
          <div class="flex gap-2 mt-3">
            <button onclick="saveConfig('${provider}','${tier}')" class="${cls.btn()} text-xs flex-1 !py-2"><i class="fas fa-save mr-1"></i>保存</button>
            ${existing ? `<button onclick="confirmDeleteConfig(${existing.id},'${providerLabels[provider]} ${tierLabel(tier)}')" class="px-3 py-2 rounded-lg text-xs text-red-500 border ${isDark()?'border-slate-600 hover:bg-red-900/20':'border-gray-300 hover:bg-red-50'}"><i class="fas fa-trash"></i></button>` : ''}
          </div>
        </div></div>`;
    }
    html += `</div></div>`;
  }

  // Password Change Section
  html += `<div class="mb-8 fade-in"><div class="flex items-center gap-3 mb-4"><div class="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center"><i class="fas fa-lock text-white text-sm"></i></div><h3 class="text-sm font-semibold ${cls.text()}">安全设置</h3></div>
    <div class="${cls.card()} overflow-hidden"><div class="h-1 bg-gradient-to-r from-primary-500 to-primary-600"></div><div class="p-5">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div><label class="text-xs ${cls.textSub()} mb-1.5 block font-medium"><i class="fas fa-key mr-1"></i>当前密码</label>
          <div class="relative"><input id="pw-current" type="password" placeholder="输入当前密码" class="${cls.input()} w-full pr-9"><button onclick="togglePw('pw-current')" class="absolute right-2 top-1/2 -translate-y-1/2 p-1 ${cls.textMuted()} hover:${cls.text()}"><i class="fas fa-eye text-xs"></i></button></div></div>
        <div><label class="text-xs ${cls.textSub()} mb-1.5 block font-medium"><i class="fas fa-lock-open mr-1"></i>新密码</label>
          <div class="relative"><input id="pw-new" type="password" placeholder="至少6位新密码" class="${cls.input()} w-full pr-9"><button onclick="togglePw('pw-new')" class="absolute right-2 top-1/2 -translate-y-1/2 p-1 ${cls.textMuted()} hover:${cls.text()}"><i class="fas fa-eye text-xs"></i></button></div></div>
        <div><label class="text-xs ${cls.textSub()} mb-1.5 block font-medium"><i class="fas fa-check-double mr-1"></i>确认新密码</label>
          <div class="relative"><input id="pw-confirm" type="password" placeholder="再次输入新密码" class="${cls.input()} w-full pr-9"><button onclick="togglePw('pw-confirm')" class="absolute right-2 top-1/2 -translate-y-1/2 p-1 ${cls.textMuted()} hover:${cls.text()}"><i class="fas fa-eye text-xs"></i></button></div></div>
      </div>
      <div class="mt-4 flex items-center justify-between">
        <p class="${cls.textMuted()} text-xs"><i class="fas fa-info-circle mr-1"></i>修改密码后需要重新登录</p>
        <button onclick="doChangePassword()" class="${cls.btn()} text-xs"><i class="fas fa-save mr-1"></i>修改密码</button>
      </div>
    </div></div></div>`;

  ct.innerHTML = html;
}

function renderLoginForm() {
  return `<div class="flex items-center justify-center min-h-[60vh] fade-in"><div class="${cls.card()} p-8 w-full max-w-md overflow-hidden"><div class="h-1 bg-gradient-to-r from-primary-500 via-primary-400 to-primary-600 -mx-8 -mt-8 mb-6"></div>
    <div class="text-center mb-6"><div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center mx-auto mb-4 shadow-lg"><i class="fas fa-shield-alt text-2xl text-white"></i></div><h2 class="text-lg font-semibold ${cls.text()}">管理员登录</h2><p class="${cls.textSub()} text-xs mt-1">请输入凭据以管理系统配置</p></div>
    <div class="space-y-4"><div><label class="text-xs font-medium ${cls.textSub()} mb-1.5 block">用户名</label><div class="relative"><i class="fas fa-user absolute left-3 top-1/2 -translate-y-1/2 text-xs ${cls.textMuted()}"></i><input id="login-user" type="text" value="admin" class="${cls.input()} w-full pl-9" placeholder="admin"></div></div>
    <div><label class="text-xs font-medium ${cls.textSub()} mb-1.5 block">密码</label><div class="relative"><i class="fas fa-lock absolute left-3 top-1/2 -translate-y-1/2 text-xs ${cls.textMuted()}"></i><input id="login-pass" type="password" class="${cls.input()} w-full pl-9" placeholder="请输入密码" onkeydown="if(event.key==='Enter')doLogin()"></div></div>
    <button onclick="doLogin()" class="${cls.btn()} w-full"><i class="fas fa-sign-in-alt mr-2"></i>登录</button></div></div></div>`;
}

window.doLogin = async function() {
  const u = document.getElementById('login-user').value, p = document.getElementById('login-pass').value;
  if (!u || !p) { toast('请输入用户名和密码', 'warning'); return; }
  const resp = await api.post('/login', { username: u, password: p });
  if (resp.code === 0) { store.setToken(resp.data.token); store.user = resp.data.user; toast('登录成功！', 'success'); renderAdminSettings(); }
  else toast(resp.message || '登录失败', 'error');
};

window.saveConfig = async function(provider, tier) {
  const key = document.getElementById(`key_${provider}_${tier}`).value.trim();
  const url = document.getElementById(`url_${provider}_${tier}`).value.trim();
  if (!key || !url) { toast('请填写完整的 API URL 和 Key', 'warning'); return; }
  if (!url.startsWith('http')) { toast('URL 必须以 http:// 或 https:// 开头', 'warning'); return; }
  const resp = await api.post('/admin/configs', { provider, tier, key, url });
  if (resp.code === 0) { toast(`${provider} / ${tierLabel(tier)} 配置保存成功！`, 'success'); renderAdminSettings(); }
  else toast(resp.message, 'error');
};

window.confirmDeleteConfig = function(id, name) {
  showModal('确认删除', `<div class="flex items-center gap-3 mb-4"><div class="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center"><i class="fas fa-exclamation-triangle text-xl text-red-500"></i></div><div><p class="font-medium ${cls.text()}">删除 ${name} 的密钥配置？</p><p class="text-xs ${cls.textMuted()} mt-1">删除后该分组将无法进行检测，此操作不可撤销。</p></div></div>`,
    [{ label: '<i class="fas fa-trash mr-1"></i>确认删除', action: `doDeleteConfig(${id})`, danger: true }]);
};

window.doDeleteConfig = async function(id) {
  closeModal();
  const resp = await api.del('/admin/configs/' + id);
  if (resp.code === 0) { toast('配置已删除', 'success'); renderAdminSettings(); }
  else toast(resp.message, 'error');
};

window.doInitSeed = async function() {
  showModal('初始化数据', `<div class="space-y-3"><p>此操作将：</p><ul class="list-disc pl-5 space-y-1 text-sm"><li>配置 OpenAI 3组密钥（Lite / Standard / Ultra）</li><li>创建 24 个检测渠道（OpenAI + Anthropic 各12个）</li><li>清空现有渠道和检测数据</li></ul><p class="text-xs ${cls.textMuted()} mt-2">Anthropic 密钥需要手动配置。</p></div>`,
    [{ label: '<i class="fas fa-database mr-1"></i>确认初始化', action: 'doSeed()' }]);
};

window.doSeed = async function() {
  closeModal(); toast('正在初始化数据...', 'info');
  const resp = await api.post('/admin/seed', {});
  if (resp.code === 0) { toast(resp.message, 'success', 5000); renderAdminSettings(); }
  else toast(resp.message, 'error');
};

window.togglePw = function(id) {
  const input = document.getElementById(id);
  if (!input) return;
  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
  const btn = input.parentElement.querySelector('i');
  if (btn) btn.className = `fas ${isPassword ? 'fa-eye-slash' : 'fa-eye'} text-xs`;
};

window.doChangePassword = async function() {
  const current = document.getElementById('pw-current')?.value?.trim();
  const newPw = document.getElementById('pw-new')?.value?.trim();
  const confirm = document.getElementById('pw-confirm')?.value?.trim();
  if (!current || !newPw || !confirm) { toast('请填写所有密码字段', 'warning'); return; }
  if (newPw.length < 6) { toast('新密码至少需要6位字符', 'warning'); return; }
  if (newPw !== confirm) { toast('两次输入的新密码不一致', 'warning'); return; }
  if (current === newPw) { toast('新密码不能与当前密码相同', 'warning'); return; }
  const resp = await api.post('/admin/change-password', { currentPassword: current, newPassword: newPw });
  if (resp.code === 0) {
    toast(resp.message, 'success', 5000);
    document.getElementById('pw-current').value = '';
    document.getElementById('pw-new').value = '';
    document.getElementById('pw-confirm').value = '';
  } else { toast(resp.message || '修改失败', 'error'); }
};

// ===== Pelican Animation Preview Modal =====
window.showPelicanModal = function(testId) {
  const d = isDark();
  const tests = window.__iqTests || [];
  const t = tests.find(x => x.id === testId);
  if (!t) return;

  const hasSvg = window.__iqTestSVGs && window.__iqTestSVGs[testId];
  const hasImg = !hasSvg && t.image_url && t.image_url.length > 10;
  const statusText = t.result === 'pass' ? '智力通过' : t.result === 'works' ? '可疑作品' : '降智记录';
  const accountId = genAccountId(t.id, t.tested_at);
  const dateStr = fmtDateFull(t.tested_at);
  const tierText = tierLabel(t.tier);

  let modalSvg = '';
  if (hasSvg) {
    modalSvg = scopeSvgForCard(window.__iqTestSVGs[testId], 'modal' + testId);
  }

  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="fixed inset-0 bg-black/60 backdrop-blur-md z-[9998] flex items-center justify-center p-4 fade-in" onclick="closeModal()">
      <div class="w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden ${d ? 'bg-slate-800' : 'bg-white'}" onclick="event.stopPropagation()" style="max-height:90vh;display:flex;flex-direction:column">
        <div class="flex items-center justify-between px-5 py-3.5 border-b ${d ? 'border-slate-700' : 'border-gray-200'} flex-shrink-0">
          <h3 class="text-base font-semibold ${cls.text()}">鹈鹕骑行 · 动画预览</h3>
          <button onclick="closeModal()" class="w-8 h-8 rounded-lg flex items-center justify-center ${d ? 'hover:bg-slate-700 text-slate-400' : 'hover:bg-gray-100 text-gray-500'} transition-colors"><i class="fas fa-times text-sm"></i></button>
        </div>
        <div class="flex-1 overflow-auto">
          <div class="p-4 pb-2">
            ${hasSvg
              ? `<div class="rounded-xl overflow-hidden border ${d ? 'border-slate-700 bg-slate-900' : 'border-gray-200 bg-gray-50'}">
                  ${modalSvg}
                </div>`
              : hasImg
                ? `<div class="rounded-xl overflow-hidden border ${d ? 'border-slate-700' : 'border-gray-200'} ${d ? 'bg-slate-900' : 'bg-gray-50'}">
                    <img src="${t.image_url}" alt="鹈鹕骑行动画" class="w-full h-auto" style="max-height:60vh;object-fit:contain;display:block;margin:0 auto">
                  </div>`
                : `<div class="rounded-xl border ${d ? 'border-slate-700 bg-slate-900' : 'border-gray-200 bg-gray-50'} flex flex-col items-center justify-center py-20 gap-3">
                    <i class="fas fa-bicycle text-5xl ${cls.textMuted()}"></i>
                    <span class="${cls.textSub()} text-sm">暂无骑行动画</span>
                  </div>`}
          </div>
          <div class="px-4 pb-4">
            <div class="flex items-center justify-center flex-wrap gap-1.5 text-xs ${d ? 'text-slate-500' : 'text-gray-400'} font-mono">
              <span>账号 ID: ${accountId}</span>
              <span class="opacity-50">·</span>
              <span>${dateStr}</span>
              <span class="opacity-50">·</span>
              <span>${t.model}</span>
              <span class="opacity-50">·</span>
              <span>${tierText.toLowerCase()}</span>
              <span class="opacity-50">·</span>
              <span>${statusText}</span>
            </div>
          </div>
        </div>
      </div>
    </div>`;
};

// ===== Tooltip =====
window.showTooltip = function(event, el) {
  let tip = document.getElementById('bar-tooltip');
  if (!tip) { tip = document.createElement('div'); tip.id = 'bar-tooltip'; tip.style.cssText = 'position:fixed;pointer-events:none;z-index:9999;padding:6px 12px;border-radius:8px;font-size:11px;white-space:nowrap;transition:opacity .15s;box-shadow:0 4px 12px rgba(0,0,0,.3)'; document.body.appendChild(tip); }
  tip.style.background = isDark() ? '#1e293b' : '#111827'; tip.style.color = '#fff'; tip.style.border = isDark() ? '1px solid #334155' : '1px solid #374151';
  tip.textContent = el.dataset.tooltip; tip.style.opacity = '1';
  const r = el.getBoundingClientRect(); tip.style.left = (r.left + r.width/2 - tip.offsetWidth/2) + 'px'; tip.style.top = (r.top - 36) + 'px';
};
window.hideTooltip = function() { const t = document.getElementById('bar-tooltip'); if (t) t.style.opacity = '0'; };

// ===== TOKEN USAGE QUERY PAGE =====
const tokenUsageStore = {
  queryKey: '',
  loading: false,
  data: null,       // { token_info, logs, total_logs, model_stats, daily_stats }
  logPage: 1,
  logPageSize: 15,
  logFilter: '',     // model filter
  logSort: 'time_desc',
  activeTab: 'overview',  // overview | logs | stats
};

async function renderTokenUsage() {
  const ct = document.getElementById('page-content');
  const d = isDark();

  // If data loaded, render results; otherwise render query form
  if (tokenUsageStore.data) {
    renderTokenUsageResults(ct);
    return;
  }

  const lastKey = tokenUsageStore.queryKey || '';

  let html = `<div class="max-w-3xl mx-auto fade-in">
    <!-- Header -->
    <div class="text-center mb-8">
      <div class="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-primary-500/20 via-primary-400/10 to-cyan-500/20 mb-4 relative">
        <i class="fas fa-chart-line text-3xl text-primary-500"></i>
        <div class="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-gradient-to-r from-cyan-400 to-primary-500 flex items-center justify-center">
          <i class="fas fa-search text-[8px] text-white"></i>
        </div>
      </div>
      <h2 class="text-2xl font-bold ${cls.text()} mb-2">用量查询</h2>
      <p class="${cls.textSub()} text-sm">输入令牌 Key 查询额度、使用记录与费用统计</p>
    </div>

    <!-- Query Input Card -->
    <div class="${cls.card()} overflow-hidden">
      <div class="h-1 bg-gradient-to-r from-cyan-500 via-primary-500 to-purple-500"></div>
      <div class="p-6">
        <label class="text-xs font-semibold ${cls.textSub()} mb-2 block"><i class="fas fa-key mr-1.5 text-primary-500"></i>API 令牌 Key</label>
        <div class="flex gap-3">
          <div class="relative flex-1">
            <input id="token-key-input" type="text" value="${lastKey}" placeholder="输入 sk-xxxxxxxxx 格式的令牌密钥"
              class="${cls.input()} w-full pl-10 pr-4 !py-3 font-mono text-sm"
              onkeydown="if(event.key==='Enter')doTokenQuery()">
            <i class="fas fa-fingerprint absolute left-3 top-1/2 -translate-y-1/2 text-sm ${cls.textMuted()}"></i>
          </div>
          <button onclick="doTokenQuery()" class="px-6 py-3 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-primary-500 via-primary-600 to-purple-600 hover:from-primary-600 hover:via-primary-700 hover:to-purple-700 shadow-lg shadow-primary-500/20 transition-all hover:shadow-xl hover:shadow-primary-500/30 hover:-translate-y-0.5 flex items-center gap-2">
            <i class="fas fa-bolt"></i>查询
          </button>
        </div>
        <div class="flex items-center gap-4 mt-3 ${cls.textMuted()} text-xs">
          <span><i class="fas fa-shield-alt mr-1"></i>令牌信息仅用于查询，不会存储</span>
          <span><i class="fas fa-server mr-1"></i>数据来源: New API</span>
        </div>
      </div>
    </div>

    <!-- Info Section -->
    <div class="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div class="${cls.card()} p-4 flex items-start gap-3">
        <div class="w-9 h-9 rounded-lg bg-cyan-500/10 flex items-center justify-center flex-shrink-0"><i class="fas fa-wallet text-cyan-500 text-sm"></i></div>
        <div><h4 class="text-xs font-semibold ${cls.text()} mb-0.5">额度查询</h4><p class="${cls.textMuted()} text-[11px]">查看总额度、已用、剩余</p></div>
      </div>
      <div class="${cls.card()} p-4 flex items-start gap-3">
        <div class="w-9 h-9 rounded-lg bg-purple-500/10 flex items-center justify-center flex-shrink-0"><i class="fas fa-list-alt text-purple-500 text-sm"></i></div>
        <div><h4 class="text-xs font-semibold ${cls.text()} mb-0.5">调用日志</h4><p class="${cls.textMuted()} text-[11px]">详细使用记录及费用明细</p></div>
      </div>
      <div class="${cls.card()} p-4 flex items-start gap-3">
        <div class="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0"><i class="fas fa-chart-pie text-amber-500 text-sm"></i></div>
        <div><h4 class="text-xs font-semibold ${cls.text()} mb-0.5">用量统计</h4><p class="${cls.textMuted()} text-[11px]">按模型、日期维度分析用量</p></div>
      </div>
    </div>
  </div>`;

  ct.innerHTML = html;
}

window.doTokenQuery = async function() {
  const input = document.getElementById('token-key-input');
  if (!input) return;
  const key = input.value.trim();
  if (!key) { toast('请输入令牌 Key', 'warning'); return; }

  tokenUsageStore.queryKey = key;
  tokenUsageStore.loading = true;
  tokenUsageStore.data = null;
  tokenUsageStore.logPage = 1;
  tokenUsageStore.logFilter = '';
  tokenUsageStore.activeTab = 'overview';

  const ct = document.getElementById('page-content');
  ct.innerHTML = `<div class="flex flex-col items-center justify-center h-64 fade-in">
    <div class="relative w-16 h-16 mb-4">
      <div class="absolute inset-0 rounded-full border-2 border-primary-500/30 animate-ping"></div>
      <div class="absolute inset-2 rounded-full border-2 border-primary-500 border-t-transparent animate-spin"></div>
      <div class="absolute inset-0 flex items-center justify-center"><i class="fas fa-database text-primary-500"></i></div>
    </div>
    <p class="${cls.text()} text-sm font-medium">正在查询令牌用量...</p>
    <p class="${cls.textMuted()} text-xs mt-1">连接 New API 服务器获取数据</p>
  </div>`;

  try {
    const resp = await api.post('/token-usage/query', { key });
    tokenUsageStore.loading = false;
    if (resp.code === 0) {
      tokenUsageStore.data = resp.data;
      renderTokenUsageResults(ct);
    } else {
      toast(resp.message || '查询失败', 'error');
      tokenUsageStore.data = null;
      renderTokenUsage();
    }
  } catch (e) {
    tokenUsageStore.loading = false;
    toast('查询失败: ' + e.message, 'error');
    renderTokenUsage();
  }
};

function renderTokenUsageResults(ct) {
  const d = isDark();
  const data = tokenUsageStore.data;
  if (!data) return;

  const info = data.token_info;
  const logs = data.logs || [];
  const modelStats = data.model_stats || {};
  const dailyStats = data.daily_stats || {};
  const tab = tokenUsageStore.activeTab;

  // Quota calculations (New API uses internal units, 1 USD = 500000)
  const QUOTA_PER_DOLLAR = 500000;
  const totalGranted = info.total_granted || 0;
  const totalUsed = info.total_used || 0;
  const totalAvailable = info.total_available || 0;
  const usedPercent = totalGranted > 0 ? ((totalUsed / totalGranted) * 100).toFixed(1) : '0';
  const fmtQuota = (q) => {
    const dollars = q / QUOTA_PER_DOLLAR;
    if (dollars >= 1000) return '$' + (dollars / 1000).toFixed(2) + 'K';
    return '$' + dollars.toFixed(2);
  };
  const fmtQuotaCNY = (q) => {
    const usd = q / QUOTA_PER_DOLLAR;
    const cny = usd * 7.2; // approx rate
    if (cny >= 1000) return '¥' + (cny / 1000).toFixed(2) + 'K';
    return '¥' + cny.toFixed(2);
  };

  // Token expire
  let expireText = '永不过期';
  if (info.expires_at && info.expires_at > 0) {
    const expDate = new Date(info.expires_at * 1000);
    expireText = expDate.toLocaleDateString('zh-CN') + ' ' + expDate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  // Tab styles
  const tabCls = (t) => {
    if (t === tab) return `px-4 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-primary-500 to-primary-600 shadow-sm transition-all`;
    return `px-4 py-2 rounded-lg text-sm font-medium ${d ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/60' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'} transition-all cursor-pointer`;
  };

  let html = '';

  // Back button + header
  html += `<div class="flex items-center justify-between mb-5 fade-in">
    <div class="flex items-center gap-3">
      <button onclick="tokenUsageStore.data=null;renderTokenUsage()" class="w-9 h-9 rounded-lg flex items-center justify-center ${d ? 'hover:bg-slate-700 text-slate-400 border border-slate-700' : 'hover:bg-gray-100 text-gray-500 border border-gray-200'} transition-colors"><i class="fas fa-arrow-left text-sm"></i></button>
      <div><h2 class="text-lg font-semibold ${cls.text()}"><i class="fas fa-chart-line mr-2 text-primary-500"></i>用量查询结果</h2>
      <p class="${cls.textMuted()} text-xs mt-0.5">令牌: <span class="font-mono">${info.name || 'Unknown'}</span> · <span class="font-mono">${tokenUsageStore.queryKey.substring(0, 12)}...${tokenUsageStore.queryKey.slice(-4)}</span></p></div>
    </div>
    <button onclick="doTokenQuery()" class="${cls.btnSec()} text-xs"><i class="fas fa-sync-alt mr-1"></i>刷新</button>
  </div>`;

  // Overview cards - always visible
  html += `<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5 fade-in">`;

  // Card: Total Granted
  html += `<div class="${cls.card()} overflow-hidden group hover:border-cyan-500/40 transition-all">
    <div class="h-0.5 bg-gradient-to-r from-cyan-400 to-cyan-600"></div>
    <div class="p-4">
      <div class="flex items-center justify-between mb-2"><span class="${cls.textMuted()} text-xs font-medium">总额度</span><div class="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center group-hover:bg-cyan-500/20 transition-colors"><i class="fas fa-coins text-cyan-500 text-sm"></i></div></div>
      <div class="text-xl font-bold ${cls.text()} font-mono">${info.unlimited_quota ? '∞' : fmtQuota(totalGranted)}</div>
      <div class="${cls.textMuted()} text-[11px] mt-1 font-mono">${info.unlimited_quota ? '无限额度' : fmtQuotaCNY(totalGranted)}</div>
    </div></div>`;

  // Card: Used
  html += `<div class="${cls.card()} overflow-hidden group hover:border-purple-500/40 transition-all">
    <div class="h-0.5 bg-gradient-to-r from-purple-400 to-purple-600"></div>
    <div class="p-4">
      <div class="flex items-center justify-between mb-2"><span class="${cls.textMuted()} text-xs font-medium">已使用</span><div class="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center group-hover:bg-purple-500/20 transition-colors"><i class="fas fa-fire text-purple-500 text-sm"></i></div></div>
      <div class="text-xl font-bold ${cls.text()} font-mono">${fmtQuota(totalUsed)}</div>
      <div class="${cls.textMuted()} text-[11px] mt-1 font-mono">${fmtQuotaCNY(totalUsed)} · ${usedPercent}%</div>
    </div></div>`;

  // Card: Remaining
  const remainColor = parseFloat(usedPercent) > 90 ? 'red' : parseFloat(usedPercent) > 70 ? 'amber' : 'emerald';
  html += `<div class="${cls.card()} overflow-hidden group hover:border-${remainColor}-500/40 transition-all">
    <div class="h-0.5 bg-gradient-to-r from-${remainColor}-400 to-${remainColor}-600"></div>
    <div class="p-4">
      <div class="flex items-center justify-between mb-2"><span class="${cls.textMuted()} text-xs font-medium">剩余额度</span><div class="w-8 h-8 rounded-lg bg-${remainColor}-500/10 flex items-center justify-center group-hover:bg-${remainColor}-500/20 transition-colors"><i class="fas fa-battery-three-quarters text-${remainColor}-500 text-sm"></i></div></div>
      <div class="text-xl font-bold ${cls.text()} font-mono">${info.unlimited_quota ? '∞' : fmtQuota(totalAvailable)}</div>
      <div class="${cls.textMuted()} text-[11px] mt-1 font-mono">${info.unlimited_quota ? '无限' : fmtQuotaCNY(totalAvailable)}</div>
    </div></div>`;

  // Card: Call Count
  html += `<div class="${cls.card()} overflow-hidden group hover:border-amber-500/40 transition-all">
    <div class="h-0.5 bg-gradient-to-r from-amber-400 to-orange-500"></div>
    <div class="p-4">
      <div class="flex items-center justify-between mb-2"><span class="${cls.textMuted()} text-xs font-medium">调用次数</span><div class="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center group-hover:bg-amber-500/20 transition-colors"><i class="fas fa-bolt text-amber-500 text-sm"></i></div></div>
      <div class="text-xl font-bold ${cls.text()} font-mono">${data.total_logs.toLocaleString()}</div>
      <div class="${cls.textMuted()} text-[11px] mt-1"><i class="fas fa-clock mr-1"></i>${expireText}</div>
    </div></div>`;

  html += `</div>`;

  // Quota progress bar
  if (!info.unlimited_quota) {
    html += `<div class="${cls.card()} p-4 mb-5 fade-in">
      <div class="flex items-center justify-between mb-2"><span class="text-xs font-medium ${cls.textSub()}">额度使用进度</span><span class="text-xs font-bold font-mono ${parseFloat(usedPercent) > 90 ? 'text-red-500' : parseFloat(usedPercent) > 70 ? 'text-amber-500' : 'text-emerald-500'}">${usedPercent}%</span></div>
      <div class="h-3 rounded-full overflow-hidden ${d ? 'bg-slate-700' : 'bg-gray-100'} relative">
        <div class="h-full rounded-full bg-gradient-to-r ${parseFloat(usedPercent) > 90 ? 'from-red-500 to-red-600' : parseFloat(usedPercent) > 70 ? 'from-amber-500 to-orange-500' : 'from-emerald-400 to-cyan-500'} transition-all duration-1000 relative overflow-hidden" style="width:${Math.min(100, parseFloat(usedPercent))}%">
          <div class="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 shimmer"></div>
        </div>
      </div>
      <div class="flex justify-between mt-2 text-[11px] ${cls.textMuted()} font-mono">
        <span>已用 ${fmtQuota(totalUsed)}</span>
        <span>总计 ${fmtQuota(totalGranted)}</span>
      </div>
    </div>`;
  }

  // Tab navigation
  html += `<div class="flex items-center gap-2 mb-5 fade-in">
    <button onclick="switchTokenTab('overview')" class="${tabCls('overview')}"><i class="fas fa-chart-pie mr-1.5"></i>用量统计</button>
    <button onclick="switchTokenTab('logs')" class="${tabCls('logs')}"><i class="fas fa-list-alt mr-1.5"></i>调用日志 <span class="ml-1 px-1.5 py-0.5 rounded text-[10px] font-mono ${tab==='logs'?'bg-white/20':'opacity-60'}">${data.total_logs}</span></button>
  </div>`;

  // Tab content
  if (tab === 'overview') {
    html += renderTokenStatsTab(data, d);
  } else if (tab === 'logs') {
    html += renderTokenLogsTab(data, d);
  }

  ct.innerHTML = html;
}

window.switchTokenTab = function(tab) {
  tokenUsageStore.activeTab = tab;
  tokenUsageStore.logPage = 1;
  const ct = document.getElementById('page-content');
  renderTokenUsageResults(ct);
};

function renderTokenStatsTab(data, d) {
  const modelStats = data.model_stats || {};
  const dailyStats = data.daily_stats || {};
  const QUOTA_PER_DOLLAR = 500000;
  const fmtQ = (q) => '$' + (q / QUOTA_PER_DOLLAR).toFixed(4);
  const fmtQShort = (q) => {
    const v = q / QUOTA_PER_DOLLAR;
    return v >= 1 ? '$' + v.toFixed(2) : '$' + v.toFixed(4);
  };

  // Sort models by quota desc
  const sortedModels = Object.entries(modelStats).sort((a, b) => b[1].quota - a[1].quota);
  const maxModelQuota = sortedModels.length > 0 ? sortedModels[0][1].quota : 1;

  // Model colors
  const modelColors = ['from-cyan-400 to-cyan-600', 'from-purple-400 to-purple-600', 'from-amber-400 to-orange-500', 'from-emerald-400 to-emerald-600', 'from-pink-400 to-rose-500', 'from-blue-400 to-indigo-500', 'from-teal-400 to-teal-600', 'from-red-400 to-red-600'];
  const modelDots = ['bg-cyan-500', 'bg-purple-500', 'bg-amber-500', 'bg-emerald-500', 'bg-pink-500', 'bg-blue-500', 'bg-teal-500', 'bg-red-500'];

  let html = `<div class="space-y-5 fade-in">`;

  // Model breakdown
  html += `<div class="${cls.card()} overflow-hidden">
    <div class="px-5 py-4 border-b ${d ? 'border-slate-700' : 'border-gray-100'} flex items-center gap-2">
      <i class="fas fa-cubes text-primary-500"></i>
      <h3 class="text-sm font-semibold ${cls.text()}">模型用量分布</h3>
      <span class="${cls.textMuted()} text-xs ml-auto">${sortedModels.length} 个模型</span>
    </div>
    <div class="p-5">`;

  if (sortedModels.length === 0) {
    html += `<div class="text-center py-8"><i class="fas fa-inbox text-3xl ${cls.textMuted()} mb-2"></i><p class="${cls.textSub()} text-sm">暂无模型使用数据</p></div>`;
  } else {
    html += `<div class="space-y-4">`;
    sortedModels.forEach(([model, stats], idx) => {
      const pct = maxModelQuota > 0 ? ((stats.quota / maxModelQuota) * 100).toFixed(1) : 0;
      const colorGrad = modelColors[idx % modelColors.length];
      const dotColor = modelDots[idx % modelDots.length];
      html += `<div>
        <div class="flex items-center justify-between mb-1.5">
          <div class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full ${dotColor}"></span><span class="text-sm font-medium font-mono ${cls.text()}">${model}</span></div>
          <div class="flex items-center gap-4 text-xs ${cls.textSub()}">
            <span><i class="fas fa-hashtag mr-1 text-[10px]"></i>${stats.count} 次</span>
            <span><i class="fas fa-coins mr-1 text-[10px]"></i>${fmtQShort(stats.quota)}</span>
            <span><i class="fas fa-clock mr-1 text-[10px]"></i>~${stats.avgTime}s</span>
          </div>
        </div>
        <div class="h-2 rounded-full overflow-hidden ${d ? 'bg-slate-700' : 'bg-gray-100'}">
          <div class="h-full rounded-full bg-gradient-to-r ${colorGrad} transition-all duration-700" style="width:${pct}%"></div>
        </div>
        <div class="flex items-center justify-between mt-1 text-[10px] ${cls.textMuted()} font-mono">
          <span>Prompt: ${stats.prompt.toLocaleString()} tok · Completion: ${stats.completion.toLocaleString()} tok</span>
          <span>${pct}%</span>
        </div>
      </div>`;
    });
    html += `</div>`;
  }
  html += `</div></div>`;

  // Daily usage chart (text-based bar chart)
  const dailyEntries = Object.entries(dailyStats).sort((a, b) => a[0].localeCompare(b[0])).slice(-30);
  if (dailyEntries.length > 0) {
    const maxDailyQuota = Math.max(...dailyEntries.map(([, s]) => s.quota));
    const maxDailyCount = Math.max(...dailyEntries.map(([, s]) => s.count));

    html += `<div class="${cls.card()} overflow-hidden">
      <div class="px-5 py-4 border-b ${d ? 'border-slate-700' : 'border-gray-100'} flex items-center gap-2">
        <i class="fas fa-calendar-alt text-primary-500"></i>
        <h3 class="text-sm font-semibold ${cls.text()}">每日用量趋势</h3>
        <span class="${cls.textMuted()} text-xs ml-auto">最近 ${dailyEntries.length} 天</span>
      </div>
      <div class="p-5 overflow-x-auto scrollbar-thin">
        <div class="flex items-end gap-1" style="min-width:${Math.max(dailyEntries.length * 28, 300)}px;height:140px;">`;

    dailyEntries.forEach(([date, stats]) => {
      const barH = maxDailyQuota > 0 ? Math.max(4, (stats.quota / maxDailyQuota) * 120) : 4;
      const dayLabel = date.slice(5); // MM-DD
      html += `<div class="flex-1 flex flex-col items-center gap-1">
        <div class="w-full rounded-t px-0.5 bg-gradient-to-t from-primary-500 to-cyan-400 transition-all hover:from-primary-600 hover:to-cyan-500 cursor-pointer relative group" style="height:${barH}px;min-width:18px"
          onmouseenter="showTooltip(event,this)" onmouseleave="hideTooltip()" data-tooltip="${date} · ${stats.count}次调用 · $${(stats.quota/500000).toFixed(4)}">
        </div>
        <span class="${cls.textMuted()} text-[9px] font-mono whitespace-nowrap" style="transform:rotate(-45deg);transform-origin:center;display:block;width:36px;text-align:center">${dayLabel}</span>
      </div>`;
    });

    html += `</div>
      </div></div>`;
  }

  // Token info details
  html += `<div class="${cls.card()} overflow-hidden">
    <div class="px-5 py-4 border-b ${d ? 'border-slate-700' : 'border-gray-100'} flex items-center gap-2">
      <i class="fas fa-info-circle text-primary-500"></i>
      <h3 class="text-sm font-semibold ${cls.text()}">令牌详细信息</h3>
    </div>
    <div class="p-5">
      <div class="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
        <div><span class="${cls.textMuted()} text-xs block mb-1">令牌名称</span><span class="font-medium ${cls.text()} font-mono">${data.token_info.name || '-'}</span></div>
        <div><span class="${cls.textMuted()} text-xs block mb-1">所属用户</span><span class="font-medium ${cls.text()}">${data.logs.length > 0 ? data.logs[0].username || '-' : '-'}</span></div>
        <div><span class="${cls.textMuted()} text-xs block mb-1">所属分组</span><span class="font-medium ${cls.text()}">${data.logs.length > 0 ? data.logs[0].group || '-' : '-'}</span></div>
        <div><span class="${cls.textMuted()} text-xs block mb-1">无限额度</span><span class="font-medium ${data.token_info.unlimited_quota ? 'text-emerald-500' : cls.text()}">${data.token_info.unlimited_quota ? '是' : '否'}</span></div>
        <div><span class="${cls.textMuted()} text-xs block mb-1">模型限额</span><span class="font-medium ${cls.text()}">${data.token_info.model_limits_enabled ? '已启用' : '未启用'}</span></div>
        <div><span class="${cls.textMuted()} text-xs block mb-1">过期时间</span><span class="font-medium ${cls.text()}">${data.token_info.expires_at > 0 ? new Date(data.token_info.expires_at * 1000).toLocaleString('zh-CN') : '永不过期'}</span></div>
      </div>
      ${data.token_info.model_limits_enabled && Object.keys(data.token_info.model_limits || {}).length > 0 ? `<div class="mt-4 pt-4 border-t ${d ? 'border-slate-700' : 'border-gray-100'}"><span class="${cls.textMuted()} text-xs block mb-2">允许的模型</span><div class="flex flex-wrap gap-1.5">${Object.keys(data.token_info.model_limits).map(m => `<span class="px-2 py-1 rounded-md text-[11px] font-mono ${d ? 'bg-slate-700 text-slate-300' : 'bg-gray-100 text-gray-700'}">${m}</span>`).join('')}</div></div>` : ''}
    </div></div>`;

  html += `</div>`;
  return html;
}

function renderTokenLogsTab(data, d) {
  const QUOTA_PER_DOLLAR = 500000;
  const fmtQ = (q) => '$' + (q / QUOTA_PER_DOLLAR).toFixed(6);
  let logs = data.logs || [];

  // Model filter
  const allModels = [...new Set(logs.map(l => l.model_name).filter(Boolean))].sort();
  const filter = tokenUsageStore.logFilter;
  if (filter) {
    logs = logs.filter(l => l.model_name === filter);
  }

  // Sort
  const sort = tokenUsageStore.logSort;
  if (sort === 'time_desc') logs.sort((a, b) => b.created_at - a.created_at);
  else if (sort === 'time_asc') logs.sort((a, b) => a.created_at - b.created_at);
  else if (sort === 'cost_desc') logs.sort((a, b) => b.quota - a.quota);
  else if (sort === 'cost_asc') logs.sort((a, b) => a.quota - b.quota);

  // Pagination
  const pageSize = tokenUsageStore.logPageSize;
  const totalItems = logs.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(tokenUsageStore.logPage, totalPages);
  tokenUsageStore.logPage = page;
  const startIdx = (page - 1) * pageSize;
  const pageLogs = logs.slice(startIdx, startIdx + pageSize);

  let html = `<div class="fade-in">`;

  // Filter bar
  html += `<div class="${cls.card()} p-3 mb-4">
    <div class="flex items-center gap-3 flex-wrap">
      <div class="flex items-center gap-2">
        <span class="${cls.textMuted()} text-xs"><i class="fas fa-filter mr-1"></i>模型</span>
        <select onchange="filterTokenLogs(this.value)" class="${cls.input()} !py-1.5 text-xs !pr-8 min-w-[140px]">
          <option value="">全部模型</option>
          ${allModels.map(m => `<option value="${m}" ${m === filter ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
      </div>
      <div class="flex items-center gap-2">
        <span class="${cls.textMuted()} text-xs"><i class="fas fa-sort mr-1"></i>排序</span>
        <select onchange="sortTokenLogs(this.value)" class="${cls.input()} !py-1.5 text-xs !pr-8">
          <option value="time_desc" ${sort==='time_desc'?'selected':''}>时间倒序</option>
          <option value="time_asc" ${sort==='time_asc'?'selected':''}>时间正序</option>
          <option value="cost_desc" ${sort==='cost_desc'?'selected':''}>费用从高到低</option>
          <option value="cost_asc" ${sort==='cost_asc'?'selected':''}>费用从低到高</option>
        </select>
      </div>
      <span class="${cls.textMuted()} text-xs ml-auto">${filter ? '筛选后' : '共'} ${totalItems} 条记录</span>
    </div>
  </div>`;

  // Logs table
  html += `<div class="${cls.card()} overflow-hidden">
    <div class="overflow-x-auto scrollbar-thin">
      <table class="w-full text-sm">
        <thead><tr class="${d ? 'bg-slate-700/50' : 'bg-gray-50'} text-left">
          <th class="px-4 py-3 text-xs font-semibold ${cls.textSub()} whitespace-nowrap">时间</th>
          <th class="px-4 py-3 text-xs font-semibold ${cls.textSub()} whitespace-nowrap">模型</th>
          <th class="px-4 py-3 text-xs font-semibold ${cls.textSub()} whitespace-nowrap">Prompt</th>
          <th class="px-4 py-3 text-xs font-semibold ${cls.textSub()} whitespace-nowrap">Completion</th>
          <th class="px-4 py-3 text-xs font-semibold ${cls.textSub()} whitespace-nowrap">费用</th>
          <th class="px-4 py-3 text-xs font-semibold ${cls.textSub()} whitespace-nowrap">耗时</th>
          <th class="px-4 py-3 text-xs font-semibold ${cls.textSub()} whitespace-nowrap">分组</th>
          <th class="px-4 py-3 text-xs font-semibold ${cls.textSub()} whitespace-nowrap">详情</th>
        </tr></thead>
        <tbody>`;

  if (pageLogs.length === 0) {
    html += `<tr><td colspan="8" class="px-4 py-12 text-center ${cls.textMuted()} text-sm"><i class="fas fa-inbox text-2xl mb-2 block"></i>暂无日志记录</td></tr>`;
  } else {
    pageLogs.forEach((log, idx) => {
      const time = new Date(log.created_at * 1000);
      const timeStr = time.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const cost = fmtQ(log.quota);
      const other = log.other_parsed || {};
      const rowBg = idx % 2 === 0 ? '' : (d ? 'bg-slate-800/30' : 'bg-gray-50/50');

      html += `<tr class="${rowBg} hover:${d ? 'bg-slate-700/40' : 'bg-primary-50/30'} transition-colors">
        <td class="px-4 py-2.5 text-xs font-mono ${cls.textSub()} whitespace-nowrap">${timeStr}</td>
        <td class="px-4 py-2.5"><span class="px-2 py-0.5 rounded text-[11px] font-mono font-medium ${d ? 'bg-slate-700 text-slate-200' : 'bg-gray-100 text-gray-800'}">${log.model_name}</span></td>
        <td class="px-4 py-2.5 text-xs font-mono ${cls.text()}">${(log.prompt_tokens || 0).toLocaleString()}</td>
        <td class="px-4 py-2.5 text-xs font-mono ${cls.text()}">${(log.completion_tokens || 0).toLocaleString()}</td>
        <td class="px-4 py-2.5 text-xs font-mono font-medium ${log.quota > 50000 ? 'text-amber-500' : cls.text()}">${cost}</td>
        <td class="px-4 py-2.5 text-xs font-mono ${cls.textSub()}">${log.use_time || 0}s</td>
        <td class="px-4 py-2.5"><span class="px-1.5 py-0.5 rounded text-[10px] font-medium ${d ? 'bg-primary-500/15 text-primary-400' : 'bg-primary-50 text-primary-600'}">${log.group || '-'}</span></td>
        <td class="px-4 py-2.5"><button onclick="showLogDetail(${startIdx + idx})" class="text-xs text-primary-500 hover:text-primary-400 transition-colors"><i class="fas fa-eye mr-1"></i>查看</button></td>
      </tr>`;
    });
  }

  html += `</tbody></table></div>`;

  // Pagination for logs
  if (totalPages > 1) {
    html += renderTokenLogPagination(page, totalPages, totalItems, d);
  }

  html += `</div></div>`;
  return html;
}

function renderTokenLogPagination(currentPage, totalPages, total, d) {
  const btnBase = `px-3 py-2 rounded-lg text-sm font-medium transition-all`;
  const btnActive = `${btnBase} bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-sm`;
  const btnNormal = `${btnBase} ${d ? 'text-slate-300 hover:bg-slate-700 border border-slate-600' : 'text-gray-700 hover:bg-gray-100 border border-gray-300'}`;
  const btnDis = `${btnBase} ${d ? 'text-slate-600 border border-slate-700 cursor-not-allowed' : 'text-gray-300 border border-gray-200 cursor-not-allowed'}`;

  let pages = [1];
  let start = Math.max(2, currentPage - 2), end = Math.min(totalPages - 1, currentPage + 2);
  if (start > 2) pages.push('...');
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < totalPages - 1) pages.push('...');
  if (totalPages > 1) pages.push(totalPages);

  let html = `<div class="flex items-center justify-center gap-2 p-4 border-t ${d ? 'border-slate-700' : 'border-gray-100'} flex-wrap">`;
  html += `<button onclick="goTokenLogPage(1)" ${currentPage===1?'disabled':''} class="${currentPage===1?btnDis:btnNormal}" title="首页"><i class="fas fa-angles-left text-xs"></i></button>`;
  html += `<button onclick="goTokenLogPage(${currentPage-1})" ${currentPage===1?'disabled':''} class="${currentPage===1?btnDis:btnNormal}" title="上一页"><i class="fas fa-angle-left text-xs"></i></button>`;
  for (const p of pages) {
    if (p === '...') html += `<span class="px-2 py-2 text-sm ${cls.textMuted()}">…</span>`;
    else html += `<button onclick="goTokenLogPage(${p})" class="${p===currentPage?btnActive:btnNormal}">${p}</button>`;
  }
  html += `<button onclick="goTokenLogPage(${currentPage+1})" ${currentPage===totalPages?'disabled':''} class="${currentPage===totalPages?btnDis:btnNormal}" title="下一页"><i class="fas fa-angle-right text-xs"></i></button>`;
  html += `<button onclick="goTokenLogPage(${totalPages})" ${currentPage===totalPages?'disabled':''} class="${currentPage===totalPages?btnDis:btnNormal}" title="尾页"><i class="fas fa-angles-right text-xs"></i></button>`;
  html += `<div class="flex items-center gap-2 ml-4"><span class="${cls.textSub()} text-sm">跳至</span><input id="tl-page-jump" type="number" min="1" max="${totalPages}" value="${currentPage}" class="${cls.input()} !w-16 !py-1.5 text-center" onkeydown="if(event.key==='Enter')jumpTokenLogPage()"><span class="${cls.textSub()} text-sm">页</span><button onclick="jumpTokenLogPage()" class="${btnNormal} !px-3 !py-1.5">GO</button></div>`;
  html += `<span class="${cls.textMuted()} text-xs ml-3">共 ${total} 条 / ${totalPages} 页</span>`;
  html += `</div>`;
  return html;
}

window.goTokenLogPage = function(p) {
  if (p < 1) p = 1;
  const totalPages = Math.max(1, Math.ceil((tokenUsageStore.data?.logs?.length || 0) / tokenUsageStore.logPageSize));
  if (p > totalPages) p = totalPages;
  tokenUsageStore.logPage = p;
  const ct = document.getElementById('page-content');
  renderTokenUsageResults(ct);
};

window.jumpTokenLogPage = function() {
  const input = document.getElementById('tl-page-jump');
  if (!input) return;
  let p = parseInt(input.value);
  if (isNaN(p) || p < 1) p = 1;
  goTokenLogPage(p);
};

window.filterTokenLogs = function(model) {
  tokenUsageStore.logFilter = model;
  tokenUsageStore.logPage = 1;
  const ct = document.getElementById('page-content');
  renderTokenUsageResults(ct);
};

window.sortTokenLogs = function(sort) {
  tokenUsageStore.logSort = sort;
  tokenUsageStore.logPage = 1;
  const ct = document.getElementById('page-content');
  renderTokenUsageResults(ct);
};

// Log detail modal
window.showLogDetail = function(idx) {
  const data = tokenUsageStore.data;
  if (!data) return;

  // Apply current filter
  let logs = data.logs || [];
  if (tokenUsageStore.logFilter) {
    logs = logs.filter(l => l.model_name === tokenUsageStore.logFilter);
  }
  // Apply current sort
  const sort = tokenUsageStore.logSort;
  if (sort === 'time_desc') logs.sort((a, b) => b.created_at - a.created_at);
  else if (sort === 'time_asc') logs.sort((a, b) => a.created_at - b.created_at);
  else if (sort === 'cost_desc') logs.sort((a, b) => b.quota - a.quota);
  else if (sort === 'cost_asc') logs.sort((a, b) => a.quota - b.quota);

  const log = logs[idx];
  if (!log) return;
  const d = isDark();
  const QUOTA_PER_DOLLAR = 500000;
  const time = new Date(log.created_at * 1000);
  const other = log.other_parsed || {};

  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9998] flex items-center justify-center p-4 fade-in" onclick="closeModal()">
      <div class="w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden ${d ? 'bg-slate-800' : 'bg-white'}" onclick="event.stopPropagation()" style="max-height:85vh;display:flex;flex-direction:column">
        <div class="h-1 bg-gradient-to-r from-cyan-500 via-primary-500 to-purple-500"></div>
        <div class="flex items-center justify-between px-6 py-4 border-b ${d ? 'border-slate-700' : 'border-gray-200'} flex-shrink-0">
          <h3 class="text-base font-semibold ${cls.text()}"><i class="fas fa-file-alt mr-2 text-primary-500"></i>调用详情</h3>
          <button onclick="closeModal()" class="w-8 h-8 rounded-lg flex items-center justify-center ${d ? 'hover:bg-slate-700 text-slate-400' : 'hover:bg-gray-100 text-gray-500'} transition-colors"><i class="fas fa-times"></i></button>
        </div>
        <div class="flex-1 overflow-y-auto p-6 scrollbar-thin">
          <div class="grid grid-cols-2 gap-4 text-sm">
            <div class="space-y-3">
              <div><span class="${cls.textMuted()} text-xs block mb-0.5">时间</span><span class="font-mono ${cls.text()}">${time.toLocaleString('zh-CN')}</span></div>
              <div><span class="${cls.textMuted()} text-xs block mb-0.5">模型</span><span class="font-mono font-medium ${cls.text()}">${log.model_name}</span></div>
              <div><span class="${cls.textMuted()} text-xs block mb-0.5">用户</span><span class="${cls.text()}">${log.username || '-'}</span></div>
              <div><span class="${cls.textMuted()} text-xs block mb-0.5">令牌名称</span><span class="${cls.text()}">${log.token_name || '-'}</span></div>
              <div><span class="${cls.textMuted()} text-xs block mb-0.5">分组</span><span class="${cls.text()}">${log.group || '-'}</span></div>
            </div>
            <div class="space-y-3">
              <div><span class="${cls.textMuted()} text-xs block mb-0.5">费用</span><span class="font-mono font-bold text-amber-500">$${(log.quota / QUOTA_PER_DOLLAR).toFixed(6)}</span></div>
              <div><span class="${cls.textMuted()} text-xs block mb-0.5">Prompt Tokens</span><span class="font-mono ${cls.text()}">${(log.prompt_tokens || 0).toLocaleString()}</span></div>
              <div><span class="${cls.textMuted()} text-xs block mb-0.5">Completion Tokens</span><span class="font-mono ${cls.text()}">${(log.completion_tokens || 0).toLocaleString()}</span></div>
              <div><span class="${cls.textMuted()} text-xs block mb-0.5">耗时</span><span class="font-mono ${cls.text()}">${log.use_time || 0} 秒</span></div>
              <div><span class="${cls.textMuted()} text-xs block mb-0.5">流式</span><span class="${cls.text()}">${log.is_stream ? '是' : '否'}</span></div>
            </div>
          </div>
          ${Object.keys(other).length > 0 ? `
          <div class="mt-5 pt-5 border-t ${d ? 'border-slate-700' : 'border-gray-100'}">
            <h4 class="text-xs font-semibold ${cls.textSub()} mb-3"><i class="fas fa-cog mr-1"></i>计费参数</h4>
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
              ${other.model_ratio !== undefined ? `<div class="${d ? 'bg-slate-700/50' : 'bg-gray-50'} rounded-lg px-3 py-2"><span class="${cls.textMuted()} block mb-0.5">模型倍率</span><span class="font-mono font-medium ${cls.text()}">${other.model_ratio}</span></div>` : ''}
              ${other.completion_ratio !== undefined ? `<div class="${d ? 'bg-slate-700/50' : 'bg-gray-50'} rounded-lg px-3 py-2"><span class="${cls.textMuted()} block mb-0.5">补全倍率</span><span class="font-mono font-medium ${cls.text()}">${other.completion_ratio}</span></div>` : ''}
              ${other.group_ratio !== undefined ? `<div class="${d ? 'bg-slate-700/50' : 'bg-gray-50'} rounded-lg px-3 py-2"><span class="${cls.textMuted()} block mb-0.5">分组倍率</span><span class="font-mono font-medium ${cls.text()}">${other.group_ratio}</span></div>` : ''}
              ${other.cache_ratio !== undefined ? `<div class="${d ? 'bg-slate-700/50' : 'bg-gray-50'} rounded-lg px-3 py-2"><span class="${cls.textMuted()} block mb-0.5">缓存倍率</span><span class="font-mono font-medium ${cls.text()}">${other.cache_ratio}</span></div>` : ''}
              ${other.cache_tokens !== undefined ? `<div class="${d ? 'bg-slate-700/50' : 'bg-gray-50'} rounded-lg px-3 py-2"><span class="${cls.textMuted()} block mb-0.5">缓存Tokens</span><span class="font-mono font-medium ${cls.text()}">${other.cache_tokens}</span></div>` : ''}
              ${other.billing_source ? `<div class="${d ? 'bg-slate-700/50' : 'bg-gray-50'} rounded-lg px-3 py-2"><span class="${cls.textMuted()} block mb-0.5">计费来源</span><span class="font-mono font-medium ${cls.text()}">${other.billing_source}</span></div>` : ''}
              ${other.request_path ? `<div class="${d ? 'bg-slate-700/50' : 'bg-gray-50'} rounded-lg px-3 py-2 col-span-2 sm:col-span-3"><span class="${cls.textMuted()} block mb-0.5">请求路径</span><span class="font-mono font-medium ${cls.text()}">${other.request_path}</span></div>` : ''}
            </div>
          </div>` : ''}
          ${log.request_id ? `<div class="mt-4 pt-4 border-t ${d ? 'border-slate-700' : 'border-gray-100'}"><span class="${cls.textMuted()} text-xs">Request ID:</span> <span class="font-mono text-xs ${cls.textSub()} break-all">${log.request_id}</span></div>` : ''}
        </div>
        <div class="px-6 pb-5 pt-3 flex justify-end border-t ${d ? 'border-slate-700' : 'border-gray-100'} flex-shrink-0">
          <button onclick="closeModal()" class="px-5 py-2 rounded-lg text-sm font-medium border ${d ? 'border-slate-600 text-slate-300 hover:bg-slate-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}">关闭</button>
        </div>
      </div>
    </div>`;
};

// ===== MAIN LAYOUT =====
const MENU = [
  { id: 'token-usage', label: '用量查询', icon: 'fas fa-chart-line' },
  { id: 'channel-status', label: '渠道状态', icon: 'fas fa-satellite-dish' },
  { id: 'iq-radar', label: 'GPT智商雷达', icon: 'fas fa-crosshairs' },
  { id: 'iq-test', label: '智力检测', icon: 'fas fa-brain' },
  { id: 'admin-settings', label: '管理设置', icon: 'fas fa-cog' },
];

function render() {
  const d = isDark();
  document.getElementById('app').innerHTML = `
    <div class="flex h-screen ${d?'bg-slate-900':'bg-gray-50'}">
      <aside class="${store.sidebarOpen?'w-56':'w-0'} transition-all duration-300 flex-shrink-0 ${d?'bg-slate-800 border-slate-700':'bg-white border-gray-200'} border-r flex flex-col overflow-hidden" style="min-width:${store.sidebarOpen?'14rem':'0'}">
        <div class="p-4 flex items-center gap-3 border-b ${d?'border-slate-700':'border-gray-200'}">
          <div class="w-9 h-9 rounded-xl overflow-hidden flex-shrink-0 shadow-lg"><img src="/static/logo.png" alt="元擎智算" class="w-full h-full object-cover"></div>
          <div class="overflow-hidden"><h1 class="text-sm font-bold ${cls.text()} whitespace-nowrap">元擎智算</h1><p class="${cls.textMuted()} text-[10px] whitespace-nowrap">AI Monitoring Platform</p></div>
        </div>
        <nav class="flex-1 p-2.5 space-y-1 overflow-y-auto scrollbar-thin">
          ${MENU.map(m => `<button onclick="store.setPage('${m.id}')" class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${store.currentPage===m.id?(d?'bg-primary-600/20 text-primary-400 font-medium':'bg-primary-50 text-primary-700 font-medium'):(d?'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200':'text-gray-600 hover:bg-gray-100 hover:text-gray-800')}"><i class="${m.icon} w-4 text-center"></i><span>${m.label}</span>${m.id==='admin-settings'?`<i class="fas fa-lock text-[10px] ml-auto ${cls.textMuted()}"></i>`:''}</button>`).join('')}
        </nav>
        <div class="p-3 border-t ${d?'border-slate-700':'border-gray-200'}"><div class="flex items-center gap-2 text-[10px] ${cls.textMuted()}"><i class="fas fa-shield-alt"></i><span>New API · v2.1</span></div></div>
      </aside>
      <main class="flex-1 flex flex-col overflow-hidden">
        <header class="h-14 flex items-center justify-between px-4 border-b ${d?'bg-slate-800/80 border-slate-700':'bg-white/80 border-gray-200'} glass flex-shrink-0">
          <div class="flex items-center gap-3">
            <button onclick="store.toggleSidebar()" class="p-2 rounded-lg ${d?'hover:bg-slate-700 text-slate-400':'hover:bg-gray-100 text-gray-500'}"><i class="fas fa-bars"></i></button>
            <span class="text-sm font-medium ${cls.text()}">${MENU.find(m=>m.id===store.currentPage)?.label||''}</span>
          </div>
          <div class="flex items-center gap-2">
            <button onclick="store.setTheme(isDark()?'light':'dark')" class="w-9 h-9 rounded-lg flex items-center justify-center ${d?'hover:bg-slate-700 text-amber-400':'hover:bg-gray-100 text-gray-500'}" title="切换主题"><i class="fas fa-${d?'sun':'moon'}"></i></button>
            ${store.token?`<div class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg ${d?'bg-slate-700':'bg-gray-100'}"><i class="fas fa-user-shield text-[10px] ${cls.textMuted()}"></i><span class="text-xs ${cls.textSub()}">admin</span></div>`:''}
          </div>
        </header>
        <div id="page-content" class="flex-1 overflow-y-auto p-6 scrollbar-thin"></div>
      </main>
    </div>`;
  switch (store.currentPage) {
    case 'token-usage': renderTokenUsage(); break;
    case 'channel-status': renderChannelStatus(); break;
    case 'iq-radar': renderIQRadar(); break;
    case 'iq-test': renderIQTest(); break;
    case 'admin-settings': renderAdminSettings(); break;
  }
}

setInterval(() => { if (store.currentPage === 'channel-status') { store.chChannels = null; renderChannelStatus(); } }, 60 * 60 * 1000);
render();
