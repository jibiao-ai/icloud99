import { AlertTriangle } from 'lucide-react';
import CustomSelect from '../CustomSelect';
import DatePicker from '../DatePicker';
import { MAX_DAYS, PRESETS, daysBetween, presetRange } from './periods';

const OPTIONS = PRESETS.filter((p) => p.key !== 'custom').map((p) => ({ value: p.key, label: p.label }));

/** 周期选择：预设下拉（近7天/近30天/当月/上月/本季度/今年）+ 自定义起止日期。范围非法时给出 warning，由父级决定不发请求。 */
export default function PeriodBar({ start, end, preset, onChange }) {
  const bad = start && end && start > end ? '开始日期不能晚于结束日期' : start && end && daysBetween(start, end) > MAX_DAYS ? `统计周期最长 ${MAX_DAYS} 天` : '';
  const pick = (k) => onChange(k === 'custom' ? { preset: 'custom', start, end } : { preset: k, ...presetRange(k) });
  return (
    <div className="card px-4 py-3 mb-4">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="统计周期">
        <CustomSelect size="sm" width={132} aria-label="统计周期" options={OPTIONS} value={preset} placeholder="自定义" onChange={pick} />
        <DatePicker size="sm" width={132} value={start} max={end || undefined} aria-label="开始日期" invalid={!!bad} onChange={(v) => onChange({ preset: 'custom', start: v, end })} />
        <span className="text-xs text-fg-subtle">至</span>
        <DatePicker size="sm" width={132} value={end} min={start || undefined} aria-label="结束日期" invalid={!!bad} onChange={(v) => onChange({ preset: 'custom', start, end: v })} />
        <span className="text-[11px] text-fg-subtle ml-auto">北京时间 · 含首尾两天</span>
      </div>
      {bad && <p className="mt-2 text-xs text-warning flex items-center gap-1" role="alert"><AlertTriangle size={13} />{bad}</p>}
    </div>
  );
}
