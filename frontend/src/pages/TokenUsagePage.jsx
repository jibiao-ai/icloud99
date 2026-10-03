import { useState } from 'react';
import { ArrowLeft, BarChart3, Fingerprint, IdCard, LineChart, ListChecks, RefreshCw, Search, ShieldCheck, Zap } from 'lucide-react';
import { tokenApi } from '../services/api';
import { useStore } from '../store';
import PageHeader from '../components/PageHeader';
import Tabs from '../components/Tabs';
import LoadingButton from '../components/LoadingButton';
import ErrorState from '../components/ErrorState';
import FormField from '../components/FormField';
import { useToast } from '../components/Toast';
import QuotaCards from '../components/token/QuotaCards';
import StatsTab from '../components/token/StatsTab';
import LogsTab from '../components/token/LogsTab';
import TrendTab from '../components/token/TrendTab';
import { useMoney } from '../components/token/format';
import { fmtDateTime } from '../utils/format';

const TABS = [{ key: 'stats', label: '用量统计', icon: BarChart3 }, { key: 'logs', label: '调用日志', icon: ListChecks }, { key: 'trend', label: '每日趋势', icon: LineChart }];
const mask = (k) => (k.length > 12 ? `${k.slice(0, 8)}...${k.slice(-4)}` : k);

export default function TokenUsagePage() {
  const portal = useStore((s) => s.portal);
  const money = useMoney(portal);
  const toast = useToast();
  const [key, setKey] = useState('');
  const [fieldErr, setFieldErr] = useState('');
  const [state, setState] = useState({ loading: false, data: null, error: null, queried: '' });
  const [tab, setTab] = useState('stats');

  const query = async (k = key) => {
    const v = k.trim();
    if (!v) { setFieldErr('请输入令牌 Key'); return; }
    setFieldErr('');
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await tokenApi.query(v);
      setState({ loading: false, data, error: null, queried: v });
      setTab('stats');
    } catch (e) {
      if (e.fields?.key) setFieldErr(e.fields.key); else toast.error(e.message);
      setState({ loading: false, data: null, error: null, queried: '' });
    }
  };

  if (state.loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 fade-in" role="status">
        <div className="w-10 h-10 rounded-full border-2 border-primary border-t-transparent spin mb-4" />
        <p className="text-sm font-medium text-fg">正在查询令牌用量...</p>
        <p className="text-xs text-fg-subtle mt-1">连接 New API 服务器获取数据</p>
      </div>
    );
  }

  if (state.error) return <ErrorState error={state.error} onRetry={() => query(state.queried)} />;

  if (!state.data) {
    return (
      <div className="max-w-3xl mx-auto fade-in">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary-soft text-primary flex items-center justify-center mx-auto mb-4"><LineChart size={30} /></div>
          <h2 className="text-2xl font-bold text-fg mb-2">用量查询</h2>
          <p className="text-sm text-fg-muted">输入令牌 Key 查询额度、使用记录与费用统计</p>
        </div>
        <form className="card p-6" onSubmit={(e) => { e.preventDefault(); query(); }} noValidate>
          <FormField label="API 令牌 Key" htmlFor="token-key" error={fieldErr}>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Fingerprint size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
                <input id="token-key" className={`field pl-9 font-mono ${fieldErr ? 'field-error' : ''}`} placeholder="输入 sk-xxxxxxxxx 格式的令牌密钥" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
              </div>
              <LoadingButton type="submit" className="btn-primary px-6" icon={Zap}>查询</LoadingButton>
            </div>
          </FormField>
          <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-fg-subtle">
            <span className="inline-flex items-center gap-1"><ShieldCheck size={12} />令牌信息仅用于本次查询，不会存储</span>
            <span className="inline-flex items-center gap-1"><Search size={12} />数据来源: New API</span>
          </div>
        </form>
      </div>
    );
  }

  const { tokenInfo: info, logs, modelStats, modelOrder, dailyStats } = state.data;
  const perUnit = Number(portal['site.quota_per_unit']) || 500000;
  const first = logs[0];
  return (
    <div className="fade-in">
      <PageHeader
        icon={LineChart} title="用量查询结果"
        description={<>令牌: <span className="font-mono">{info.name || 'Unknown'}</span> · <span className="font-mono">{mask(state.queried)}</span></>}
        actions={(
          <>
            <button className="btn-default" onClick={() => setState({ loading: false, data: null, error: null, queried: '' })}><ArrowLeft size={15} />重新查询</button>
            <LoadingButton className="btn-default" icon={RefreshCw} onClick={() => query(state.queried)}>刷新</LoadingButton>
          </>
        )}
      />
      <QuotaCards info={info} money={money} />
      <section className="card mb-5">
        <div className="px-5 py-3 border-b border-line flex items-center gap-2"><IdCard size={15} className="text-primary" /><h3 className="text-sm font-semibold text-fg">令牌详细信息</h3></div>
        <dl className="p-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-sm">
          {[['令牌名称', info.name || '-'], ['所属用户', first?.username || '-'], ['所属分组', first?.group || '-'], ['无限额度', info.unlimited_quota ? '是' : '否'], ['模型限额', info.model_limits_enabled ? '已启用' : '未启用'], ['过期时间', info.expires_at > 0 ? fmtDateTime(info.expires_at * 1000) : '永不过期']]
            .map(([k, v]) => <div key={k}><dt className="text-xs text-fg-subtle mb-0.5">{k}</dt><dd className="font-medium text-fg break-all">{v}</dd></div>)}
        </dl>
        {info.model_limits_enabled && Object.keys(info.model_limits || {}).length > 0 && (
          <div className="px-5 pb-5"><p className="text-xs text-fg-subtle mb-2">允许的模型</p><ul className="flex flex-wrap gap-1.5">{Object.keys(info.model_limits).map((m) => <li key={m} className="tag-default font-mono">{m}</li>)}</ul></div>
        )}
      </section>
      <Tabs items={TABS.map((t) => (t.key === 'logs' ? { ...t, count: logs.length } : t))} value={tab} onChange={setTab} idPrefix="token" />
      <div id="token-panel" role="tabpanel">
        {tab === 'stats' && <StatsTab order={modelOrder} stats={modelStats} money={money} />}
        {tab === 'logs' && <LogsTab logs={logs} money={money} />}
        {tab === 'trend' && <TrendTab daily={dailyStats} perUnit={perUnit} symbol={money.sym} />}
      </div>
    </div>
  );
}
