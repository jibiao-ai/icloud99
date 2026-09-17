// ===== 元擎智算可视化 v2 =====
const store = {
  theme: localStorage.getItem('theme') || 'light',
  currentPage: 'channel-status',
  token: localStorage.getItem('token') || '',
  user: null,
  sidebarOpen: window.innerWidth > 768,
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
const cls = {
  card: () => `rounded-xl border shadow-sm transition-shadow hover:shadow-md ${isDark() ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200'}`,
  text: () => isDark() ? 'text-slate-200' : 'text-gray-800',
  textSub: () => isDark() ? 'text-slate-400' : 'text-gray-500',
  textMuted: () => isDark() ? 'text-slate-500' : 'text-gray-400',
  input: () => `px-3 py-2.5 rounded-lg border text-sm transition-all ${isDark() ? 'bg-slate-700/80 border-slate-600 text-slate-200 placeholder-slate-500' : 'bg-white border-gray-300 text-gray-800 placeholder-gray-400'}`,
  btn: () => `px-4 py-2.5 rounded-lg text-sm font-medium transition-all bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white shadow-sm`,
  btnSec: () => `px-4 py-2.5 rounded-lg text-sm font-medium transition-all border ${isDark() ? 'border-slate-600 text-slate-300 hover:bg-slate-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`,
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

// ===== CHANNEL STATUS PAGE =====
async function renderChannelStatus() {
  const ct = document.getElementById('page-content');
  ct.innerHTML = `<div class="flex items-center justify-center h-64"><div class="w-10 h-10 border-3 border-primary-500 border-t-transparent rounded-full animate-spin"></div></div>`;
  const { data: channels } = await api.get('/channels?range=7');
  if (!channels || channels.length === 0) {
    ct.innerHTML = `<div class="text-center py-20 fade-in"><div class="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary-500/20 to-primary-600/20 flex items-center justify-center mx-auto mb-4"><i class="fas fa-satellite-dish text-3xl text-primary-500"></i></div><p class="${cls.text()} text-lg font-semibold">尚未配置渠道</p><p class="${cls.textSub()} text-sm mt-2 mb-6">请先登录管理员账号，初始化数据并配置API密钥</p><button onclick="store.setPage('admin-settings')" class="${cls.btn()}"><i class="fas fa-cog mr-2"></i>前往管理设置</button></div>`;
    return;
  }
  // Group by provider then tier
  const providers = ['openai', 'anthropic'];
  const tiers = ['lite', 'standard', 'ultra'];
  const providerInfo = { openai: { label: 'OpenAI', icon: '✦', color: 'text-emerald-500' }, anthropic: { label: 'Anthropic', icon: '✸', color: 'text-orange-500' } };

  const allRates = channels.map(c => c.success_rate);
  const avgRate = Math.round(allRates.reduce((a, b) => a + b, 0) / allRates.length);
  const status = avgRate >= 95 ? 'OPERATIONAL' : avgRate >= 80 ? 'DEGRADED' : 'OUTAGE';
  const sColor = status === 'OPERATIONAL' ? 'text-emerald-500 bg-emerald-500/10' : status === 'DEGRADED' ? 'text-amber-500 bg-amber-500/10' : 'text-red-500 bg-red-500/10';

  let html = `<div class="flex flex-wrap items-center justify-between gap-4 mb-6">
    <div class="flex items-center gap-3"><h2 class="text-lg font-semibold ${cls.text()}"><i class="fas fa-satellite-dish mr-2 text-primary-500"></i>渠道状态</h2><span class="${sColor} px-3 py-1 rounded-full text-xs font-bold">${status}</span></div>
    <div class="flex items-center gap-2">
      <button onclick="runChannelTests()" class="${cls.btn()} text-xs !py-2"><i class="fas fa-vial mr-1"></i>立即检测</button>
      <button onclick="renderChannelStatus()" class="px-3 py-2 rounded-lg text-xs ${isDark() ? 'bg-slate-700 text-slate-300 hover:bg-slate-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"><i class="fas fa-sync-alt"></i></button>
      <span class="${cls.textMuted()} text-xs"><i class="fas fa-clock mr-1"></i>每小时自动检测</span>
    </div></div>`;

  for (const prov of providers) {
    const info = providerInfo[prov];
    const provChannels = channels.filter(c => c.provider === prov);
    if (provChannels.length === 0) continue;

    html += `<div class="mb-8 fade-in"><div class="flex items-center gap-2 mb-4"><span class="text-lg ${info.color}">${info.icon}</span><h3 class="text-sm font-semibold ${cls.text()}">${info.label}</h3><span class="${cls.textMuted()} text-xs">${provChannels.length}个渠道</span></div>`;

    for (const tier of tiers) {
      const tierChannels = provChannels.filter(c => c.tier === tier);
      if (tierChannels.length === 0) continue;
      html += `<div class="mb-4"><div class="flex items-center gap-2 mb-3">${tierBadge(tier)}</div><div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">`;
      tierChannels.forEach(ch => { html += renderChannelCard(ch); });
      html += `</div></div>`;
    }
    html += `</div>`;
  }
  ct.innerHTML = html;
}

function renderChannelCard(ch) {
  const lt = ch.latest_test;
  const rate = ch.success_rate;
  const rateColor = rate >= 95 ? 'text-emerald-500' : rate >= 80 ? 'text-amber-500' : 'text-red-500';
  const speedLabel = lt && lt.response_time_ms > 0 ? (lt.response_time_ms < 2000 ? '极速' : lt.response_time_ms < 4000 ? '正常' : '较慢') : '未知';
  const speedDot = speedLabel === '极速' ? 'bg-emerald-400' : speedLabel === '正常' ? 'bg-blue-400' : 'bg-amber-400';
  const bars = (ch.history || []).map(h => {
    const height = h.success ? Math.max(4, Math.min(32, h.response_time / 100)) : 2;
    const color = !h.success ? '#ef4444' : h.response_time < 2000 ? '#10b981' : h.response_time < 4000 ? '#f59e0b' : '#ef4444';
    return `<div class="bar" style="height:${height}px;background:${color}" data-tooltip="${timeAgo(h.time)} · ${h.success ? '正常' : '失败'} · ${h.response_time}ms" onmouseenter="showTooltip(event,this)" onmouseleave="hideTooltip()"></div>`;
  }).join('');

  return `<div class="${cls.card()} p-4 fade-in">
    <div class="flex items-start justify-between mb-3"><div class="flex items-center gap-2"><span class="text-lg">${ch.icon||'📡'}</span><div><h4 class="text-sm font-semibold ${cls.text()}">${ch.name}</h4><p class="${cls.textMuted()} text-xs font-mono">${ch.model_id}</p></div></div>
    <span class="flex items-center gap-1 text-xs ${isDark()?'text-emerald-400':'text-emerald-600'}"><span class="w-1.5 h-1.5 rounded-full ${speedDot} pulse-dot"></span>${speedLabel}</span></div>
    <div class="flex items-end justify-between mb-3"><div class="flex gap-4 text-xs"><div><span class="${cls.textMuted()}">延迟</span> <span class="font-mono font-medium ${cls.text()}">${lt?lt.response_time_ms:'-'}ms</span></div><div><span class="${cls.textMuted()}">PING</span> <span class="font-mono font-medium ${cls.text()}">${lt?lt.ping_ms:'-'}ms</span></div></div>
    <span class="text-2xl font-bold ${rateColor}">${rate}%</span></div>
    <div class="flex items-center justify-between mb-1"><span class="${cls.textMuted()} text-xs">${ch.total_tests}次检测</span></div>
    <div class="bar-chart-mini">${bars}</div></div>`;
}

window.runChannelTests = async function() {
  toast('正在检测所有渠道...', 'info', 5000);
  const resp = await api.post('/test-channels', {});
  if (resp.code === 0) { toast(`检测完成！共 ${resp.data.length} 个渠道`, 'success'); renderChannelStatus(); }
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

// ===== IQ TEST PAGE =====
async function renderIQTest() {
  const ct = document.getElementById('page-content');
  ct.innerHTML = `<div class="flex items-center justify-center h-64"><div class="w-10 h-10 border-3 border-primary-500 border-t-transparent rounded-full animate-spin"></div></div>`;
  const [testsResp, statsResp] = await Promise.all([api.get('/iq-tests?limit=100'), api.get('/iq-tests/stats')]);
  const tests = testsResp.data || [];
  const stats = statsResp.data || [];

  const tiers = ['lite', 'standard', 'ultra'];
  const resultBadge = (r) => {
    if (r === 'pass') return `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-600"><i class="fas fa-check-circle"></i>智力通过</span>`;
    if (r === 'works') return `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-600"><i class="fas fa-exclamation-circle"></i>可疑作品</span>`;
    return `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-500/15 text-red-600"><i class="fas fa-times-circle"></i>降智记录</span>`;
  };

  // Group stats by tier
  const tierStats = {};
  stats.forEach(s => {
    if (!tierStats[s.tier]) tierStats[s.tier] = { pass: 0, works: 0, degraded: 0, total: 0 };
    tierStats[s.tier][s.result] = (tierStats[s.tier][s.result] || 0) + s.count;
    tierStats[s.tier].total += s.count;
  });

  let html = `<div class="flex flex-wrap items-center justify-between gap-4 mb-6">
    <div><h2 class="text-lg font-semibold ${cls.text()}"><i class="fas fa-brain mr-2 text-primary-500"></i>智力检测 · 鹈鹕骑行</h2><p class="${cls.textSub()} text-xs mt-1">Codex Candy Eval · 鹈鹕骑行智力测验 · 每3小时轮转检测 Lite → Standard → Ultra</p></div>
    <div class="flex gap-2">
      <button onclick="runIQTestForTier('lite')" class="${cls.btn()} text-xs !py-2"><i class="fas fa-play mr-1"></i>Lite</button>
      <button onclick="runIQTestForTier('standard')" class="${cls.btn()} text-xs !py-2"><i class="fas fa-play mr-1"></i>Standard</button>
      <button onclick="runIQTestForTier('ultra')" class="${cls.btn()} text-xs !py-2"><i class="fas fa-play mr-1"></i>Ultra</button>
    </div></div>`;

  // Per-tier cards with parrot images
  html += `<div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">`;
  for (const tier of tiers) {
    const st = tierStats[tier] || { pass: 0, works: 0, degraded: 0, total: 0 };
    const passRate = st.total > 0 ? Math.round(st.pass / st.total * 100) : 0;
    const tierTests = tests.filter(t => t.tier === tier).slice(0, 3);
    const latestTest = tierTests[0];
    const nextRun = getNextRunTime(tier);

    // Result images from latest tests - ALWAYS show all 3 slots
    const latestImages = tierTests.slice(0, 3);

    html += `<div class="${cls.card()} overflow-hidden fade-in">
      <div class="h-1.5 bg-gradient-to-r ${tierColor(tier)}"></div>
      <div class="p-4">
        <div class="flex items-center justify-between mb-3">${tierBadge(tier)}<span class="text-xl font-bold ${passRate >= 80 ? 'text-emerald-500' : passRate >= 50 ? 'text-amber-500' : 'text-red-500'}">${passRate}%</span></div>
        
        <div class="grid grid-cols-3 gap-2 mb-3">${[0,1,2].map(i => {
          const t = latestImages[i];
          if (!t) return `<div class="aspect-square rounded-lg ${isDark()?'bg-slate-700/60':'bg-gray-100'} flex flex-col items-center justify-center gap-1"><i class="fas fa-image text-xl ${cls.textMuted()}"></i><span class="text-[10px] ${cls.textMuted()}">等待检测</span></div>`;
          const hasImg = t.image_url && t.image_url.length > 5;
          const statusColor = t.result === 'pass' ? 'border-emerald-500' : t.result === 'works' ? 'border-amber-500' : 'border-red-500';
          const statusIcon = t.result === 'pass' ? 'fa-check-circle text-emerald-500' : t.result === 'works' ? 'fa-exclamation-circle text-amber-500' : 'fa-times-circle text-red-500';
          const statusText = t.result === 'pass' ? '通过' : t.result === 'works' ? '可疑' : '降智';
          if (hasImg) {
            return `<div class="relative aspect-square rounded-lg overflow-hidden border-2 ${statusColor} group cursor-pointer" onclick="showImageModal('${t.image_url.replace(/'/g, "\\'")}',' ${t.model} [${tierLabel(tier)}]','${statusText}','${t.result}')">
              <img src="${t.image_url}" alt="鹈鹕骑行结果" class="w-full h-full object-cover transition-transform group-hover:scale-105">
              <div class="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-1.5">
                <div class="flex items-center gap-1"><i class="fas ${statusIcon} text-[10px]"></i><span class="text-white text-[10px] font-medium">${statusText}</span></div>
              </div>
            </div>`;
          } else {
            return `<div class="relative aspect-square rounded-lg overflow-hidden border-2 ${statusColor} ${isDark()?'bg-slate-700/60':'bg-gray-100'} flex flex-col items-center justify-center gap-1">
              <i class="fas ${statusIcon} text-2xl"></i>
              <span class="text-[10px] font-semibold ${t.result === 'pass' ? 'text-emerald-500' : t.result === 'works' ? 'text-amber-500' : 'text-red-500'}">${statusText}</span>
              <span class="text-[9px] ${cls.textMuted()}">${t.model}</span>
              <span class="text-[9px] ${cls.textMuted()}">${fmtTime(t.tested_at)}</span>
            </div>`;
          }
        }).join('')}</div>

        <div class="space-y-2 mb-3">
          ${latestTest ? `<div class="flex items-center gap-2 text-xs"><span class="${latestTest.result === 'pass' ? 'text-emerald-500' : latestTest.result === 'works' ? 'text-amber-500' : 'text-red-500'} font-semibold">${latestTest.result === 'pass' ? '✓ 生成完成' : latestTest.result === 'works' ? '◎ 可疑作品' : '✗ 降智记录'}</span></div>
          <div class="text-xs ${cls.textSub()}">最近完成: ${fmtTime(latestTest.tested_at)} · 耗时 ${Math.round(latestTest.response_time_ms / 1000)} 秒</div>` : `<div class="text-xs ${cls.textMuted()}">暂无检测记录</div>`}
          <div class="text-xs ${cls.textMuted()}">下次运行: ${nextRun}</div>
        </div>

        <div class="flex gap-2 text-xs mb-2">
          <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-emerald-500"></span>通过 ${st.pass}</span>
          <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-amber-500"></span>可疑 ${st.works}</span>
          <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-red-500"></span>降智 ${st.degraded}</span>
        </div>
        <div class="h-2 rounded-full overflow-hidden flex ${isDark()?'bg-slate-700':'bg-gray-100'}">
          <div class="bg-emerald-500 h-full" style="width:${st.total>0?(st.pass/st.total*100):0}%"></div>
          <div class="bg-amber-500 h-full" style="width:${st.total>0?(st.works/st.total*100):0}%"></div>
          <div class="bg-red-500 h-full" style="width:${st.total>0?(st.degraded/st.total*100):0}%"></div>
        </div>
      </div></div>`;
  }
  html += `</div>`;

  // Records table
  html += `<div class="${cls.card()} overflow-hidden"><div class="p-4 border-b ${isDark()?'border-slate-700':'border-gray-200'} flex items-center justify-between"><h3 class="text-sm font-semibold ${cls.text()}"><i class="fas fa-history mr-2"></i>检测记录</h3></div>
    <div class="overflow-x-auto"><table class="w-full text-sm"><thead class="${isDark()?'bg-slate-700/50':'bg-gray-50'}"><tr>
      <th class="px-4 py-3 text-left ${cls.textSub()} font-medium text-xs">时间</th>
      <th class="px-4 py-3 text-left ${cls.textSub()} font-medium text-xs">分组</th>
      <th class="px-4 py-3 text-left ${cls.textSub()} font-medium text-xs">模型</th>
      <th class="px-4 py-3 text-left ${cls.textSub()} font-medium text-xs">结果</th>
      <th class="px-4 py-3 text-center ${cls.textSub()} font-medium text-xs">结果图</th>
      <th class="px-4 py-3 text-right ${cls.textSub()} font-medium text-xs">耗时</th>
      <th class="px-4 py-3 text-right ${cls.textSub()} font-medium text-xs">推理Token</th>
    </tr></thead><tbody class="divide-y ${isDark()?'divide-slate-700':'divide-gray-100'}">
      ${tests.slice(0, 30).map(t => `<tr class="${isDark()?'hover:bg-slate-700/30':'hover:bg-gray-50'} transition-colors">
        <td class="px-4 py-3 text-xs ${cls.textMuted()}">${timeAgo(t.tested_at)}</td>
        <td class="px-4 py-3">${tierBadge(t.tier)}</td>
        <td class="px-4 py-3 font-mono text-xs ${cls.text()}">${t.model}</td>
        <td class="px-4 py-3">${resultBadge(t.result)}</td>
        <td class="px-4 py-3 text-center">${t.image_url && t.image_url.length > 5 ? `<img src="${t.image_url}" alt="结果图" class="w-10 h-10 rounded object-cover inline-block border ${isDark()?'border-slate-600':'border-gray-200'} cursor-pointer hover:scale-110 transition-transform" onclick="showImageModal('${t.image_url.replace(/'/g, "\\\\'")}','${t.model} [${tierLabel(t.tier)}]','${t.result === 'pass' ? '通过' : t.result === 'works' ? '可疑' : '降智'}','${t.result}')">` : `<span class="${cls.textMuted()} text-xs">-</span>`}</td>
        <td class="px-4 py-3 text-right font-mono text-xs ${cls.text()}">${(t.response_time_ms/1000).toFixed(1)}s</td>
        <td class="px-4 py-3 text-right font-mono text-xs ${cls.textSub()}">${t.reasoning_tokens||'-'}</td>
      </tr>`).join('')}
    </tbody></table></div></div>`;

  ct.innerHTML = html;
}

function getNextRunTime(tier) {
  const tiers = ['lite', 'standard', 'ultra'];
  const now = new Date();
  const h = now.getHours();
  const idx = tiers.indexOf(tier);
  // Each tier runs every 3h, offset by tier index
  const nextH = Math.ceil((h + 1) / 3) * 3 + idx;
  const next = new Date(now); next.setHours(nextH > 23 ? nextH - 24 : nextH, 0, 0, 0);
  if (next <= now) next.setHours(next.getHours() + 3);
  const diff = next - now;
  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  return `${next.toTimeString().substring(0, 8)} · ${mins}分${secs}秒后`;
}

window.runIQTestForTier = async function(tier) {
  toast(`正在为 ${tierLabel(tier)} 分组运行智力检测...`, 'info', 8000);
  const models = ['gpt-5.6-sol', 'gpt-6-astra'];
  for (const model of models) {
    try {
      const resp = await api.post('/run-iq-test', { model, tier, provider: 'openai' });
      if (resp.code === 0) {
        const r = resp.data;
        toast(`${model} [${tierLabel(tier)}]: ${r.result === 'pass' ? '✓ 智力通过' : r.result === 'works' ? '◎ 可疑作品' : '✗ 降智记录'} (${(r.responseTime/1000).toFixed(1)}s)`, r.result === 'pass' ? 'success' : r.result === 'works' ? 'warning' : 'error', 5000);
      } else { toast(`${model} [${tierLabel(tier)}]: ${resp.message}`, 'error'); }
    } catch (e) { toast(`${model} 测试出错: ${e.message}`, 'error'); }
  }
  renderIQTest();
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
  showModal('初始化数据', `<div class="space-y-3"><p>此操作将：</p><ul class="list-disc pl-5 space-y-1 text-sm"><li>配置 OpenAI 3组密钥（Lite / Standard / Ultra）</li><li>创建 12 个检测渠道（OpenAI + Anthropic 各6个）</li><li>清空现有渠道和检测数据</li></ul><p class="text-xs ${cls.textMuted()} mt-2">Anthropic 密钥需要手动配置。</p></div>`,
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
    // Clear the fields
    document.getElementById('pw-current').value = '';
    document.getElementById('pw-new').value = '';
    document.getElementById('pw-confirm').value = '';
  } else { toast(resp.message || '修改失败', 'error'); }
};

// ===== Image Modal =====
window.showImageModal = function(imageUrl, modelInfo, statusText, result) {
  const d = isDark();
  const statusColor = result === 'pass' ? 'from-emerald-500 to-emerald-600' : result === 'works' ? 'from-amber-500 to-amber-600' : 'from-red-500 to-red-600';
  const statusIcon = result === 'pass' ? 'fa-check-circle' : result === 'works' ? 'fa-exclamation-circle' : 'fa-times-circle';
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="fixed inset-0 bg-black/70 backdrop-blur-sm z-[9998] flex items-center justify-center p-4 fade-in" onclick="closeModal()">
      <div class="w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden ${d ? 'bg-slate-800 border border-slate-700' : 'bg-white border-gray-200'}" onclick="event.stopPropagation()">
        <div class="h-1.5 bg-gradient-to-r ${statusColor}"></div>
        <div class="p-4">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <i class="fas ${statusIcon} text-lg ${result === 'pass' ? 'text-emerald-500' : result === 'works' ? 'text-amber-500' : 'text-red-500'}"></i>
              <div>
                <span class="text-sm font-semibold ${cls.text()}">${modelInfo}</span>
                <span class="ml-2 px-2 py-0.5 rounded-full text-[11px] font-bold text-white bg-gradient-to-r ${statusColor}">${statusText}</span>
              </div>
            </div>
            <button onclick="closeModal()" class="w-8 h-8 rounded-lg flex items-center justify-center ${d ? 'hover:bg-slate-700 text-slate-400' : 'hover:bg-gray-100 text-gray-500'}"><i class="fas fa-times"></i></button>
          </div>
          <div class="rounded-xl overflow-hidden border ${d ? 'border-slate-700' : 'border-gray-200'}">
            <img src="${imageUrl}" alt="鹈鹕骑行结果" class="w-full h-auto max-h-[60vh] object-contain ${d ? 'bg-slate-900' : 'bg-gray-50'}">
          </div>
          <p class="${cls.textMuted()} text-xs mt-2 text-center">智力检测 · 鹈鹕骑行 · AI生成结果图</p>
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

// ===== MAIN LAYOUT =====
const MENU = [
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
        <div class="p-3 border-t ${d?'border-slate-700':'border-gray-200'}"><div class="flex items-center gap-2 text-[10px] ${cls.textMuted()}"><i class="fas fa-shield-alt"></i><span>New API · v2.0</span></div></div>
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
    case 'channel-status': renderChannelStatus(); break;
    case 'iq-radar': renderIQRadar(); break;
    case 'iq-test': renderIQTest(); break;
    case 'admin-settings': renderAdminSettings(); break;
  }
}

setInterval(() => { if (store.currentPage === 'channel-status') renderChannelStatus(); }, 60 * 60 * 1000);
render();
