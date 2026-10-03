import { useMemo, useState } from 'react';

const cmp = (a, b) => {
  const an = a === null || a === undefined || a === '';
  const bn = b === null || b === undefined || b === '';
  if (an && bn) return 0;
  if (an) return 1; // 空值恒排最后
  if (bn) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'zh-CN');
};

/** 整表前端搜索/排序/分页。keywordFields 为参与搜索的字段名。 */
export function useClientTable(rows, { keywordFields = [], pageSize: initSize = 10, sort: initSort = null } = {}) {
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initSize);
  const [sort, setSort] = useState(initSort);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    let out = kw ? rows.filter((r) => keywordFields.some((f) => String(r[f] ?? '').toLowerCase().includes(kw))) : rows;
    if (sort?.key) {
      const dir = sort.order === 'asc' ? 1 : -1;
      out = [...out].sort((a, b) => {
        const av = a[sort.key], bv = b[sort.key];
        const aEmpty = av === null || av === undefined || av === '';
        const bEmpty = bv === null || bv === undefined || bv === '';
        if (aEmpty || bEmpty) return cmp(av, bv); // 空值不受方向影响
        return cmp(av, bv) * dir;
      });
    }
    return out;
  }, [rows, keyword, sort, keywordFields]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const cur = Math.min(page, pages);
  const pageRows = filtered.slice((cur - 1) * pageSize, cur * pageSize);

  return {
    rows: pageRows, all: filtered, total: filtered.length, page: cur, pageSize, sort, keyword,
    setKeyword: (v) => { setKeyword(v); setPage(1); },
    setPage, setPageSize: (n) => { setPageSize(n); setPage(1); },
    setSort: (s) => { setSort(s); setPage(1); },
  };
}
