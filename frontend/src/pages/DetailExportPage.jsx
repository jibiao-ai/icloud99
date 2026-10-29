import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileSpreadsheet } from 'lucide-react';
import { detailApi } from '../services/api';
import { useCan } from '../hooks/useCan';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import DetailForm from '../components/detail/DetailForm';
import DetailProgress from '../components/detail/DetailProgress';
import DetailFiles from '../components/detail/DetailFiles';
import { useDetailJob } from '../components/detail/useDetailJob';
import { MAX_DAYS, daysBetween, presetRange } from '../components/usage/periods';
import { useToast } from '../components/Toast';

/** 使用明细导出（仅管理员）：按周期分段导出全站（或指定）用户的调用明细为 Excel。 */
export default function DetailExportPage() {
  const can = useCan('detail:export');
  const toast = useToast();
  const def = useMemo(() => ({ preset: 'lastMonth', ...presetRange('lastMonth'), users: [], rowsPerFile: 300000 }), []);
  const [form, setForm] = useState(def);
  const [accounts, setAccounts] = useState([]);
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  const { st, error, running, refresh } = useDetailJob(can);

  useEffect(() => {
    if (!can) return undefined;
    let alive = true;
    detailApi.accounts().then((r) => { if (alive) setAccounts(r.accounts || []); }).catch(() => {});
    return () => { alive = false; };
  }, [can]);

  useEffect(() => {
    if (st?.phase === 'done' && !running) toast.success('明细导出完成，可下载文件');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st?.id, st?.phase]);

  const start = async () => {
    const bad = form.start > form.end ? '开始日期不能晚于结束日期' : daysBetween(form.start, form.end) > MAX_DAYS ? `导出周期最长 ${MAX_DAYS} 天` : '';
    if (bad) { setErrs({ start: bad }); return; }
    setBusy(true); setErrs({});
    try {
      await detailApi.start({ start: form.start, end: form.end, users: form.users, rowsPerFile: form.rowsPerFile });
      toast.info('导出已开始');
      await refresh();
    } catch (e) {
      if (e.fields) setErrs(e.fields);
      toast.error(e.message || '启动导出失败');
    } finally { setBusy(false); }
  };

  const cancel = async () => {
    try { await detailApi.cancel(); await refresh(); } catch (e) { toast.error(e.message); }
  };

  if (!can) {
    return <div className="card"><EmptyState icon={FileSpreadsheet} title="需要管理员权限" description="使用明细导出包含全站用户的调用记录，请先登录管理员账号。" action={<Link className="btn-primary" to="/settings">去登录</Link>} /></div>;
  }

  return (
    <div className="fade-in">
      <PageHeader
        icon={FileSpreadsheet} title="使用明细导出"
        description="按周期导出平台用户的 API 调用明细（北京时间）。数据量可能超过 New API 单次查询上限，系统会按天自动分段、必要时二分后再合并，写入 Excel 时按时间升序排列"
      />
      <DetailForm value={form} onChange={setForm} accounts={accounts} errs={errs} busy={busy} running={running} onStart={start} onCancel={cancel} />
      {error && <div className="card mb-4"><ErrorState error={error} onRetry={refresh} /></div>}
      {st && st.phase !== 'idle' && <DetailProgress st={st} />}
      {st && <DetailFiles st={st} />}
      <aside className="text-[11px] text-fg-subtle space-y-1">
        <p>列：时间、日志ID、用户ID、用户名、令牌名称、分组、模型、输入/输出/总 Token、额度、费用(USD)、类型、渠道、渠道名称、请求ID、上游请求ID、用时、是否流式、IP、内容。</p>
        <p>限制：同一时间仅允许一个导出任务；单次最多约 200 万行；文件在服务器保留 2 小时后自动清理。</p>
      </aside>
    </div>
  );
}
