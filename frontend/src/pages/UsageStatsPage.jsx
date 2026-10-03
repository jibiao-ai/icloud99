import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Users } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { usageApi } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { useCan } from '../hooks/useCan';
import PageHeader from '../components/PageHeader';
import ErrorState from '../components/ErrorState';
import LoadingButton from '../components/LoadingButton';
import { Link } from 'react-router-dom';
import EmptyState from '../components/EmptyState';
import PeriodBar from '../components/usage/PeriodBar';
import SummaryCards from '../components/usage/SummaryCards';
import Charts from '../components/usage/Charts';
import UserTable from '../components/usage/UserTable';
import UserDetailModal from '../components/usage/UserDetailModal';
import ExportOptions from '../components/usage/ExportOptions';
import { MAX_DAYS, daysBetween, matchPreset, presetRange } from '../components/usage/periods';
import { useToast } from '../components/Toast';
import { fmtDateTime } from '../utils/format';

/** 用量统计：周期、筛选同步到地址栏，刷新与分享均可还原。 */
export default function UsageStatsPage() {
  const can = useCan('usage:view');
  const [sp, setSp] = useSearchParams();
  const def = useMemo(() => presetRange('month'), []);
  const start = sp.get('start') || def.start;
  const end = sp.get('end') || def.end;
  const preset = matchPreset(start, end);
  const valid = start <= end && daysBetween(start, end) <= MAX_DAYS;

  const [filters, setFilters] = useState({ group: '', hideZero: false });
  const [exp, setExp] = useState({ details: false, maxRows: 10000 });
  const [detailUser, setDetailUser] = useState(null);
  const forceRef = useRef(false);
  const toast = useToast();
  const [now, setNow] = useState(() => Date.now());

  const setPeriod = useCallback((p) => setSp((old) => { const n = new URLSearchParams(old); n.set('start', p.start); n.set('end', p.end); return n; }, { replace: true }), [setSp]);
  const takeForce = () => { const f = forceRef.current; forceRef.current = false; return f; };
  const { data, loading, refreshing, error, reload } = useAsync(
    () => (valid ? usageApi.summary({ start, end, refresh: takeForce() ? 1 : undefined }) : Promise.resolve(null)),
    [start, end, valid],
  );

  // 手动刷新冷却：以后端下发的 nextRefreshAt 为准；冷却期内按钮禁用并显示倒计时
  const nextAt = data?.meta?.nextRefreshAt || 0;
  const left = Math.max(0, Math.ceil((nextAt - now) / 1000));
  useEffect(() => {
    setNow(Date.now());
    if (!nextAt || nextAt <= Date.now()) return undefined;
    const t = setInterval(() => { setNow(Date.now()); if (Date.now() >= nextAt) clearInterval(t); }, 1000);
    return () => clearInterval(t);
  }, [nextAt]);
  const refresh = async () => {
    if (left > 0 || loading || refreshing) return;
    forceRef.current = true;
    await reload();
    setNow(Date.now());
  };
  useEffect(() => { if (data?.meta?.refreshDenied) toast.info('刷新过于频繁，已返回缓存数据'); }, [data?.meta?.generatedAt, data?.meta?.refreshDenied]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportParams = useCallback((extra = {}) => ({
    start, end, group: filters.group || undefined, includeZero: filters.hideZero ? 0 : 1,
    details: exp.details ? 1 : 0, maxRows: exp.maxRows, ...extra,
  }), [start, end, filters, exp]);

  if (!can) {
    return <div className="card"><EmptyState icon={Users} title="需要管理员权限" description="用量统计包含全站用户账单，请先登录管理员账号。" action={<Link className="btn-primary" to="/settings">去登录</Link>} /></div>;
  }

  const meta = data?.meta;
  return (
    <div className="fade-in">
      <PageHeader
        icon={Users} title="用量统计 · 全站用户账单" description="在指定周期内统计 New API 全站所有用户的消费账单，并与后台口径自动对账（北京时间）。数据带缓存，请勿频繁刷新"
        actions={(
          <LoadingButton className="btn-default btn-sm" icon={RefreshCw} loading={refreshing || loading} disabled={left > 0} onClick={refresh} title="为保护上游接口，手动刷新有冷却时间">
            {left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} 后可刷新` : '刷新数据'}
          </LoadingButton>
        )}
      />
      <PeriodBar start={start} end={end} preset={preset} onChange={setPeriod} />

      {error && <div className="card"><ErrorState error={error} onRetry={reload} settingsTab="newapi" /></div>}
      {!error && valid && (
        <>
          <SummaryCards s={data} loading={loading} />
          {data && (
            <>
              {meta?.errors?.length > 0 && (
                <div className="card px-4 py-3 mb-4 text-xs text-warning bg-warning-soft border-warning" role="alert">部分用户数据拉取失败（{meta.errors.length}），金额可能偏低：{meta.errors.slice(0, 2).join('；')}</div>
              )}
              <Charts s={data} />
              <div className="card px-4 py-3 mb-3"><ExportOptions value={exp} onChange={setExp} /></div>
              <UserTable s={data} filters={filters} setFilters={setFilters} onOpen={setDetailUser} exportParams={exportParams} />
              <p className="text-[11px] text-fg-subtle mt-3">
                数据口径：{meta.source === 'quota_data' ? '/api/data 小时级预聚合' : '/api/log/stat 逐用户校正（预聚合与后台不一致时自动回退）'}
                · 统计 {meta.candidates} 位有请求记录的用户 · 耗时 {(meta.elapsedMs / 1000).toFixed(1)}s · {meta.cached ? '缓存结果' : '实时计算'} · 生成于 {fmtDateTime(meta.generatedAt)}
              </p>
            </>
          )}
        </>
      )}
      <UserDetailModal user={detailUser} range={{ start, end }} onClose={() => setDetailUser(null)} />
    </div>
  );
}
