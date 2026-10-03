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
      className="card p-4 fade-in cursor-pointer hover:border-fg-subtle transition-colors" tabIndex={0} role="button"
      aria-label={`${ch.name}，${sp.label}，可用率 ${ch.successRate}%`}
      onClick={() => onOpen(ch.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(ch.id); } }}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-fg truncate">{ch.name}</h4>
          <p className="text-[11px] text-fg-subtle font-mono truncate">{ch.modelId}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-fg-subtle font-mono hidden sm:inline">倍率:{ch.rateMultiplier}x</span>
          <span className={sp.tag}><StatusDot tone={sp.dot} pulse />{sp.label}</span>
        </div>
      </div>
      <div className="flex items-end justify-between mb-3">
        <dl className="flex gap-4 text-xs">
          <div><dt className="inline text-fg-subtle">延迟 </dt><dd className="inline font-mono font-medium text-fg">{lt ? `${lt.responseTime}ms` : '-'}</dd></div>
          <div><dt className="inline text-fg-subtle">PING </dt><dd className="inline font-mono font-medium text-fg">{lt ? `${lt.ping}ms` : '-'}</dd></div>
        </dl>
        <span className={`text-2xl font-bold ${ch.totalTests ? rateTone(ch.successRate) : 'text-fg-subtle'}`}>{ch.totalTests ? `${ch.successRate}%` : '--'}</span>
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
