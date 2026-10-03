import { useState } from 'react';
import { Boxes, Clock, Coins } from 'lucide-react';
import { fmtInt } from '../../utils/format';
import Pagination from '../Pagination';
import EmptyState from '../EmptyState';

const BAR = ['bg-primary', 'bg-info', 'bg-success', 'bg-warning', 'bg-danger', 'bg-fg-muted'];

export default function StatsTab({ order, stats, money }) {
  const [page, setPage] = useState(1);
  const size = 8;
  const max = order.length ? stats[order[0]].quota || 1 : 1;
  const slice = order.slice((page - 1) * size, page * size);
  return (
    <section className="card overflow-hidden fade-in">
      <div className="px-5 py-4 border-b border-line flex items-center gap-2"><Boxes size={16} className="text-primary" /><h3 className="text-sm font-semibold text-fg">模型用量分布</h3><span className="text-xs text-fg-subtle ml-auto">{order.length} 个模型</span></div>
      {order.length === 0 ? <EmptyState title="暂无模型使用数据" description="该令牌尚未产生调用记录。" /> : (
        <ul className="p-5 space-y-4">
          {slice.map((m, i) => {
            const s = stats[m];
            const pct = max > 0 ? (s.quota / max) * 100 : 0;
            return (
              <li key={m}>
                <div className="flex items-center justify-between mb-1.5 gap-3 flex-wrap">
                  <span className="flex items-center gap-2 text-sm font-mono font-medium text-fg"><span className={`w-2.5 h-2.5 rounded-full ${BAR[((page - 1) * size + i) % BAR.length]}`} />{m}</span>
                  <span className="flex items-center gap-4 text-xs text-fg-muted">
                    <span>{fmtInt(s.count)} 次</span>
                    <span className="inline-flex items-center gap-1"><Coins size={11} />{money.short(s.quota)}</span>
                    <span className="inline-flex items-center gap-1"><Clock size={11} />~{s.avgTime}s</span>
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden"><div className={`h-full rounded-full ${BAR[((page - 1) * size + i) % BAR.length]}`} style={{ width: `${pct}%` }} /></div>
                <div className="flex justify-between mt-1 text-[10px] text-fg-subtle font-mono"><span>Prompt: {fmtInt(s.prompt)} tok · Completion: {fmtInt(s.completion)} tok</span><span>{pct.toFixed(1)}%</span></div>
              </li>
            );
          })}
        </ul>
      )}
      {order.length > size && <Pagination page={page} pageSize={size} total={order.length} onPageChange={setPage} sizes={false} />}
    </section>
  );
}
