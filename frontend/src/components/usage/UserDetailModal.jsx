import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { usageApi } from '../../services/api';
import { useAsync } from '../../hooks/useAsync';
import { useChartPalette } from '../../hooks/useChartPalette';
import Modal from '../Modal';
import Tabs from '../Tabs';
import ErrorState from '../ErrorState';
import Skeleton from '../Skeleton';
import EmptyState from '../EmptyState';
import DataTable from '../DataTable';
import CustomSelect from '../CustomSelect';
import { useListQuery } from '../../hooks/useListQuery';
import { fmtInt } from '../../utils/format';

function Overview({ name, range }) {
  const pal = useChartPalette();
  const { data, loading, error, reload } = useAsync(() => usageApi.user(name, range), [name, range.start, range.end]);
  if (loading) return <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-56" /></div>;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const sym = data.currency.symbol;
  const daily = data.daily.map((d) => ({ day: d.day.slice(5), amount: d.amount }));
  return (
    <>
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[['周期消费', `${sym}${data.totals.amount.toFixed(4)}`], ['调用次数', fmtInt(data.totals.count)], ['Tokens', fmtInt(data.totals.tokens)], ['使用模型', data.models.length]]
          .map(([k, v]) => <div key={k} className="bg-muted rounded-lg px-3 py-2.5"><dt className="text-xs text-fg-subtle">{k}</dt><dd className="font-mono font-semibold text-fg mt-0.5">{v}</dd></div>)}
      </dl>
      {data.totals.count === 0 ? <EmptyState title="该周期无调用" /> : (
        <>
          <div style={{ height: 200 }} className="mb-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={daily}><CartesianGrid stroke={pal.grid} strokeDasharray="3 3" vertical={false} /><XAxis dataKey="day" stroke={pal.text} tick={{ fontSize: 11 }} interval="preserveStartEnd" /><YAxis stroke={pal.text} tick={{ fontSize: 11 }} width={48} />
                <Tooltip contentStyle={{ background: pal.card, border: `1px solid ${pal.line}`, borderRadius: 8, fontSize: 12 }} formatter={(v) => `${sym}${Number(v).toFixed(4)}`} />
                <Bar dataKey="amount" name="消费" fill={pal.primary} radius={[3, 3, 0, 0]} /></BarChart>
            </ResponsiveContainer>
          </div>
          <ul className="space-y-2">
            {data.models.slice(0, 8).map((m) => (
              <li key={m.model} className="flex items-center justify-between text-xs"><span className="font-mono text-fg">{m.model}</span><span className="text-fg-muted font-mono">{fmtInt(m.count)} 次 · {sym}{m.amount.toFixed(4)}</span></li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function Logs({ name, range, models }) {
  // model 放进 query：筛选变化会改变请求签名并自动回到第 1 页
  const list = useListQuery(`usage-logs-${name}-${range.start}-${range.end}`, (q) => usageApi.userLogs(name, { ...range, page: q.page, pageSize: q.pageSize, model: q.model || undefined }).then((r) => ({ list: r.page.list, total: r.page.total })),
    { page: 1, pageSize: 20, model: '' });
  const model = list.query.model;
  const cols = [
    { key: 'time', title: '时间', render: (l) => <span className="font-mono text-xs whitespace-nowrap">{l.time}</span> },
    { key: 'model', title: '模型', render: (l) => <span className="tag-default font-mono">{l.model}</span> },
    { key: 'promptTokens', title: 'Prompt', align: 'right', render: (l) => <span className="font-mono text-xs">{fmtInt(l.promptTokens)}</span> },
    { key: 'completionTokens', title: 'Completion', align: 'right', render: (l) => <span className="font-mono text-xs">{fmtInt(l.completionTokens)}</span> },
    { key: 'amount', title: '金额', align: 'right', render: (l) => <span className="font-mono text-xs">{l.amount.toFixed(6)}</span> },
    { key: 'useTime', title: '耗时', align: 'right', render: (l) => <span className="font-mono text-xs">{l.useTime}s</span> },
    { key: 'ip', title: 'IP', render: (l) => <span className="font-mono text-xs text-fg-muted">{l.ip || '-'}</span> },
  ];
  return (
    <DataTable columns={cols} rows={list.rows} rowKey="id" loading={list.loading} refreshing={list.refreshing} error={list.error} onRetry={list.reload}
      page={list.query.page} pageSize={list.query.pageSize} total={list.total} onPageChange={(p) => list.setQuery({ page: p }, { resetPage: false })} onPageSizeChange={(n) => list.setQuery({ pageSize: n })}
      toolbar={<label className="flex items-center gap-2 text-xs text-fg-muted">模型<CustomSelect size="sm" clearable value={model} onChange={(v) => list.setQuery({ model: v })} placeholder="全部模型" aria-label="按模型筛选" minWidth={150} options={models.map((m) => ({ value: m, label: m }))} /></label>}
      empty={{ title: model ? '该模型无调用记录' : '暂无调用记录', description: '该周期内没有符合条件的调用明细。' }} />
  );
}

export default function UserDetailModal({ user, range, onClose }) {
  const [tab, setTab] = useState('overview');
  return (
    <Modal open={!!user} onClose={onClose} title={user ? `${user.username} · ${range.start} ~ ${range.end}` : ''} width="max-w-4xl">
      {user && (
        <>
          <Tabs items={[{ key: 'overview', label: '概览' }, { key: 'logs', label: '调用明细' }]} value={tab} onChange={setTab} idPrefix="udetail" />
          <div id="udetail-panel" role="tabpanel">
            {tab === 'overview' ? <Overview name={user.username} range={range} /> : <Logs key={user.username} name={user.username} range={range} models={user.topModels.map((m) => m.model)} />}
          </div>
        </>
      )}
    </Modal>
  );
}
