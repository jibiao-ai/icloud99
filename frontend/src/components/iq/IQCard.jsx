import { Bike, Timer } from 'lucide-react';
import SvgFrame from './SvgFrame';
import { RESULT, when } from './meta';
import { TIER_LABEL, TIER_TAG } from '../channels/meta';

export default function IQCard({ t, onOpen }) {
  const r = RESULT[t.result] || RESULT.degraded;
  const hasSvg = t.svgCode && t.svgCode.length > 50 && t.svgCode.includes('<svg');
  return (
    <article className="card overflow-hidden fade-in cursor-pointer hover:border-fg-subtle transition-colors" tabIndex={0} role="button"
      aria-label={`${TIER_LABEL[t.tier]} ${r.label}`} onClick={() => onOpen(t)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(t); }}>
      <div className="flex items-center justify-between px-2.5 py-1.5 text-[10px] text-fg-subtle bg-muted border-b border-line">
        <span className="font-mono truncate">{when(t.testedAt)}</span>
        <span className={`${TIER_TAG[t.tier]} ml-1 shrink-0`}>{TIER_LABEL[t.tier] || t.tier}</span>
      </div>
      <div className="relative bg-muted" style={{ aspectRatio: '8 / 5' }}>
        {hasSvg ? <SvgFrame svg={t.svgCode} inert /> : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-fg-subtle"><Bike size={28} /><span className="text-xs">无 SVG 结果</span></div>
        )}
        <span className={`${r.tag} absolute top-1.5 right-1.5`}>{r.label}</span>
      </div>
      <div className="px-2.5 py-2 flex items-center justify-between text-[11px] text-fg-muted">
        <span className="font-mono truncate">{t.model}</span>
        <span className="inline-flex items-center gap-1 shrink-0"><Timer size={11} />{(t.responseTimeMs / 1000).toFixed(1)}s</span>
      </div>
    </article>
  );
}
