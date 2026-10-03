import { channelApi } from '../../services/api';
import { useAsync } from '../../hooks/useAsync';
import Modal from '../Modal';
import ErrorState from '../ErrorState';
import Skeleton from '../Skeleton';
import { SPEED } from './meta';

const pct = (v) => (v < 0 ? '暂无数据' : `${v.toFixed(2)}%`);

function Cell({ k, v, mono = true }) {
  return <div className="bg-muted rounded-lg p-3"><dt className="text-xs text-fg-subtle mb-0.5">{k}</dt><dd className={`text-sm font-medium text-fg ${mono ? 'font-mono' : ''}`}>{v}</dd></div>;
}

function Body({ id }) {
  const { data, loading, error, reload } = useAsync(() => channelApi.detail(id), [id]);
  if (loading) return <div className="space-y-3"><Skeleton className="h-6 w-48" /><Skeleton className="h-24 w-full" /></div>;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const { channel: ch, latest } = data;
  const sp = SPEED[latest?.speed] || SPEED.unknown;
  return (
    <>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="font-mono text-sm text-fg">{ch.modelId}</span>
        {latest ? <span className={latest.success ? 'tag-success' : 'tag-danger'}>{latest.success ? '正常' : '异常'}</span> : <span className="tag-default">暂无检测</span>}
        {latest && <span className={sp.tag}>{sp.label}</span>}
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Cell k="最新延迟" v={latest ? `${latest.responseTime}ms` : '-'} />
        <Cell k="最新 PING" v={latest ? `${latest.ping}ms` : '-'} />
        <Cell k="平均延迟(7d)" v={data.avgLatency7d ? `${data.avgLatency7d}ms` : '-'} />
        <Cell k={`7 天可用率（${data.samples7d} 次）`} v={pct(data.availability7d)} />
        <Cell k={`15 天可用率（${data.samples15d} 次）`} v={pct(data.availability15d)} />
        <Cell k={`30 天可用率（${data.samples30d} 次）`} v={pct(data.availability30d)} />
      </dl>
    </>
  );
}

export default function ChannelDetailModal({ id, name, onClose }) {
  return (
    <Modal open={!!id} onClose={onClose} title={name || '渠道详情'} width="max-w-3xl" footer={<button className="btn-default" onClick={onClose}>关闭</button>}>
      {id && <Body id={id} />}
    </Modal>
  );
}
