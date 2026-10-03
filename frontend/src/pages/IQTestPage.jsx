import { useState } from 'react';
import { Brain, Cpu, Lock, Play } from 'lucide-react';
import { Link } from 'react-router-dom';
import { iqApi } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { useCan } from '../hooks/useCan';
import { useListQuery } from '../hooks/useListQuery';
import PageHeader from '../components/PageHeader';
import Pagination from '../components/Pagination';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import Skeleton from '../components/Skeleton';
import LoadingButton from '../components/LoadingButton';
import ConfirmModal from '../components/ConfirmModal';
import { useToast } from '../components/Toast';
import IQCard from '../components/iq/IQCard';
import IQDetailModal from '../components/iq/IQDetailModal';
import TierStats from '../components/iq/TierStats';
import { RESULT } from '../components/iq/meta';
import { TIER_LABEL } from '../components/channels/meta';

const TIERS = ['lite', 'standard', 'ultra'];

export default function IQTestPage() {
  const canRun = useCan('iq:run');
  const toast = useToast();
  const list = useListQuery('iq', (q) => iqApi.list({ page: q.page, pageSize: q.pageSize }), { page: 1, pageSize: 12 });
  const stats = useAsync(() => iqApi.stats(), []);
  const schedule = useAsync(() => iqApi.schedule(), []);
  const [detail, setDetail] = useState(null);
  const [running, setRunning] = useState('');
  const [confirm, setConfirm] = useState('');

  const run = async (tier) => {
    setConfirm('');
    setRunning(tier);
    try {
      const r = await iqApi.run(tier);
      const m = RESULT[r.result] || RESULT.degraded;
      const msg = `${TIER_LABEL[tier]}：${m.label}（${(r.responseTimeMs / 1000).toFixed(1)}s）${r.hasSvg ? ' · 已生成 SVG 动画' : ''}`;
      (r.result === 'pass' ? toast.success : r.result === 'works' ? toast.warning : toast.error)(msg);
      list.setQuery({ page: 1 });
      list.reload(); stats.reload();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setRunning('');
    }
  };

  const model = schedule.data?.model || 'gpt-6-astra';
  return (
    <div className="fade-in">
      <PageHeader
        icon={Brain} title="智力检测 · 鹈鹕骑行"
        description={`Codex Candy Eval + SVG 动画生成 · 检测模型 ${model} · 每天 ${schedule.data?.startHour ?? 2}:00–${schedule.data?.endHour ?? 8}:00（北京时间）按小时轮转分组`}
        actions={(
          <>
            {TIERS.map((t) => (canRun
              ? <LoadingButton key={t} className="btn-primary btn-sm" icon={Play} loading={running === t} disabled={!!running && running !== t} onClick={() => setConfirm(t)}>{TIER_LABEL[t]}</LoadingButton>
              : <Link key={t} to="/settings" className="btn-default btn-sm opacity-70" title="需管理员登录"><Lock size={12} />{TIER_LABEL[t]}</Link>))}
            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-fg-subtle"><Cpu size={12} />{model}</span>
          </>
        )}
      />
      <TierStats stats={stats.data} schedule={schedule.data} />

      {list.loading && <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44" />)}</div>}
      {list.error && <div className="card"><ErrorState error={list.error} onRetry={list.reload} /></div>}
      {!list.loading && !list.error && list.rows.length === 0 && (
        <div className="card"><EmptyState icon={Brain} title="暂无检测记录" description={canRun ? '点击上方 Lite / Standard / Ultra 手动检测，或等待凌晨自动检测。需先在「管理设置 → API 密钥」配置对应分组的 OpenAI 密钥。' : '管理员登录后可手动触发检测；系统也会在凌晨自动检测。'} /></div>
      )}
      {!list.loading && !list.error && list.rows.length > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-3">{list.rows.map((t) => <IQCard key={t.id} t={t} onOpen={setDetail} />)}</div>
          <div className="card mt-4"><Pagination page={list.query.page} pageSize={list.query.pageSize} total={list.total} sizes={false} onPageChange={(p) => list.setQuery({ page: p }, { resetPage: false })} /></div>
        </>
      )}

      <IQDetailModal t={detail} onClose={() => setDetail(null)} />
      <ConfirmModal open={!!confirm} title={`运行 ${TIER_LABEL[confirm] || ''} 分组检测`} message="将调用上游模型执行糖果推理题与 SVG 生成，耗时约 1~3 分钟并产生少量 Token 消耗。"
        confirmText="开始检测" onConfirm={() => run(confirm)} onCancel={() => setConfirm('')} />
    </div>
  );
}
