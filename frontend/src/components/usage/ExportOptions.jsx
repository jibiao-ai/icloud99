import { FileSpreadsheet } from 'lucide-react';
import Checkbox from '../Checkbox';
import CustomSelect from '../CustomSelect';

const ROWS = [2000, 5000, 10000, 20000, 50000].map((n) => ({ value: n, label: `最新 ${n.toLocaleString()} 条` }));

/** 导出选项：是否包含调用明细及行数上限。与筛选条件一起组成导出参数。 */
export default function ExportOptions({ value, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-fg-muted">
      <span className="inline-flex items-center gap-1.5"><FileSpreadsheet size={14} className="text-primary" />导出选项</span>
      <Checkbox label="包含调用明细" checked={value.details} onChange={(v) => onChange({ ...value, details: v })} />
      {value.details && <CustomSelect size="sm" value={value.maxRows} onChange={(v) => onChange({ ...value, maxRows: v })} options={ROWS} aria-label="明细行数上限" minWidth={140} />}
    </div>
  );
}
