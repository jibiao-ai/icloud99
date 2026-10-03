import { useCallback, useMemo, useState } from 'react';
import { RefreshCw, Satellite } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { channelApi } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { useCan } from '../hooks/useCan';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import Skeleton from '../components/Skeleton';
import LoadingButton from '../components/LoadingButton';
import ChannelCard from '../components/channels/ChannelCard';
import ChannelDetailModal from '../components/channels/ChannelDetailModal';
import TestRunner from '../components/channels/TestRunner';
import { PROVIDERS, TIER_LABEL } from '../components/channels/meta';

export default function ChannelStatusPage() {
  const [sp, setSp] = useSearchParams();
  const provider = PROVIDERS[sp.get('provider')] ? sp.get('provider') : 'anthropic';
  const [open, setOpen] = useState(null);
  const canManage = useCan('channel:manage');
  const { data, loading, refreshing, error, reload } = useAsync(() => channelApi.list(7), []);
  const [seeding, setSeeding] = useState(false);

  const go = useCallback((patch) => setSp((p) => { const n = new URLSearchParams(p); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); return n; }, { replace: true }), [setSp]);

  const all = data || [];
  const counts = useMemo(() => Object.fromEntries(Object.keys(PROVIDERS).map((k) => [k, all.filter((c) => c.provider === k).length])), [all]);
  const list = useMemo(() => all.filter((c) => c.provider === provider), [all, provider]);
  const openName = all.find((c) => c.id === open)?.name;

  const seed = async () => { setSeeding(true); try { await channelApi.seed(); await reload(); } finally { setSeeding(false); } };

  return (
    <div className="fade-in">
      <PageHeader
        icon={Satellite} title="渠道状态" description="实时监控各分组下模型渠道的可用性与响应速度（默认展示近 7 天最近 60 次检测）"
        actions={(
          <>
            <TestRunner onProgress={reload} />
            <LoadingButton className="btn-default btn-sm" icon={RefreshCw} loading={refreshing} onClick={reload}>刷新</LoadingButton>
          </>
        )}
      />
      <div role="tablist" className="flex gap-2 mb-4">
        {Object.entries(PROVIDERS).map(([k, v]) => (
          <button key={k} role="tab" aria-selected={provider === k} onClick={() => go({ provider: k })}
            className={`rounded-lg px-4 py-2 text-sm transition-colors ${provider === k ? 'bg-primary text-primary-text font-semibold' : 'bg-card border border-line text-fg-muted hover:bg-hover'}`}>
            {v.label}<span className="ml-2 text-[11px] opacity-70">{counts[k] || 0}</span>
          </button>
        ))}
      </div>

      {loading && <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-40" />)}</div>}
      {error && <div className="card"><ErrorState error={error} onRetry={reload} /></div>}
      {!loading && !error && all.length === 0 && (
        <div className="card">
          <EmptyState icon={Satellite} title="暂无渠道数据" description="尚未初始化渠道目录。初始化后还需在「管理设置 → API 密钥」中配置各分组的上游密钥，检测才会产生数据。"
            action={canManage ? <LoadingButton loading={seeding} onClick={seed}>初始化渠道目录</LoadingButton> : <Link className="btn-default" to="/settings">管理员登录后初始化</Link>} />
        </div>
      )}
      {!loading && !error && all.length > 0 && (
        <>
          {list.length === 0 ? <div className="card"><EmptyState title={`${PROVIDERS[provider].label} 暂无渠道`} /></div> : (
            <>
              {['lite', 'standard', 'ultra'].map((tier) => {
                const g = list.filter((c) => c.tier === tier);
                if (!g.length) return null;
                return (
                  <section key={tier} className="mb-5">
                    <h3 className="text-sm font-semibold text-fg mb-2.5 flex items-center gap-2"><span className="inline-block w-1 h-4 rounded bg-primary" />{TIER_LABEL[tier]} 分组<span className="text-[11px] font-normal text-fg-subtle">{g.length} 个模型</span></h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">{g.map((c) => <ChannelCard key={c.id} ch={c} onOpen={setOpen} />)}</div>
                  </section>
                );
              })}
            </>
          )}
        </>
      )}
      <ChannelDetailModal id={open} name={openName} onClose={() => setOpen(null)} />
    </div>
  );
}
