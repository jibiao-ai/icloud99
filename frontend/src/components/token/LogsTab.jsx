import { useMemo, useState } from 'react';
import { Eye } from 'lucide-react';
import { fmtDateTime, fmtInt } from '../../utils/format';
import CustomSelect from '../CustomSelect';
import DataTable from '../DataTable';
import Modal from '../Modal';
import { useClientTable } from '../../hooks/useClientTable';

const SORTS = [
  { value: 'time_desc', label: '时间倒序' }, { value: 'time_asc', label: '时间正序' },
  { value: 'cost_desc', label: '费用从高到低' }, { value: 'cost_asc', label: '费用从低到高' },
];
const SORT_MAP = { time_desc: { key: 'created_at', order: 'desc' }, time_asc: { key: 'created_at', order: 'asc' }, cost_desc: { key: 'quota', order: 'desc' }, cost_asc: { key: 'quota', order: 'asc' } };

function Item({ k, v, mono = true }) {
  return <div><dt className="text-xs text-fg-subtle mb-0.5">{k}</dt><dd className={`text-fg ${mono ? 'font-mono' : ''} break-all`}>{v ?? '-'}</dd></div>;
}

function Detail({ log, money, onClose }) {
  const o = log?.other_parsed || {};
  const ratios = [['模型倍率', o.model_ratio], ['补全倍率', o.completion_ratio], ['分组倍率', o.group_ratio], ['缓存倍率', o.cache_ratio], ['缓存Tokens', o.cache_tokens], ['计费来源', o.billing_source]].filter(([, v]) => v !== undefined);
  return (
    <Modal open={!!log} onClose={onClose} title="调用详情" width="max-w-2xl">
      {log && (
        <>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <Item k="时间" v={fmtDateTime(log.created_at * 1000)} />
            <Item k="费用" v={<span className="text-warning font-bold">{money.full(log.quota)}</span>} />
            <Item k="模型" v={log.model_name} />
            <Item k="分组" v={log.group || '-'} mono={false} />
            <Item k="用户" v={log.username || '-'} mono={false} />
            <Item k="令牌名称" v={log.token_name || '-'} mono={false} />
            <Item k="Prompt Tokens" v={fmtInt(log.prompt_tokens)} />
            <Item k="Completion Tokens" v={fmtInt(log.completion_tokens)} />
            <Item k="耗时" v={`${log.use_time || 0} 秒`} />
            <Item k="流式" v={log.is_stream ? '是' : '否'} mono={false} />
          </dl>
          {ratios.length > 0 && (
            <div className="mt-5 pt-5 border-t border-line">
              <h4 className="text-xs font-semibold text-fg-muted mb-3">计费参数</h4>
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">{ratios.map(([k, v]) => <div key={k} className="bg-muted rounded-lg px-3 py-2"><dt className="text-fg-subtle mb-0.5">{k}</dt><dd className="font-mono font-medium text-fg">{String(v)}</dd></div>)}</dl>
            </div>
          )}
          {o.request_path && <p className="mt-4 text-xs"><span className="text-fg-subtle">请求路径：</span><span className="font-mono text-fg-muted break-all">{o.request_path}</span></p>}
          {log.request_id && <p className="mt-2 text-xs"><span className="text-fg-subtle">Request ID：</span><span className="font-mono text-fg-muted break-all">{log.request_id}</span></p>}
        </>
      )}
    </Modal>
  );
}

export default function LogsTab({ logs, money }) {
  const [model, setModel] = useState('');
  const [sortKey, setSortKey] = useState('time_desc');
  const [detail, setDetail] = useState(null);
  const models = useMemo(() => [...new Set(logs.map((l) => l.model_name).filter(Boolean))].sort(), [logs]);
  const rows = useMemo(() => (model ? logs.filter((l) => l.model_name === model) : logs), [logs, model]);
  const t = useClientTable(rows, { sort: SORT_MAP[sortKey], pageSize: 10 });

  const cols = [
    { key: 'created_at', title: '时间', render: (l) => <span className="font-mono text-xs text-fg-muted whitespace-nowrap">{fmtDateTime(l.created_at * 1000)}</span> },
    { key: 'model_name', title: '模型', render: (l) => <span className="tag-default font-mono">{l.model_name}</span> },
    { key: 'prompt_tokens', title: 'Prompt', render: (l) => <span className="font-mono text-xs">{fmtInt(l.prompt_tokens)}</span> },
    { key: 'completion_tokens', title: 'Completion', render: (l) => <span className="font-mono text-xs">{fmtInt(l.completion_tokens)}</span> },
    { key: 'quota', title: '费用', render: (l) => <span className={`font-mono text-xs font-medium ${l.quota > 50000 ? 'text-warning' : ''}`}>{money.full(l.quota)}</span> },
    { key: 'use_time', title: '耗时', render: (l) => <span className="font-mono text-xs text-fg-muted">{l.use_time || 0}s</span> },
    { key: 'group', title: '分组', render: (l) => <span className="tag-primary">{l.group || '-'}</span> },
    { key: 'op', title: '详情', render: (l) => <button className="btn-ghost btn-sm text-primary" onClick={() => setDetail(l)}><Eye size={13} />查看</button> },
  ];

  return (
    <div className="fade-in">
      <DataTable
        columns={cols} rows={t.rows} rowKey="id" total={t.total} page={t.page} pageSize={t.pageSize}
        onPageChange={t.setPage} onPageSizeChange={t.setPageSize}
        toolbar={(
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-fg-muted">模型
              <CustomSelect size="sm" value={model} onChange={(v) => { setModel(v); t.setPage(1); }} aria-label="按模型筛选" minWidth={150}
                options={[{ value: '', label: '全部模型' }, ...models.map((m) => ({ value: m, label: m }))]} />
            </label>
            <label className="flex items-center gap-2 text-xs text-fg-muted">排序
              <CustomSelect size="sm" value={sortKey} onChange={(v) => { setSortKey(v); t.setSort(SORT_MAP[v]); }} aria-label="排序方式" options={SORTS} minWidth={130} />
            </label>
          </div>
        )}
        extra={<span className="text-xs text-fg-subtle">{model ? '筛选后' : '共'} {t.total} 条记录</span>}
        empty={{ title: model ? '该模型下没有日志' : '暂无日志记录', description: model ? '请更换模型筛选条件。' : '该令牌尚未产生调用记录。' }}
      />
      <Detail log={detail} money={money} onClose={() => setDetail(null)} />
    </div>
  );
}
