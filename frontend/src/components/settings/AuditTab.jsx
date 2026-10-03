import { Link } from 'react-router-dom';
import { settingsApi } from '../../services/api';
import { useListQuery } from '../../hooks/useListQuery';
import { useAsync } from '../../hooks/useAsync';
import DataTable from '../DataTable';
import SearchInput from '../SearchInput';
import CustomSelect from '../CustomSelect';
import { fmtDateTime } from '../../utils/format';

const MODULE = { auth: '认证', settings: '系统设置', channel: '渠道', iq: '智力检测', usage: '用量统计', token: '令牌查询' };

/** 审计日志：服务端分页；详情已在后端递归脱敏。 */
export default function AuditTab() {
  const mods = useAsync(() => settingsApi.audit({ page: 1, pageSize: 1 }).then((r) => r.modules), []);
  const list = useListQuery('audit', (q) => settingsApi.audit({ page: q.page, pageSize: q.pageSize, module: q.module || undefined, keyword: q.keyword || undefined }).then((r) => r.page),
    { page: 1, pageSize: 20, module: '', keyword: '' });
  const cols = [
    { key: 'createdAt', title: '时间', render: (r) => <span className="font-mono text-xs whitespace-nowrap">{fmtDateTime(r.createdAt)}</span> },
    { key: 'module', title: '模块', render: (r) => <span className="tag-default">{MODULE[r.module] || r.module || '-'}</span> },
    { key: 'action', title: '动作', render: (r) => <span className="font-mono text-xs">{r.action}</span> },
    { key: 'target', title: '对象', render: (r) => (r.link ? <Link className="text-primary hover:underline text-xs break-all" to={r.link}>{r.target || '查看'}</Link> : <span className="text-xs break-all">{r.target || '-'}</span>) },
    { key: 'username', title: '用户', render: (r) => <span className="text-xs">{r.username}</span> },
    { key: 'ip', title: 'IP', render: (r) => <span className="font-mono text-xs text-fg-muted">{r.ip || '-'}</span> },
    { key: 'success', title: '结果', render: (r) => <span className={r.success ? 'tag-success' : 'tag-danger'}>{r.success ? '成功' : '失败'}</span> },
    { key: 'detail', title: '详情', render: (r) => <span className="text-[11px] text-fg-muted font-mono break-all line-clamp-2 max-w-[320px]" title={r.detail}>{r.detail || '-'}</span> },
  ];
  const q = list.query;
  return (
    <DataTable
      columns={cols} rows={list.rows} loading={list.loading} refreshing={list.refreshing} error={list.error} onRetry={list.reload}
      page={q.page} pageSize={q.pageSize} total={list.total} onPageChange={(p) => list.setQuery({ page: p }, { resetPage: false })} onPageSizeChange={(n) => list.setQuery({ pageSize: n })}
      toolbar={(
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput value={q.keyword} onChange={(v) => list.setQuery({ keyword: v })} placeholder="搜索动作 / 对象 / 用户" width={240} />
          <CustomSelect size="sm" clearable value={q.module} onChange={(v) => list.setQuery({ module: v })} placeholder="全部模块" aria-label="按模块筛选" minWidth={130}
            options={(mods.data || []).map((m) => ({ value: m, label: MODULE[m] || m }))} />
        </div>
      )}
      empty={q.module || q.keyword ? { title: '没有符合条件的日志', description: '请调整模块或搜索关键字。' } : { title: '暂无审计日志', description: '登录、保存配置、导出等操作会记录在这里。' }}
    />
  );
}
