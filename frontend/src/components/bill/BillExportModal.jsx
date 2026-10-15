import { useEffect, useMemo, useState } from 'react';
import { FileText } from 'lucide-react';
import Modal from '../Modal';
import FormField from '../FormField';
import CustomSelect from '../CustomSelect';
import LoadingButton from '../LoadingButton';
import ErrorState from '../ErrorState';
import { useToast } from '../Toast';
import { billApi } from '../../services/api';
import { downloadBlob } from '../../utils/format';
import BillEditor from './BillEditor';
import { monthOptions, money, payableOf, toEdit, toPayload } from './billDoc';

/** 账单导出（仅管理员）：选账号与月份 -> 生成草稿 -> 在线修改/定制 -> 导出 PDF。 */
export default function BillExportModal({ open, onClose, defaultAccount }) {
  const toast = useToast();
  const monthOpts = useMemo(monthOptions, []);
  const [accounts, setAccounts] = useState([]);
  const [account, setAccount] = useState('');
  const [months, setMonths] = useState([monthOpts[1].value]);
  const [doc, setDoc] = useState(null);
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    setDoc(null); setErrs({}); setError(null); setAccount(defaultAccount || '');
    let alive = true;
    billApi.accounts().then((r) => { if (alive) setAccounts(r.accounts || []); }).catch((e) => { if (alive) setError(e); });
    return () => { alive = false; };
  }, [open, defaultAccount]);

  const accOpts = useMemo(() => accounts.map((a) => ({ value: a.username, label: a.displayName && a.displayName !== a.username ? `${a.username}（${a.displayName}）` : a.username, hint: a.group ? `分组 ${a.group}` : undefined })), [accounts]);

  const gen = async () => {
    setBusy('draft'); setErrs({}); setError(null);
    try {
      const d = await billApi.draft({ account, months: [...months].sort().join(',') });
      setDoc(toEdit(d));
    } catch (e) {
      if (e.fields) setErrs(e.fields); else setError(e);
      toast.error(e.message || '生成账单草稿失败');
    } finally { setBusy(''); }
  };

  const exportPdf = async () => {
    setBusy('export'); setErrs({});
    try {
      const { blob, filename } = await billApi.exportPdf(toPayload(doc));
      downloadBlob(blob, filename);
      toast.success(`已导出 ${filename}`);
    } catch (e) {
      if (e.fields) setErrs(e.fields);
      toast.error(e.message || '导出失败');
    } finally { setBusy(''); }
  };

  const total = doc ? doc.months.reduce((s, m) => s + payableOf(m), 0) : 0;
  const footer = doc ? (
    <>
      <span className="mr-auto text-xs text-fg-muted self-center">本期应付合计 <b className="text-fg tabular-nums">{doc.currency} {money(total)}</b></span>
      <button type="button" className="btn-default" onClick={() => setDoc(null)}>重新选择</button>
      <LoadingButton icon={FileText} loading={busy === 'export'} onClick={exportPdf}>导出 PDF</LoadingButton>
    </>
  ) : (
    <>
      <button type="button" className="btn-default" onClick={onClose}>取消</button>
      <LoadingButton loading={busy === 'draft'} disabled={!account || months.length === 0} onClick={gen}>生成账单</LoadingButton>
    </>
  );

  return (
    <Modal open={open} onClose={onClose} title="导出账单 PDF" icon={FileText} width={doc ? 'max-w-5xl' : 'max-w-lg'} footer={footer}>
      {doc ? <BillEditor doc={doc} setDoc={setDoc} errs={errs} monthOpts={monthOpts} /> : (
        <div className="space-y-4">
          <p className="text-xs text-fg-muted">按账号和月份生成账单草稿，包含每个月的开始/截止日期与金额；生成后可在线修改任何内容再导出为 PDF。当前月份截止日期为今天。</p>
          {error && <ErrorState error={error} />}
          <FormField label="账号" required error={errs.account}>
            <CustomSelect searchable width="100%" options={accOpts} value={account} onChange={setAccount} placeholder="选择要出账的账号" aria-label="账号" />
          </FormField>
          <FormField label="账单月份（可多选，最多 12 个月）" required error={errs.months}>
            <CustomSelect multiple width="100%" options={monthOpts} value={months} onChange={setMonths} placeholder="选择月份" aria-label="账单月份" />
          </FormField>
        </div>
      )}
    </Modal>
  );
}
