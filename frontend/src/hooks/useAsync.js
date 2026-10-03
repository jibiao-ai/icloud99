import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useAsync(fn, deps)：加载一次并可手动 reload。
 * 返回 { data, loading, refreshing, error, reload, setData }。首次 loading=true，之后刷新为 refreshing。
 */
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, refreshing: false, error: null });
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async () => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: s.data === null && !s.error, refreshing: s.data !== null, error: null }));
    try {
      const data = await fnRef.current();
      if (id === seq.current) setState({ data, loading: false, refreshing: false, error: null });
    } catch (error) {
      if (id === seq.current) setState((s) => ({ ...s, loading: false, refreshing: false, error }));
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run(); }, deps);

  const setData = useCallback((updater) => setState((s) => ({ ...s, data: typeof updater === 'function' ? updater(s.data) : updater })), []);
  return { ...state, reload: run, setData };
}
