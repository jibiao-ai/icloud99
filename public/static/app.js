// ===== 元擎智算可视化 - 前端应用 =====

// ===== 状态管理 =====
const store = {
  theme: localStorage.getItem('theme') || 'light',
  currentPage: 'channel-status',
  token: localStorage.getItem('token') || '',
  user: null,
  sidebarOpen: window.innerWidth > 768,

  setTheme(t) {
    this.theme = t;
    localStorage.setItem('theme', t);
    document.documentElement.setAttribute('data-theme', t);
    render();
  },
  setPage(p) { this.currentPage = p; render(); },
  setToken(t) { this.token = t; localStorage.setItem('token', t); },
  logout() { this.token = ''; this.user = null; localStorage.removeItem('token'); this.setPage('channel-status'); },
  toggleSidebar() { this.sidebarOpen = !this.sidebarOpen; render(); }
};

document.documentElement.setAttribute('data-theme', store.theme);

// ===== API 客户端 =====
const api = {
  async request(method, path, body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (store.token) headers['Authorization'] = `Bearer ${store.token}`;
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch('/api' + path, opts);
    const data = await resp.json();
    if (resp.status === 401 && path !== '/login') { store.logout(); }
    return data;
  },
  get: (p) => api.request('GET', p),
  post: (p, b) => api.request('POST', p, b),
  put: (p, b) => api.request('PUT', p, b),
  del: (p) => api.request('DELETE', p),
};

// ===== 工具函数 =====
const isDark = () => store.theme === 'dark';
const cls = {
  card: () => `rounded-xl border shadow-sm ${isDark() ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200'}`,
  text: () => isDark() ? 'text-slate-200' : 'text-gray-800',
  textSub: () => isDark() ? 'text-slate-400' : 'text-gray-500',
  textMuted: () => isDark() ? 'text-slate-500' : 'text-gray-400',
  bg: () => isDark() ? 'bg-slate-900' : 'bg-gray-50',
  input: () => `px-3 py-2 rounded-lg border text-sm ${isDark() ? 'bg-slate-700 border-slate-600 text-slate-200 placeholder-slate-500' : 'bg-white border-gray-300 text-gray-800 placeholder-gray-400'}`,
  btn: () => `px-4 py-2 rounded-lg text-sm font-medium transition-all ${isDark() ? 'bg-primary-600 hover:bg-primary-700 text-white' : 'bg-primary-500 hover:bg-primary-600 text-white'}`,
  btnSec: () => `px-4 py-2 rounded-lg text-sm font-medium transition-all border ${isDark() ? 'border-slate-600 text-slate-300 hover:bg-slate-700' : 'border-gray-300 text-gray-700 hover:bg-gray-100'}`,
};

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}小时前`;
  return `${Math.floor(hrs / 24)}天前`;
}

// ===== 渠道状态页面 =====
async function renderChannelStatus() {
  const container = document.getElementById('page-content');
  container.innerHTML = `<div class="flex items-center justify-center h-64"><div class="animate-spin w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full"></div></div>`;

  const { data: channels } = await api.get('/channels?range=7');
  if (!channels || channels.length === 0) {
    container.innerHTML = `
      <div class="text-center py-20">
        <i class="fas fa-satellite-dish text-4xl ${cls.textMuted()} mb-4"></i>
        <p class="${cls.textSub()} text-lg">暂无渠道数据</p>
        <p class="${cls.textMuted()} text-sm mt-2">请先以管理员身份登录，添加渠道并初始化种子数据</p>
        <button onclick="initSeedData()" class="${cls.btn()} mt-4">
          <i class="fas fa-database mr-2"></i>初始化示例数据
        </button>
      </div>`;
    return;
  }

  // 分组 (按照截图的显示顺序)
  const groupOrder = ['openai', 'anthropic', 'domestic'];
  const groups = {
    openai: { label: 'OpenAI', icon: '✦', color: 'text-emerald-500', channels: [] },
    anthropic: { label: 'Anthropic', icon: '✸', color: 'text-orange-500', channels: [] },
    domestic: { label: '国产模型', icon: '●', color: 'text-blue-500', channels: [] }
  };

  channels.forEach(ch => {
    const g = groups[ch.provider] || groups.domestic;
    g.channels.push(ch);
  });

  // 总体状态
  const allRates = channels.map(c => c.success_rate);
  const avgRate = Math.round(allRates.reduce((a, b) => a + b, 0) / allRates.length);
  const overallStatus = avgRate >= 95 ? 'OPERATIONAL' : avgRate >= 80 ? 'DEGRADED' : 'OUTAGE';
  const statusColor = overallStatus === 'OPERATIONAL' ? 'text-emerald-500' : overallStatus === 'DEGRADED' ? 'text-amber-500' : 'text-red-500';
  const statusBg = overallStatus === 'OPERATIONAL' ? 'bg-emerald-500/10' : overallStatus === 'DEGRADED' ? 'bg-amber-500/10' : 'bg-red-500/10';

  let html = `
    <div class="flex flex-wrap items-center justify-between gap-4 mb-6">
      <div class="flex items-center gap-3">
        <h2 class="text-lg font-semibold ${cls.text()}">渠道状态</h2>
        <span class="${statusBg} ${statusColor} px-3 py-1 rounded-full text-xs font-bold">${overallStatus}</span>
      </div>
      <div class="flex items-center gap-2">
        ${['7', '15', '30'].map(d => `
          <button onclick="window._channelRange='${d}';renderChannelStatus()"
            class="px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${(window._channelRange || '7') === d
              ? 'bg-primary-500 text-white' : isDark() ? 'bg-slate-700 text-slate-300 hover:bg-slate-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}">${d} 天</button>
        `).join('')}
        <button onclick="renderChannelStatus()" class="px-3 py-1.5 rounded-lg text-xs ${isDark() ? 'bg-slate-700 text-slate-300 hover:bg-slate-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}" title="刷新">
          <i class="fas fa-sync-alt"></i>
        </button>
        <span class="${cls.textMuted()} text-xs"><i class="fas fa-clock mr-1"></i>自动刷新: 15分钟</span>
      </div>
    </div>`;

  for (const key of groupOrder) {
    const group = groups[key];
    if (group.channels.length === 0) continue;
    html += `
      <div class="mb-8">
        <div class="flex items-center gap-2 mb-4">
          <span class="text-base ${group.color}">${group.icon}</span>
          <h3 class="text-sm font-semibold ${cls.text()}">${group.label}</h3>
          <span class="${cls.textMuted()} text-xs">${group.channels.length}项</span>
          ${key === 'openai' ? `<a href="javascript:void(0)" class="ml-2 px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 flex items-center gap-1.5"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500 pulse-dot"></span>不降智实时监测 <i class="fas fa-external-link-alt text-[10px]"></i></a>` : ''}
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          ${group.channels.map(ch => renderChannelCard(ch)).join('')}
        </div>
      </div>`;
  }

  container.innerHTML = html;
}

function renderChannelCard(ch) {
  const lt = ch.latest_test;
  const rate = ch.success_rate;
  const rateColor = rate >= 95 ? 'text-emerald-500' : rate >= 80 ? 'text-amber-500' : 'text-red-500';
  const speedLabel = lt && lt.response_time_ms < 2000 ? '极速' : lt && lt.response_time_ms < 4000 ? '正常' : '较慢';
  const speedDot = speedLabel === '极速' ? 'bg-emerald-400' : speedLabel === '正常' ? 'bg-blue-400' : 'bg-amber-400';

  const bars = (ch.history || []).map(h => {
    const maxH = 32;
    const height = h.success ? Math.max(4, Math.min(maxH, h.response_time / 100)) : 2;
    const color = !h.success ? '#ef4444' : h.response_time < 2000 ? '#10b981' : h.response_time < 4000 ? '#f59e0b' : '#ef4444';
    return `<div class="bar" style="height:${height}px;background:${color}" data-tooltip="${timeAgo(h.time)} · ${h.success ? '正常' : '失败'} · ${h.response_time}ms" onmouseenter="showTooltip(event,this)" onmouseleave="hideTooltip()"></div>`;
  }).join('');

  return `
    <div class="${cls.card()} p-4 hover:shadow-md transition-shadow fade-in">
      <div class="flex items-start justify-between mb-3">
        <div class="flex items-center gap-2">
          <span class="text-lg">${ch.icon || '📡'}</span>
          <div>
            <h4 class="text-sm font-semibold ${cls.text()}">${ch.name}</h4>
            <p class="${cls.textMuted()} text-xs">${ch.model_id}</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span class="${cls.textMuted()} text-xs">倍率:${ch.rate_multiplier}x</span>
          <span class="flex items-center gap-1 text-xs ${isDark() ? 'text-emerald-400' : 'text-emerald-600'}">
            <span class="w-1.5 h-1.5 rounded-full ${speedDot} pulse-dot"></span>${speedLabel}
          </span>
        </div>
      </div>
      <div class="flex items-end justify-between mb-3">
        <div class="flex gap-4 text-xs ${cls.textSub()}">
          <div><span class="${cls.textMuted()}">对话延迟</span> <span class="font-mono font-medium ${cls.text()}">${lt ? lt.response_time_ms : '-'}ms</span></div>
          <div><span class="${cls.textMuted()}">端点PING</span> <span class="font-mono font-medium ${cls.text()}">${lt ? lt.ping_ms : '-'}ms</span></div>
        </div>
        <span class="text-2xl font-bold ${rateColor}">${rate}%</span>
      </div>
      <div class="flex items-center justify-between">
        <span class="${cls.textMuted()} text-xs">${ch.total_tests}次检测</span>
      </div>
      <div class="bar-chart-mini mt-2">${bars}</div>
    </div>`;
}

// ===== GPT智商雷达页面 =====
function renderIQRadar() {
  const container = document.getElementById('page-content');
  container.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold ${cls.text()}"><i class="fas fa-radar mr-2"></i>GPT 智商雷达</h2>
      <a href="https://iq-radar.pages.dev/?user_id=118508&token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoxMTg1MDgsImVtYWlsIjoiNjkxMTgxMzY0QHFxLmNvbSIsInJvbGUiOiJ1c2VyIiwidG9rZW5fdmVyc2lvbiI6OTAyMTA4NTA5NTAzNTY2NTYzOCwic2lkIjoiYzAwMTliNWUxNDI3YzFkMWE3N2FiMjNkOTVkOWUzMmYiLCJibmQiOiI1MmRmMGNjNDUzNTMzY2ZjM2ZmZTVmMDMyY2U2NDgxNyIsImV4cCI6MTc4OTY1MTI5NywibmJmIjoxNzg5NTY0ODk3LCJpYXQiOjE3ODk1NjQ4OTd9.p_sbrD5i_AlCCe0RWGnv3rzTnIvABhuIyuSxuwlxf94&theme=${store.theme}&lang=zh&ui_mode=embedded&src_host=https://edge.lingsuan.org&src_url=https://edge.lingsuan.org/custom/c0d43342ecab1260"
        target="_blank" class="${cls.btnSec()} text-xs"><i class="fas fa-external-link-alt mr-1"></i>新窗口打开</a>
    </div>
    <div class="${cls.card()} overflow-hidden" style="height:calc(100vh - 160px)">
      <iframe
        src="https://iq-radar.pages.dev/?user_id=118508&token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoxMTg1MDgsImVtYWlsIjoiNjkxMTgxMzY0QHFxLmNvbSIsInJvbGUiOiJ1c2VyIiwidG9rZW5fdmVyc2lvbiI6OTAyMTA4NTA5NTAzNTY2NTYzOCwic2lkIjoiYzAwMTliNWUxNDI3YzFkMWE3N2FiMjNkOTVkOWUzMmYiLCJibmQiOiI1MmRmMGNjNDUzNTMzY2ZjM2ZmZTVmMDMyY2U2NDgxNyIsImV4cCI6MTc4OTY1MTI5NywibmJmIjoxNzg5NTY0ODk3LCJpYXQiOjE3ODk1NjQ4OTd9.p_sbrD5i_AlCCe0RWGnv3rzTnIvABhuIyuSxuwlxf94&theme=${store.theme}&lang=zh&ui_mode=embedded&src_host=https://edge.lingsuan.org&src_url=https://edge.lingsuan.org/custom/c0d43342ecab1260"
        class="w-full h-full border-0"
        allow="fullscreen"
        loading="lazy"
      ></iframe>
    </div>`;
}

// ===== 智力检测页面 =====
async function renderIQTest() {
  const container = document.getElementById('page-content');
  container.innerHTML = `<div class="flex items-center justify-center h-64"><div class="animate-spin w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full"></div></div>`;

  const [testsResp, statsResp] = await Promise.all([
    api.get('/iq-tests?limit=100'),
    api.get('/iq-tests/stats')
  ]);
  const tests = testsResp.data || [];
  const stats = statsResp.data || [];

  // 统计
  const modelStats = {};
  stats.forEach(s => {
    const key = `${s.model}|${s.tier}`;
    if (!modelStats[key]) modelStats[key] = { pass: 0, works: 0, degraded: 0, total: 0 };
    modelStats[key][s.result] = (modelStats[key][s.result] || 0) + s.count;
    modelStats[key].total += s.count;
  });

  const resultBadge = (r) => {
    if (r === 'pass') return `<span class="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-600">✓ 智力通过</span>`;
    if (r === 'works') return `<span class="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/15 text-blue-600">◎ 可以作品</span>`;
    return `<span class="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/15 text-red-600">✗ 降智记录</span>`;
  };

  const tierBadge = (t) => {
    const colors = { lite: 'bg-gray-500/15 text-gray-600', standard: 'bg-blue-500/15 text-blue-600', ultra: 'bg-purple-500/15 text-purple-600' };
    return `<span class="px-2 py-0.5 rounded-full text-xs font-medium ${colors[t] || colors.lite}">${t.toUpperCase()}</span>`;
  };

  let html = `
    <div class="flex flex-wrap items-center justify-between gap-4 mb-6">
      <div>
        <h2 class="text-lg font-semibold ${cls.text()}"><i class="fas fa-brain mr-2"></i>智力检测</h2>
        <p class="${cls.textSub()} text-xs mt-1">鹦鹉骑行 (Codex Candy Eval) · 每3小时自动检测</p>
      </div>
      <div class="flex gap-2">
        <button onclick="runManualIQTest('gpt-5.6-sol')" class="${cls.btn()} text-xs"><i class="fas fa-play mr-1"></i>手动测试 GPT-5.6</button>
        <button onclick="runManualIQTest('gpt-6-astra')" class="${cls.btn()} text-xs"><i class="fas fa-play mr-1"></i>手动测试 GPT-6</button>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
      ${Object.entries(modelStats).map(([key, s]) => {
        const [model, tier] = key.split('|');
        const passRate = s.total > 0 ? Math.round(s.pass / s.total * 100) : 0;
        return `
          <div class="${cls.card()} p-4">
            <div class="flex items-center justify-between mb-3">
              <div>
                <span class="text-sm font-semibold ${cls.text()}">${model}</span>
                ${tierBadge(tier)}
              </div>
              <span class="text-xl font-bold ${passRate >= 80 ? 'text-emerald-500' : passRate >= 50 ? 'text-amber-500' : 'text-red-500'}">${passRate}%</span>
            </div>
            <div class="flex gap-3 text-xs">
              <div class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-emerald-500"></span> 通过 ${s.pass}</div>
              <div class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-blue-500"></span> 作品 ${s.works}</div>
              <div class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-red-500"></span> 降智 ${s.degraded}</div>
            </div>
            <div class="mt-2 h-2 rounded-full overflow-hidden flex ${isDark() ? 'bg-slate-700' : 'bg-gray-100'}">
              <div class="bg-emerald-500 h-full" style="width:${s.total > 0 ? (s.pass/s.total*100) : 0}%"></div>
              <div class="bg-blue-500 h-full" style="width:${s.total > 0 ? (s.works/s.total*100) : 0}%"></div>
              <div class="bg-red-500 h-full" style="width:${s.total > 0 ? (s.degraded/s.total*100) : 0}%"></div>
            </div>
          </div>`;
      }).join('')}
    </div>

    <!-- 检测记录表格 -->
    <div class="${cls.card()} overflow-hidden">
      <div class="p-4 border-b ${isDark() ? 'border-slate-700' : 'border-gray-200'}">
        <h3 class="text-sm font-semibold ${cls.text()}">检测记录</h3>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="${isDark() ? 'bg-slate-700/50' : 'bg-gray-50'}">
            <tr>
              <th class="px-4 py-3 text-left ${cls.textSub()} font-medium text-xs">时间</th>
              <th class="px-4 py-3 text-left ${cls.textSub()} font-medium text-xs">模型</th>
              <th class="px-4 py-3 text-left ${cls.textSub()} font-medium text-xs">分组</th>
              <th class="px-4 py-3 text-left ${cls.textSub()} font-medium text-xs">类型</th>
              <th class="px-4 py-3 text-left ${cls.textSub()} font-medium text-xs">结果</th>
              <th class="px-4 py-3 text-right ${cls.textSub()} font-medium text-xs">耗时</th>
              <th class="px-4 py-3 text-right ${cls.textSub()} font-medium text-xs">推理Token</th>
            </tr>
          </thead>
          <tbody class="divide-y ${isDark() ? 'divide-slate-700' : 'divide-gray-100'}">
            ${tests.slice(0, 50).map(t => `
              <tr class="${isDark() ? 'hover:bg-slate-700/30' : 'hover:bg-gray-50'} transition-colors">
                <td class="px-4 py-3 ${cls.textMuted()} text-xs">${timeAgo(t.tested_at)}</td>
                <td class="px-4 py-3 ${cls.text()} font-mono text-xs">${t.model}</td>
                <td class="px-4 py-3">${tierBadge(t.tier)}</td>
                <td class="px-4 py-3 ${cls.textSub()} text-xs">${t.test_type === 'parrot' ? '🦜 鹦鹉骑行' : '🍬 Codex糖果'}</td>
                <td class="px-4 py-3">${resultBadge(t.result)}</td>
                <td class="px-4 py-3 text-right font-mono ${cls.text()} text-xs">${t.response_time_ms}ms</td>
                <td class="px-4 py-3 text-right font-mono ${cls.textSub()} text-xs">${t.reasoning_tokens || '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  container.innerHTML = html;
}

window.runManualIQTest = async function(model) {
  const tier = prompt('请选择分组 (lite/standard/ultra):', 'lite');
  if (!tier) return;
  const btn = event.target;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>测试中...';
  try {
    const resp = await api.post('/run-iq-test', { model, tier, provider: 'openai' });
    if (resp.code === 0) {
      alert(`测试完成!\n结果: ${resp.data.result}\n分数: ${resp.data.score}\n耗时: ${resp.data.responseTime}ms`);
      renderIQTest();
    } else {
      alert('测试失败: ' + resp.message);
    }
  } catch(e) { alert('测试出错: ' + e.message); }
  btn.disabled = false;
  btn.innerHTML = `<i class="fas fa-play mr-1"></i>手动测试 ${model.includes('6') ? 'GPT-6' : 'GPT-5.6'}`;
};

// ===== 管理员设置页面 =====
async function renderAdminSettings() {
  const container = document.getElementById('page-content');

  if (!store.token) {
    container.innerHTML = renderLoginForm();
    return;
  }

  container.innerHTML = `<div class="flex items-center justify-center h-64"><div class="animate-spin w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full"></div></div>`;

  const { data: configs } = await api.get('/admin/configs');

  const providers = ['openai', 'anthropic'];
  const tiers = ['lite', 'standard', 'ultra'];
  const providerLabels = { openai: 'OpenAI', anthropic: 'Anthropic' };
  const tierLabels = { lite: 'Lite 分组', standard: 'Standard 分组', ultra: 'Ultra 分组' };

  const configMap = {};
  (configs || []).forEach(c => { configMap[`${c.provider}_${c.tier}`] = c; });

  let html = `
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-lg font-semibold ${cls.text()}"><i class="fas fa-cog mr-2"></i>API 密钥管理</h2>
        <p class="${cls.textSub()} text-xs mt-1">配置各分组的 New API 令牌密钥</p>
      </div>
      <button onclick="store.logout()" class="${cls.btnSec()} text-xs"><i class="fas fa-sign-out-alt mr-1"></i>退出登录</button>
    </div>`;

  for (const provider of providers) {
    html += `<div class="mb-8">
      <h3 class="text-sm font-semibold ${cls.text()} mb-4 flex items-center gap-2">
        <span class="w-2 h-2 rounded-full ${provider === 'openai' ? 'bg-emerald-500' : 'bg-orange-500'}"></span>
        ${providerLabels[provider]}
      </h3>
      <div class="grid gap-4">`;

    for (const tier of tiers) {
      const key = `${provider}_${tier}`;
      const existing = configMap[key];
      const val = existing ? existing.config_json : '';

      html += `
        <div class="${cls.card()} p-4">
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm font-medium ${cls.text()}">${tierLabels[tier]}</span>
            ${existing ? `<span class="text-xs ${isDark() ? 'text-emerald-400' : 'text-emerald-600'}"><i class="fas fa-check-circle mr-1"></i>已配置</span>` : `<span class="text-xs ${cls.textMuted()}">未配置</span>`}
          </div>
          <div class="flex gap-2">
            <textarea id="config_${key}" rows="2" placeholder='{"_type":"newapi_channel_conn","key":"sk-xxx","url":"https://api.icloud99.cn"}'
              class="${cls.input()} flex-1 font-mono text-xs resize-none">${val}</textarea>
            <div class="flex flex-col gap-1">
              <button onclick="saveConfig('${provider}','${tier}')" class="${cls.btn()} text-xs !px-3">
                <i class="fas fa-save"></i>
              </button>
              ${existing ? `<button onclick="deleteConfig(${existing.id})" class="px-3 py-2 rounded-lg text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 border ${isDark() ? 'border-slate-600' : 'border-gray-300'}">
                <i class="fas fa-trash"></i>
              </button>` : ''}
            </div>
          </div>
        </div>`;
    }

    html += `</div></div>`;
  }

  // 渠道管理
  html += `
    <div class="mt-8 mb-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-sm font-semibold ${cls.text()}"><i class="fas fa-server mr-2"></i>渠道管理</h3>
        <div class="flex gap-2">
          <button onclick="initSeedData()" class="${cls.btnSec()} text-xs"><i class="fas fa-database mr-1"></i>初始化种子数据</button>
          <button onclick="testAllChannels()" class="${cls.btn()} text-xs"><i class="fas fa-vial mr-1"></i>检测所有渠道</button>
        </div>
      </div>
    </div>`;

  container.innerHTML = html;
}

function renderLoginForm() {
  return `
    <div class="flex items-center justify-center min-h-[60vh]">
      <div class="${cls.card()} p-8 w-full max-w-md">
        <div class="text-center mb-6">
          <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center mx-auto mb-4">
            <i class="fas fa-shield-alt text-2xl text-white"></i>
          </div>
          <h2 class="text-lg font-semibold ${cls.text()}">管理员登录</h2>
          <p class="${cls.textSub()} text-xs mt-1">请输入管理员凭据以管理系统设置</p>
        </div>
        <div class="space-y-4">
          <div>
            <label class="text-xs font-medium ${cls.textSub()} mb-1 block">用户名</label>
            <input id="login-user" type="text" value="admin" class="${cls.input()} w-full" placeholder="admin">
          </div>
          <div>
            <label class="text-xs font-medium ${cls.textSub()} mb-1 block">密码</label>
            <input id="login-pass" type="password" class="${cls.input()} w-full" placeholder="请输入密码" onkeydown="if(event.key==='Enter')doLogin()">
          </div>
          <button onclick="doLogin()" class="${cls.btn()} w-full"><i class="fas fa-sign-in-alt mr-2"></i>登录</button>
        </div>
      </div>
    </div>`;
}

window.doLogin = async function() {
  const username = document.getElementById('login-user').value;
  const password = document.getElementById('login-pass').value;
  const resp = await api.post('/login', { username, password });
  if (resp.code === 0) {
    store.setToken(resp.data.token);
    store.user = resp.data.user;
    renderAdminSettings();
  } else {
    alert(resp.message || '登录失败');
  }
};

window.saveConfig = async function(provider, tier) {
  const val = document.getElementById(`config_${provider}_${tier}`).value.trim();
  if (!val) { alert('请输入配置内容'); return; }
  try { JSON.parse(val); } catch { alert('配置必须是有效的JSON格式'); return; }
  const resp = await api.post('/admin/configs', { provider, tier, config_json: val });
  if (resp.code === 0) { alert('保存成功'); renderAdminSettings(); }
  else alert(resp.message);
};

window.deleteConfig = async function(id) {
  if (!confirm('确认删除此配置?')) return;
  const resp = await api.del('/admin/configs/' + id);
  if (resp.code === 0) { alert('已删除'); renderAdminSettings(); }
};

window.initSeedData = async function() {
  if (!store.token) {
    alert('请先登录管理员账号');
    store.setPage('admin-settings');
    return;
  }
  const resp = await api.post('/admin/seed', {});
  if (resp.code === 0) { alert(resp.message); renderChannelStatus(); }
  else alert(resp.message);
};

window.testAllChannels = async function() {
  const resp = await api.post('/test-all-channels', {});
  if (resp.code === 0) {
    alert(`检测完成! 共 ${resp.data.length} 个渠道`);
    renderChannelStatus();
  } else alert(resp.message);
};

// ===== 自定义 Tooltip =====
window.showTooltip = function(event, el) {
  let tip = document.getElementById('bar-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'bar-tooltip';
    tip.style.cssText = 'position:fixed;pointer-events:none;z-index:9999;padding:6px 10px;border-radius:8px;font-size:11px;white-space:nowrap;transition:opacity 0.15s;';
    document.body.appendChild(tip);
  }
  const dark = isDark();
  tip.style.background = dark ? '#1e293b' : '#111827';
  tip.style.color = '#fff';
  tip.style.border = dark ? '1px solid #334155' : '1px solid #374151';
  tip.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
  tip.textContent = el.dataset.tooltip;
  tip.style.opacity = '1';
  const rect = el.getBoundingClientRect();
  tip.style.left = (rect.left + rect.width / 2 - tip.offsetWidth / 2) + 'px';
  tip.style.top = (rect.top - 36) + 'px';
};

window.hideTooltip = function() {
  const tip = document.getElementById('bar-tooltip');
  if (tip) tip.style.opacity = '0';
};

// ===== 主布局 =====
const MENU_ITEMS = [
  { id: 'channel-status', label: '渠道状态', icon: 'fas fa-satellite-dish', public: true },
  { id: 'iq-radar', label: 'GPT智商雷达', icon: 'fas fa-crosshairs', public: true },
  { id: 'iq-test', label: '智力检测', icon: 'fas fa-brain', public: true },
  { id: 'admin-settings', label: '管理设置', icon: 'fas fa-cog', public: false },
];

function render() {
  const app = document.getElementById('app');
  const d = isDark();

  app.innerHTML = `
    <div class="flex h-screen ${d ? 'bg-slate-900' : 'bg-gray-50'}">
      <!-- 侧边栏 -->
      <aside class="${store.sidebarOpen ? 'w-56' : 'w-0 -ml-56'} md:${store.sidebarOpen ? 'w-56' : 'w-16'} transition-all duration-300 flex-shrink-0 ${d ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200'} border-r flex flex-col overflow-hidden" style="min-width:${store.sidebarOpen ? '14rem' : '0'}">
        <div class="p-4 flex items-center gap-3 border-b ${d ? 'border-slate-700' : 'border-gray-200'}">
          <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center flex-shrink-0">
            <i class="fas fa-bolt text-white text-sm"></i>
          </div>
          <div class="overflow-hidden">
            <h1 class="text-sm font-bold ${cls.text()} whitespace-nowrap">元擎智算</h1>
            <p class="${cls.textMuted()} text-xs whitespace-nowrap">可视化监控</p>
          </div>
        </div>
        <nav class="flex-1 p-2 space-y-1 overflow-y-auto scrollbar-thin">
          ${MENU_ITEMS.map(m => `
            <button onclick="store.setPage('${m.id}')"
              class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                store.currentPage === m.id
                  ? d ? 'bg-primary-600/20 text-primary-400 font-medium' : 'bg-primary-50 text-primary-700 font-medium'
                  : d ? 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-800'
              }">
              <i class="${m.icon} w-4 text-center"></i>
              <span>${m.label}</span>
              ${!m.public ? `<i class="fas fa-lock text-xs ml-auto ${cls.textMuted()}"></i>` : ''}
            </button>
          `).join('')}
        </nav>
        <div class="p-3 border-t ${d ? 'border-slate-700' : 'border-gray-200'}">
          <div class="flex items-center gap-2 text-xs ${cls.textMuted()}">
            <i class="fas fa-info-circle"></i>
            <span>基于 New API · v1.0</span>
          </div>
        </div>
      </aside>

      <!-- 主内容 -->
      <main class="flex-1 flex flex-col overflow-hidden">
        <!-- 顶栏 -->
        <header class="h-14 flex items-center justify-between px-4 border-b ${d ? 'bg-slate-800/50 border-slate-700' : 'bg-white/80 border-gray-200'} glass flex-shrink-0">
          <div class="flex items-center gap-3">
            <button onclick="store.toggleSidebar()" class="p-2 rounded-lg ${d ? 'hover:bg-slate-700 text-slate-400' : 'hover:bg-gray-100 text-gray-500'}">
              <i class="fas fa-bars"></i>
            </button>
            <span class="text-sm font-medium ${cls.text()}">${MENU_ITEMS.find(m => m.id === store.currentPage)?.label || ''}</span>
          </div>
          <div class="flex items-center gap-2">
            <button onclick="store.setTheme(isDark()?'light':'dark')" class="p-2 rounded-lg ${d ? 'hover:bg-slate-700 text-slate-400' : 'hover:bg-gray-100 text-gray-500'}" title="切换主题">
              <i class="fas fa-${d ? 'sun' : 'moon'}"></i>
            </button>
            ${store.token ? `
              <span class="text-xs ${cls.textSub()}"><i class="fas fa-user mr-1"></i>admin</span>
              <button onclick="store.logout()" class="p-2 rounded-lg text-xs ${d ? 'hover:bg-slate-700 text-slate-400' : 'hover:bg-gray-100 text-gray-500'}" title="退出">
                <i class="fas fa-sign-out-alt"></i>
              </button>
            ` : ''}
          </div>
        </header>

        <!-- 页面内容 -->
        <div id="page-content" class="flex-1 overflow-y-auto p-6 scrollbar-thin"></div>
      </main>
    </div>`;

  // 渲染页面内容
  switch (store.currentPage) {
    case 'channel-status': renderChannelStatus(); break;
    case 'iq-radar': renderIQRadar(); break;
    case 'iq-test': renderIQTest(); break;
    case 'admin-settings': renderAdminSettings(); break;
  }
}

// 自动刷新渠道状态 (每15分钟)
setInterval(() => {
  if (store.currentPage === 'channel-status') renderChannelStatus();
}, 15 * 60 * 1000);

// 初始渲染
render();
