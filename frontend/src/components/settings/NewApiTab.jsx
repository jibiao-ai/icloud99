import { useEffect, useState } from 'react';
import { PlugZap, Save } from 'lucide-react';
import { settingsApi } from '../../services/api';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../Toast';
import FormField from '../FormField';
import LoadingButton from '../LoadingButton';
import SecretInput from '../SecretInput';
import ErrorState from '../ErrorState';
import Skeleton from '../Skeleton';

/** New API 管理员账号：用于「用量统计」拉取全站账单。 */
export default function NewApiTab() {
  const { data, loading, error, reload } = useAsync(() => settingsApi.newapi(), []);
  const toast = useToast();
  const [f, setF] = useState(null);
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);
  useEffect(() => { if (data) setF({ ...data }); }, [data]);

  if (loading || !f) return error ? <ErrorState error={error} onRetry={reload} /> : <Skeleton className="h-64 w-full" />;
  const set = (k) => (v) => { setF({ ...f, [k]: v }); setErrs({ ...errs, [k]: '' }); };

  const save = async () => {
    setBusy(true);
    try { await settingsApi.saveNewapi({ baseUrl: f.baseUrl, username: f.username, password: f.password }); toast.success('New API 配置已保存'); setErrs({}); setResult(null); reload(); }
    catch (e) { if (e.fields) { setErrs(e.fields); toast.error('请检查标红的字段'); } else toast.error(e.message); }
    finally { setBusy(false); }
  };
  const test = async () => {
    setTesting(true); setResult(null);
    try { const r = await settingsApi.testNewapi(); setResult({ ok: true, text: `连接成功：管理员 uid=${r.uid}，共 ${r.totalUsers} 个用户` }); }
    catch (e) { setResult({ ok: false, text: e.message }); }
    finally { setTesting(false); }
  };

  return (
    <div className="w-full">
      <p className="text-xs text-fg-muted mb-4">「用量统计」通过该管理员账号登录 New API，读取全站用户与账单。需要 role ≥ 10 的管理员。密码加密存储，保存后不再回显。</p>
      <section className="card p-5 grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
        <FormField label="New API 地址" htmlFor="na-url" error={errs.baseUrl} required><input id="na-url" className={`field ${errs.baseUrl ? 'field-error' : ''}`} placeholder="https://api.example.com" value={f.baseUrl} onChange={(e) => set('baseUrl')(e.target.value)} /></FormField>
        <FormField label="管理员用户名" htmlFor="na-user" error={errs.username} required><input id="na-user" className={`field ${errs.username ? 'field-error' : ''}`} autoComplete="off" value={f.username} onChange={(e) => set('username')(e.target.value)} /></FormField>
        <FormField label="管理员密码" htmlFor="na-pass" error={errs.password} required><SecretInput id="na-pass" saved={f.saved} value={f.password} invalid={!!errs.password} onChange={set('password')} /></FormField>
        <div className="md:col-span-3 flex items-center gap-2 pt-1">
          <LoadingButton loading={busy} icon={Save} onClick={save}>保存</LoadingButton>
          <LoadingButton className="btn-default" loading={testing} disabled={!f.saved} icon={PlugZap} onClick={test}>测试连接</LoadingButton>
        </div>
        {!f.saved && <p className="hint md:col-span-3">请先保存配置，再测试连接。</p>}
        {result && <p role="status" className={`md:col-span-3 text-xs rounded-lg px-3 py-2 break-words ${result.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}>{result.text}</p>}
      </section>
    </div>
  );
}
