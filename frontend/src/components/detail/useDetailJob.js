import { useCallback, useEffect, useRef, useState } from 'react';
import { detailApi } from '../../services/api';

/** 明细导出任务：进入页面即读取状态（可恢复进行中的任务），运行中每 2 秒轮询。 */
export function useDetailJob(enabled) {
  const [st, setSt] = useState(null);
  const [error, setError] = useState(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const r = await detailApi.status();
      if (alive.current) { setSt(r); setError(null); }
      return r;
    } catch (e) {
      if (alive.current) setError(e);
      return null;
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    if (enabled) refresh();
    return () => { alive.current = false; };
  }, [enabled, refresh]);

  const running = !!st?.running;
  useEffect(() => {
    if (!enabled || !running) return undefined;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [enabled, running, refresh]);

  return { st, error, running, refresh };
}
