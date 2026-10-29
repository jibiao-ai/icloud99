import { useState } from 'react';
import { Archive, Download, FileSpreadsheet } from 'lucide-react';
import LoadingButton from '../LoadingButton';
import { useToast } from '../Toast';
import { detailApi } from '../../services/api';
import { downloadBlob, fmtDateTime, fmtInt } from '../../utils/format';

const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** 导出结果：逐个下载，多文件时可一键打包 zip 下载。 */
export default function DetailFiles({ st }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const files = st.files || [];
  if (st.phase !== 'done') return null;

  const get = async (key) => {
    setBusy(key);
    try {
      const { blob, filename } = await detailApi.download(key);
      downloadBlob(blob, filename);
    } catch (e) {
      toast.error(e.message || '下载失败');
    } finally { setBusy(''); }
  };
  const total = files.reduce((s, f) => s + f.rows, 0);

  return (
    <section className="card mb-4" aria-label="导出文件">
      <header className="px-4 py-3 border-b border-line flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-fg">导出文件（{files.length} 个 · 共 {fmtInt(total)} 行）</h3>
        {st.expiresAt && <span className="text-[11px] text-fg-subtle">文件保留至 {fmtDateTime(st.expiresAt)}，请及时下载</span>}
        {files.length > 1 && <LoadingButton className="btn-primary btn-sm ml-auto" icon={Archive} loading={busy === 'all'} onClick={() => get('all')}>全部打包下载 (zip)</LoadingButton>}
      </header>
      <ul className="divide-y divide-line">
        {files.map((f) => (
          <li key={f.name} className="px-4 py-2.5 flex items-center gap-3 text-sm">
            <FileSpreadsheet size={16} className="text-success shrink-0" />
            <span className="min-w-0 flex-1 truncate text-fg" title={f.name}>{f.name}</span>
            <span className="text-xs text-fg-muted tabular-nums whitespace-nowrap">{fmtInt(f.rows)} 行 · {size(f.size)}</span>
            <LoadingButton className="btn-default btn-sm" icon={Download} loading={busy === f.name} onClick={() => get(f.name)}>下载</LoadingButton>
          </li>
        ))}
      </ul>
    </section>
  );
}
