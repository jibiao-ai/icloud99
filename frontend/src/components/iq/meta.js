import { fmtDateTime } from '../../utils/format';

export const RESULT = {
  pass: { label: '智力通过', tag: 'tag-success', bar: 'bg-success' },
  works: { label: '可疑作品', tag: 'tag-warning', bar: 'bg-warning' },
  degraded: { label: '降智记录', tag: 'tag-danger', bar: 'bg-danger' },
};

/** 展示用编号：由记录 ID 与时间派生（非敏感）。 */
export function accountId(id, testedAt) {
  const d = new Date(testedAt);
  const p = (n) => String(n).padStart(2, '0');
  return `YQ${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-${String(id).padStart(4, '0')}`;
}

export const when = fmtDateTime;
