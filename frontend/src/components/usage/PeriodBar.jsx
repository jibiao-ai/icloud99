import { AlertTriangle } from 'lucide-react';
import DatePicker from '../DatePicker';
import { MAX_DAYS, PRESETS, daysBetween, presetRange } from './periods';

/** 周期选择：预设 + 自定义起止日期。范围非法时给出 warning，由父级决定不发请求。 */
export default function PeriodBar({ start, end, preset, onChange }) {
  const bad = start && end && start > end ? '开始日期不能晚于结束日期' : start && end && daysBetween(start, end) > MAX_DAYS ? `统计周期最长 ${MAX_DAYS} 天` : '';
  return (
    <div className="card px-4 py-3 mb-4">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="统计周期">
        {PRESETS.map((p) => (
          <button
            key={p.key} type="button" aria-pressed={preset === p.key}
            onClick={() => (p.key === 'custom' ? onChange({ preset: 'custom', start, end }) : onChange({ preset: p.key, ...presetRange(p.key) }))}
            className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${preset === p.key ? 'bg-primary text-primary-text font-semibold' : 'bg-muted text-fg-muted hover:bg-hover'}`}
          >{p.label}</button>
        ))}
        <span className="mx-1 h-5 w-px bg-line hidden sm:block" />
        <DatePicker size="sm" width={132} value={start} max={end || undefined} aria-label="开始日期" invalid={!!bad} onChange={(v) => onChange({ preset: 'custom', start: v, end })} />
        <span className="text-xs text-fg-subtle">至</span>
        <DatePicker size="sm" width={132} value={end} min={start || undefined} aria-label="结束日期" invalid={!!bad} onChange={(v) => onChange({ preset: 'custom', start, end: v })} />
        <span className="text-[11px] text-fg-subtle ml-auto">北京时间 · 含首尾两天</span>
      </div>
      {bad && <p className="mt-2 text-xs text-warning flex items-center gap-1" role="alert"><AlertTriangle size={13} />{bad}</p>}
    </div>
  );
}
