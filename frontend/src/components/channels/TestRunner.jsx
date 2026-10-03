import { useEffect, useRef } from 'react';
import { Play, Square } from 'lucide-react';
import { channelApi } from '../../services/api';
import { useAsync } from '../../hooks/useAsync';
import { useCan } from '../../hooks/useCan';
import { useToast } from '../Toast';

/**
 * 立即检测：由服务端后台任务执行（60 轮，每分钟 1 轮），关闭页面不会中断。
 * 本组件只负责启动 / 停止 / 展示进度，并在进度变化时通知父级刷新列表。
 */
export default function TestRunner({ onProgress }) {
  const can = useCan('channel:test');
  const toast = useToast();
  const { data: st, reload } = useAsync(() => channelApi.testStatus(), []);
  const last = useRef(0);

  useEffect(() => {
    if (!st?.running) return undefined;
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
  }, [st?.running, reload]);

  useEffect(() => {
    if (st && st.done !== last.current) { last.current = st.done; if (st.done > 0) onProgress?.(); }
  }, [st, onProgress]);

  const start = async () => {
    try { await channelApi.testStart({}); toast.info('已开始 60 轮渠道检测（每分钟 1 轮），可离开本页'); reload(); }
    catch (e) { toast.error(e.message); reload(); }
  };
  const stop = async () => {
    try { await channelApi.testStop(); toast.warning('已发送停止指令'); setTimeout(reload, 800); } catch (e) { toast.error(e.message); }
  };

  if (!can) return null;
  if (st?.running) {
    return (
      <button className="btn-danger btn-sm" onClick={stop} aria-label="停止检测">
        <Square size={13} />停止（{st.done}/{st.total}）
      </button>
    );
  }
  return <button className="btn-primary btn-sm" onClick={start}><Play size={13} />立即检测</button>;
}
