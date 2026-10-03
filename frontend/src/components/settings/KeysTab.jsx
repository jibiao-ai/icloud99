import { useEffect, useState } from 'react';
import { Save, Trash2 } from 'lucide-react';
import { settingsApi } from '../../services/api';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../Toast';
import FormField from '../FormField';
import LoadingButton from '../LoadingButton';
import SecretInput, { MASK } from '../SecretInput';
import ConfirmModal from '../ConfirmModal';
import ErrorState from '../ErrorState';
import Skeleton from '../Skeleton';
import { PROVIDERS, TIER_LABEL, TIER_TAG } from '../channels/meta';

/** 上游 API 密钥（provider × 分组）。密钥保存后只显示 ******，留空/占位符表示不修改。 */
export default function KeysTab() {
  const { data, loading, error, reload } = useAsync(() => settingsApi.keys(), []);
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(null);
  const [delBusy, setDelBusy] = useState(false);
  useEffect(() => { if (data) setRows(data.map((r) => ({ ...r }))); }, [data]);

  if (loading || !rows) return error ? <ErrorState error={error} onRetry={reload} /> : <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>;

  const upd = (i, patch) => { setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r))); setErrs({}); };
  // 只提交有改动的行：已保存且密钥仍为占位符、地址未变的行无需提交
  const dirty = rows.filter((r, i) => r.baseUrl !== data[i].baseUrl || (r.apiKey !== MASK && r.apiKey !== ''));

  const save = async () => {
    if (dirty.length === 0) { toast.info('没有需要保存的改动'); return; }
    setBusy(true);
    try {
      await settingsApi.saveKeys(dirty.map((r) => ({ provider: r.provider, tier: r.tier, baseUrl: r.baseUrl, apiKey: r.apiKey })));
      toast.success(`已保存 ${dirty.length} 项配置`);
      setErrs({});
      reload();
    } catch (e) {
      if (e.fields) {
        // 后端字段路径 items.N.field 的 N 是提交数组下标，映射回行号
        const m = {};
        Object.entries(e.fields).forEach(([k, v]) => { const x = /^items\.(\d+)\.(\w+)$/.exec(k); if (x) m[`${rows.indexOf(dirty[Number(x[1])])}.${x[2]}`] = v; });
        setErrs(m); toast.error('请检查标红的字段');
      } else toast.error(e.message);
    } finally { setBusy(false); }
  };

  const remove = async () => {
    setDelBusy(true);
    try { await settingsApi.deleteKey(del.provider, del.tier); toast.success('已删除'); setDel(null); reload(); }
    catch (e) { toast.error(e.message); } finally { setDelBusy(false); }
  };

  return (
    <div className="w-full">
      <p className="text-xs text-fg-muted mb-4">为每个分组配置上游 API 地址与密钥，供渠道检测与智力检测使用。密钥加密存储，保存后不再回显。</p>
      {Object.keys(PROVIDERS).map((pv) => (
        <section key={pv} className="card p-5 mb-4">
          <h3 className="text-sm font-semibold text-fg mb-4">{PROVIDERS[pv].label}</h3>
          <div className="space-y-4">
            {rows.map((r, i) => r.provider !== pv ? null : (
              <div key={`${r.provider}/${r.tier}`} className="grid grid-cols-1 md:grid-cols-[88px_minmax(0,1fr)_minmax(0,1fr)_40px] gap-3 items-start">
                <div className="pt-2"><span className={TIER_TAG[r.tier]}>{TIER_LABEL[r.tier]}</span></div>
                <FormField error={errs[`${i}.baseUrl`]}>
                  <input className={`field ${errs[`${i}.baseUrl`] ? 'field-error' : ''}`} placeholder="上游 API 地址 https://…" aria-label={`${PROVIDERS[pv].label} ${r.tier} 地址`} value={r.baseUrl} onChange={(e) => upd(i, { baseUrl: e.target.value })} />
                </FormField>
                <FormField error={errs[`${i}.apiKey`]}>
                  <SecretInput saved={r.saved} value={r.apiKey} invalid={!!errs[`${i}.apiKey`]} aria-label={`${PROVIDERS[pv].label} ${r.tier} 密钥`} placeholder="sk-…" onChange={(v) => upd(i, { apiKey: v })} />
                </FormField>
                <div className="pt-0.5">{r.saved && <button className="btn-ghost btn-icon text-danger" aria-label={`删除 ${r.provider} ${r.tier} 密钥`} onClick={() => setDel(r)}><Trash2 size={16} /></button>}</div>
              </div>
            ))}
          </div>
        </section>
      ))}
      <div className="flex justify-end"><LoadingButton loading={busy} icon={Save} onClick={save}>保存密钥配置{dirty.length > 0 && `（${dirty.length}）`}</LoadingButton></div>
      <ConfirmModal open={!!del} danger title="删除上游密钥" message="删除后该分组的渠道检测与智力检测将无法执行，直到重新配置。" targets={del ? [`${del.provider}/${del.tier}`] : []}
        impactList={['对应分组的定时检测会记录为“未配置密钥”', '历史检测数据不受影响']} confirmText="确认删除" loading={delBusy} onConfirm={remove} onCancel={() => setDel(null)} />
    </div>
  );
}
