import { useMemo } from 'react';
import { Play, Square } from 'lucide-react';
import PeriodBar from '../usage/PeriodBar';
import CustomSelect from '../CustomSelect';
import FormField from '../FormField';
import LoadingButton from '../LoadingButton';

export const ROWS_OPTIONS = [
  { value: 100000, label: '10 万行 / 文件' },
  { value: 200000, label: '20 万行 / 文件' },
  { value: 300000, label: '30 万行 / 文件（推荐）' },
  { value: 500000, label: '50 万行 / 文件' },
  { value: 1000000, label: '100 万行 / 文件（Excel 上限附近）' },
];

/** 导出参数：周期（北京时间自然日）、可选的指定用户（不选 = 全部用户）、单文件行数。 */
export default function DetailForm({ value, onChange, accounts, errs, busy, running, onStart, onCancel }) {
  const opts = useMemo(() => accounts.map((a) => ({
    value: a.username,
    label: a.displayName && a.displayName !== a.username ? `${a.username}（${a.displayName}）` : a.username,
    hint: a.group ? `分组 ${a.group}` : undefined,
  })), [accounts]);
  const set = (patch) => onChange({ ...value, ...patch });

  return (
    <section aria-label="导出参数">
      <PeriodBar start={value.start} end={value.end} preset={value.preset} onChange={(p) => set({ start: p.start, end: p.end, preset: p.preset })} />
      <div className="card px-4 py-4 mb-4">
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="导出用户" error={errs.users} hint="不选择表示导出平台全部用户；最多可指定 50 个用户">
            <CustomSelect
              multiple searchable clearable width="100%" options={opts} value={value.users}
              onChange={(v) => set({ users: v })} placeholder="全部用户" aria-label="导出用户" disabled={running}
            />
          </FormField>
          <FormField label="单文件行数" hint="超过后自动拆分为多个 Excel 文件，下载时打包为 zip">
            <CustomSelect
              width="100%" options={ROWS_OPTIONS} value={value.rowsPerFile}
              onChange={(v) => set({ rowsPerFile: v })} aria-label="单文件行数" disabled={running}
            />
          </FormField>
        </div>
        {(errs.start || errs.end) && <p className="err-text mt-3" role="alert">{errs.start || errs.end}</p>}
        <div className="flex items-center gap-2 mt-4">
          {running
            ? <button type="button" className="btn-default" onClick={onCancel}><Square size={14} />取消导出</button>
            : <LoadingButton icon={Play} loading={busy} onClick={onStart}>开始导出</LoadingButton>}
          <span className="text-[11px] text-fg-subtle">按天分段并发拉取 New API 日志，单段过大会自动二分；导出在后台进行，可离开页面稍后回来下载</span>
        </div>
      </div>
    </section>
  );
}
