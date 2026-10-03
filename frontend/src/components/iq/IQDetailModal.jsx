import Modal from '../Modal';
import SvgFrame from './SvgFrame';
import { RESULT, accountId, when } from './meta';
import { TIER_LABEL, TIER_TAG } from '../channels/meta';
import { fmtInt } from '../../utils/format';

export default function IQDetailModal({ t, onClose }) {
  const r = t ? RESULT[t.result] || RESULT.degraded : null;
  const hasSvg = t && t.svgCode && t.svgCode.includes('<svg');
  return (
    <Modal open={!!t} onClose={onClose} title="智力检测详情" width="max-w-3xl" footer={<button className="btn-default" onClick={onClose}>关闭</button>}>
      {t && (
        <>
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <span className={r.tag}>{r.label}</span>
            <span className={TIER_TAG[t.tier]}>{TIER_LABEL[t.tier] || t.tier}</span>
            <span className="font-mono text-xs text-fg-muted">{t.model}</span>
            <span className="font-mono text-xs text-fg-subtle ml-auto">{accountId(t.id, t.testedAt)}</span>
          </div>
          <div className="rounded-lg border border-line overflow-hidden mb-4" style={{ aspectRatio: '8 / 5' }}>
            {hasSvg ? <SvgFrame svg={t.svgCode} /> : <div className="w-full h-full flex items-center justify-center text-sm text-fg-subtle bg-muted">本次未生成 SVG</div>}
          </div>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            {[['检测时间', when(t.testedAt)], ['耗时', `${(t.responseTimeMs / 1000).toFixed(1)}s`], ['得分', t.score], ['推理 Tokens', fmtInt(t.reasoningTokens)], ['输入 Tokens', fmtInt(t.inputTokens)], ['输出 Tokens', fmtInt(t.outputTokens)]]
              .map(([k, v]) => <div key={k} className="bg-muted rounded-lg px-3 py-2"><dt className="text-fg-subtle mb-0.5">{k}</dt><dd className="font-mono font-medium text-fg">{v}</dd></div>)}
          </dl>
        </>
      )}
    </Modal>
  );
}
