import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { settingsApi } from '../../services/api';
import { useAsync } from '../../hooks/useAsync';
import { useStore } from '../../store';
import { useToast } from '../Toast';
import FormField from '../FormField';
import LoadingButton from '../LoadingButton';
import Switch from '../Switch';
import ErrorState from '../ErrorState';
import Skeleton from '../Skeleton';
import CustomSelect from '../CustomSelect';

const HOURS = Array.from({ length: 25 }, (_, i) => ({ value: String(i), label: `${String(i).padStart(2, '0')}:00` }));

function Section({ title, desc, children }) {
  return (
    <section className="card p-5 mb-4">
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {desc && <p className="text-xs text-fg-muted mt-0.5 mb-4">{desc}</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{children}</div>
    </section>
  );
}

/** 系统参数：所有业务参数在页面录入并落库（铁律1）。主色保存后立即生效。 */
export default function SystemTab() {
  const { data, loading, error, reload } = useAsync(() => settingsApi.get(), []);
  const toast = useToast();
  const loadPortal = useStore((s) => s.loadPortal);
  const [f, setF] = useState(null);
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setF(data); }, [data]);

  if (loading || !f) return error ? <ErrorState error={error} onRetry={reload} /> : <div className="space-y-3"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>;
  const set = (k) => (v) => { setF({ ...f, [k]: v }); setErrs({ ...errs, [k]: '' }); };
  const inp = (k, props = {}) => (
    <input id={`s-${k}`} className={`field ${errs[k] ? 'field-error' : ''}`} value={f[k] ?? ''} onChange={(e) => set(k)(e.target.value)} {...props} />
  );

  const save = async () => {
    setBusy(true);
    try {
      await settingsApi.save(f);
      toast.success('系统参数已保存');
      setErrs({});
      loadPortal();
    } catch (e) {
      if (e.fields) { setErrs(e.fields); toast.error('请检查标红的字段'); } else toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-4xl">
      <Section title="站点与展示" desc="影响页面名称、主题色以及令牌用量的金额换算。">
        <FormField label="站点名称" htmlFor="s-site.name" error={errs['site.name']}>{inp('site.name')}</FormField>
        <FormField label="主题色" htmlFor="s-site.primary_color" error={errs['site.primary_color']} hint="格式 #RRGGBB，保存后全站立即生效">
          <div className="flex items-center gap-2">
            <span className="w-9 h-9 rounded-lg border border-line shrink-0" style={{ background: /^#[0-9a-fA-F]{6}$/.test(f['site.primary_color']) ? f['site.primary_color'] : 'transparent' }} aria-hidden="true" />
            {inp('site.primary_color', { placeholder: '#RRGGBB' })}
          </div>
        </FormField>
        <FormField label="额度换算（quota / 1 单位）" htmlFor="s-site.quota_per_unit" error={errs['site.quota_per_unit']} hint="New API 默认 500000">{inp('site.quota_per_unit', { inputMode: 'numeric' })}</FormField>
        <FormField label="货币符号" htmlFor="s-site.currency_symbol" error={errs['site.currency_symbol']}>{inp('site.currency_symbol')}</FormField>
      </Section>

      <Section title="外部服务地址" desc="地址为空则对应功能显示“未配置”提示。">
        <FormField label="令牌查询的 New API 地址" htmlFor="s-site.token_base_url" error={errs['site.token_base_url']} hint="用量查询页面使用访客自带的令牌 Key 访问该地址">{inp('site.token_base_url', { placeholder: 'https://api.example.com' })}</FormField>
        <FormField label="GPT 智商雷达页面地址" htmlFor="s-radar.url" error={errs['radar.url']} hint="雷达页以 iframe 嵌入；其中的鉴权参数由你自行在地址里提供">{inp('radar.url', { placeholder: 'https://…' })}</FormField>
      </Section>

      <Section title="渠道检测" desc="服务端定时对所有渠道做可用性检测，不依赖浏览器常开。">
        <FormField label="启用定时检测"><Switch aria-label="启用定时检测" checked={f['monitor.enabled'] === '1'} onChange={(v) => set('monitor.enabled')(v ? '1' : '0')} /></FormField>
        <FormField label="检测间隔（分钟）" htmlFor="s-monitor.interval_minutes" error={errs['monitor.interval_minutes']} hint="5 ~ 1440">{inp('monitor.interval_minutes', { inputMode: 'numeric' })}</FormField>
        <FormField label="历史保留（天）" htmlFor="s-monitor.retention_days" error={errs['monitor.retention_days']} hint="超出的检测记录会被自动清理">{inp('monitor.retention_days', { inputMode: 'numeric' })}</FormField>
      </Section>

      <Section title="智力检测" desc="自动检测在北京时间的时间窗口内按小时轮转 Lite / Standard / Ultra。">
        <FormField label="启用自动检测"><Switch aria-label="启用自动检测" checked={f['iq.enabled'] === '1'} onChange={(v) => set('iq.enabled')(v ? '1' : '0')} /></FormField>
        <FormField label="检测模型" htmlFor="s-iq.model" error={errs['iq.model']}>{inp('iq.model')}</FormField>
        <FormField label="窗口起始" error={errs['iq.start_hour']}><CustomSelect value={f['iq.start_hour']} onChange={set('iq.start_hour')} options={HOURS.slice(0, 24)} aria-label="窗口起始小时" width="100%" /></FormField>
        <FormField label="窗口结束（不含）" error={errs['iq.end_hour']}><CustomSelect value={f['iq.end_hour']} onChange={set('iq.end_hour')} options={HOURS.slice(1)} aria-label="窗口结束小时" width="100%" /></FormField>
      </Section>

      <div className="flex justify-end"><LoadingButton loading={busy} icon={Save} onClick={save}>保存系统参数</LoadingButton></div>
    </div>
  );
}
