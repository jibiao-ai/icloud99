import { SPEED, barClass, barHeight, rateTone } from './meta';
import StatusDot from '../StatusDot';
import Tooltip from '../Tooltip';
import { timeAgo } from '../../utils/format';

const BARS = 60;

export default function ChannelCard({ ch, onOpen }) {
  const sp = SPEED[ch.speed] || SPEED.unknown;
  const lt = ch.latest;
  const empty = BARS - ch.history.length;
  return (
    <article
      className="card p-3.5 fade-in min-w-0 cursor-pointer hover:border-fg-subtle transition-colors" tabIndex={0} role="button"
      aria-label={`${ch.name}，${sp.label}，可用率 ${ch.successRate}%`}
      onClick={() => onOpen(ch.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(ch.id); } }}
    >
      <div className="mb-2.5">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-fg truncate" title={ch.name}>{ch.name}</h4>
          <span className={`${sp.tag} shrink-0`}><StatusDot tone={sp.dot} pulse />{sp.label}</span>
        </div>
        <p className="text-[11px] text-fg-subtle font-mono truncate" title={ch.modelId}>{ch.modelId} · 倍率 {ch.rateMultiplier}x</p>
      </div>
      <div className="flex items-end justify-between mb-2.5 gap-2">
        <dl className="text-xs space-y-0.5">
          <div><dt className="inline text-fg-subtle">延迟 </dt><dd className="inline font-mono font-medium text-fg">{lt ? `${lt.responseTime}ms` : '-'}</dd></div>
          <div><dt className="inline text-fg-subtle">PING </dt><dd className="inline font-mono font-medium text-fg">{lt ? `${lt.ping}ms` : '-'}</dd></div>
        </dl>
        <span className={`text-xl font-bold ${ch.totalTests ? rateTone(ch.successRate) : 'text-fg-subtle'}`}>{ch.totalTests ? `${ch.successRate}%` : '--'}</span>
      </div>
      <p className="text-[11px] text-fg-subtle mb-1">{ch.totalTests ? `${ch.totalTests}次检测` : '暂无检测数据'}</p>
      <div className="spark" role="img" aria-label="最近 60 次检测结果">
        {ch.history.map((h, i) => (
          <Tooltip key={i} content={`${timeAgo(h.time)} · ${h.success ? '正常' : '失败'} · ${h.responseTime}ms`}>
            <i className={`${barClass(h)} w-full`} style={{ height: barHeight(h) }} />
          </Tooltip>
        ))}
        {Array.from({ length: empty }).map((_, i) => <i key={`e${i}`} className="bg-muted" style={{ height: 4 }} />)}
      </div>
    </article>
  );
}
