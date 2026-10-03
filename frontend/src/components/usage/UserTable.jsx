import { useMemo } from 'react';
import { Eye } from 'lucide-react';
import DataTable from '../DataTable';
import SearchInput from '../SearchInput';
import CustomSelect from '../CustomSelect';
import Checkbox from '../Checkbox';
import ExportButton from '../ExportButton';
import { usageApi } from '../../services/api';
import { fmtInt, fmtPct } from '../../utils/format';
import { useClientTable } from '../../hooks/useClientTable';

const KW = ['username', 'displayName'];

/** 用户账单表：前端搜索/排序/分页；筛选条件同时作为导出参数（导出 = 当前筛选结果）。 */
export default function UserTable({ s, filters, setFilters, onOpen, exportParams }) {
  const sym = s.currency.symbol;
  const rows = useMemo(() => s.users.filter((u) => (filters.hideZero ? u.quota > 0 : true) && (!filters.group || u.group === filters.group)), [s.users, filters.hideZero, filters.group]);
  const t = useClientTable(rows, { keywordFields: KW, pageSize: 10, sort: { key: 'amount', order: 'desc' } });
  const groups = useMemo(() => [...new Set(s.users.map((u) => u.group).filter(Boolean))].sort(), [s.users]);

  // 搜索关键字同步给导出：用受控的 keyword
  const kw = t.keyword;
  const month = (m) => ({ key: `m_${m}`, title: `${m.slice(0, 4)}年${m.slice(5)}月(${sym})`, align: 'right', render: (u) => <span className="font-mono text-xs">{u.monthAmounts[m]?.toFixed(2)}</span> });
  const cols = [
    { key: 'username', title: '用户', sortable: true, render: (u) => (<div className="min-w-0"><p className="font-medium text-fg truncate max-w-[160px]">{u.username}</p>{u.displayName && <p className="text-[11px] text-fg-subtle truncate max-w-[160px]">{u.displayName}</p>}</div>) },
    { key: 'group', title: '团队', sortable: true, render: (u) => <span className="tag-primary">{u.group || 'default'}</span> },
    ...(s.months.length > 1 ? s.months.map(month) : []),
    { key: 'amount', title: `合计(${sym})`, align: 'right', sortable: true, render: (u) => <span className="font-mono font-semibold">{u.amount.toFixed(4)}</span> },
    { key: 'share', title: '占比', align: 'right', sortable: true, render: (u) => <span className="font-mono text-xs text-fg-muted">{fmtPct(u.share)}</span> },
    { key: 'count', title: '调用', align: 'right', sortable: true, render: (u) => <span className="font-mono text-xs">{fmtInt(u.count)}</span> },
    { key: 'tokens', title: 'Tokens', align: 'right', sortable: true, render: (u) => <span className="font-mono text-xs">{fmtInt(u.tokens)}</span> },
    { key: 'balance', title: `余额(${sym})`, align: 'right', sortable: true, render: (u) => <span className="font-mono text-xs text-fg-muted">{u.balance.toFixed(2)}</span> },
    { key: 'op', title: '操作', sticky: 'right', render: (u) => <button className="btn-ghost btn-sm text-primary" onClick={() => onOpen(u)}><Eye size={13} />详情</button> },
  ];

  const hasFilter = !!(kw || filters.group || filters.hideZero);
  return (
    <DataTable
      columns={cols} rows={t.rows} rowKey="id" total={t.total} page={t.page} pageSize={t.pageSize}
      onPageChange={t.setPage} onPageSizeChange={t.setPageSize} sort={t.sort} onSortChange={t.setSort}
      toolbar={(
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput value={kw} onChange={t.setKeyword} placeholder="搜索用户名 / 显示名" width={230} />
          <CustomSelect size="sm" clearable value={filters.group} onChange={(v) => { setFilters({ ...filters, group: v }); t.setPage(1); }} placeholder="全部团队" aria-label="按团队筛选" minWidth={130}
            options={groups.map((g) => ({ value: g, label: g }))} />
          <Checkbox label="隐藏零消费" checked={filters.hideZero} onChange={(v) => { setFilters({ ...filters, hideZero: v }); t.setPage(1); }} />
        </div>
      )}
      extra={<ExportButton fn={usageApi.exportXlsx} params={exportParams({ keyword: kw })}>{hasFilter ? '导出当前筛选' : '导出 Excel'}</ExportButton>}
      empty={hasFilter ? { title: '没有符合筛选条件的用户', description: '请调整搜索关键字、团队或「隐藏零消费」。' } : { title: '该周期暂无用户账单', description: '该周期内没有任何用户产生消费，或尚未注册用户。' }}
    />
  );
}
