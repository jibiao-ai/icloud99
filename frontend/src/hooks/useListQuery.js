import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

/**
 * 服务端列表：筛选/分页存入全局 store（切页返回保留）。
 * fetcher(query) => Promise<{ list, total }>。
 */
export function useListQuery(key, fetcher, initial = { page: 1, pageSize: 10 }) {
  const saved = useStore((s) => s.queries[key]);
  const setSaved = useStore((s) => s.setQuery);
  const query = { ...initial, ...(saved || {}) };
  const [state, setState] = useState({ rows: [], total: 0, loading: true, refreshing: false, error: null });
  const seq = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const sig = JSON.stringify(query);

  const load = useCallback(async () => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: s.rows.length === 0 && !s.error, refreshing: s.rows.length > 0, error: null }));
    try {
      const r = await fetcherRef.current(JSON.parse(sig));
      if (id !== seq.current) return;
      setState({ rows: r.list || [], total: r.total || 0, loading: false, refreshing: false, error: null });
    } catch (error) {
      if (id === seq.current) setState((s) => ({ ...s, loading: false, refreshing: false, error }));
    }
  }, [sig]);

  useEffect(() => { load(); }, [load]);

  const setQuery = useCallback((patch, opt = {}) => {
    setSaved(key, opt.resetPage === false ? patch : { page: 1, ...patch });
  }, [key, setSaved]);

  return { ...state, query, setQuery, reload: load };
}
