import { useState } from 'react';
import { Download } from 'lucide-react';
import LoadingButton from './LoadingButton';
import { useToast } from './Toast';
import { downloadBlob } from '../utils/format';

/** 导出 = 当前筛选结果：fn(params) => { blob, filename }，params 为当前筛选条件。 */
export default function ExportButton({ fn, params, children = '导出 Excel', disabled, className = 'btn-default' }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const run = async () => {
    setBusy(true);
    try {
      const { blob, filename } = await fn(params);
      downloadBlob(blob, filename);
      toast.success(`已导出 ${filename}`);
    } catch (e) {
      toast.error(e.message || '导出失败');
    } finally {
      setBusy(false);
    }
  };
  return <LoadingButton className={className} loading={busy} disabled={disabled} icon={Download} onClick={run}>{children}</LoadingButton>;
}
