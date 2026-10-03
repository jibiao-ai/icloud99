import { Clock } from 'lucide-react';
import { TIER_LABEL, TIER_TAG } from '../channels/meta';
import { fmtDateTime } from '../../utils/format';

export default function TierStats({ stats, schedule }) {
  const tiers = ['lite', 'standard', 'ultra'];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
      {tiers.map((t) => {
        const s = stats?.[t] || { pass: 0, works: 0, degraded: 0, total: 0 };
        const rate = s.total ? Math.round((s.pass / s.total) * 100) : 0;
        const next = schedule?.next?.[t];
        const w = (n) => (s.total ? (n / s.total) * 100 : 0);
        return (
          <section key={t} className="card p-4 fade-in">
            <div className="flex items-center justify-between mb-2">
              <span className={TIER_TAG[t]}>{TIER_LABEL[t]}</span>
              <span className={`text-lg font-bold ${rate >= 80 ? 'text-success' : rate >= 50 ? 'text-warning' : s.total ? 'text-danger' : 'text-fg-subtle'}`}>{s.total ? `${rate}%` : '--'}</span>
            </div>
            <p className="flex gap-3 text-[11px] text-fg-muted mb-1.5"><span>通过 {s.pass}</span><span>可疑 {s.works}</span><span>降智 {s.degraded}</span></p>
            <div className="h-1.5 rounded-full overflow-hidden flex bg-muted" aria-hidden="true">
              <div className="bg-success h-full" style={{ width: `${w(s.pass)}%` }} /><div className="bg-warning h-full" style={{ width: `${w(s.works)}%` }} /><div className="bg-danger h-full" style={{ width: `${w(s.degraded)}%` }} />
            </div>
            <p className="text-[10px] text-fg-subtle mt-2 flex items-center gap-1"><Clock size={10} />下次自动检测：{schedule?.enabled === false ? '已关闭' : next ? fmtDateTime(next).slice(5, 16) : '未安排'}</p>
          </section>
        );
      })}
    </div>
  );
}
