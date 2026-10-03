import { todayCST, ymd } from '../../utils/format';

// 周期预设：以北京时间自然日为口径，返回 { start, end }（YYYY-MM-DD，含首尾）。
const add = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export const PRESETS = [
  { key: 'today', label: '今日' },
  { key: 'yesterday', label: '昨日' },
  { key: '7d', label: '近7天' },
  { key: '30d', label: '近30天' },
  { key: 'month', label: '本月' },
  { key: 'lastMonth', label: '上月' },
  { key: 'quarter', label: '本季度' },
  { key: 'year', label: '今年' },
  { key: 'custom', label: '自定义' },
];

export function presetRange(key, now = todayCST()) {
  const y = now.getFullYear(), m = now.getMonth();
  switch (key) {
    case 'today': return { start: ymd(now), end: ymd(now) };
    case 'yesterday': { const d = add(now, -1); return { start: ymd(d), end: ymd(d) }; }
    case '7d': return { start: ymd(add(now, -6)), end: ymd(now) };
    case '30d': return { start: ymd(add(now, -29)), end: ymd(now) };
    case 'month': return { start: ymd(new Date(y, m, 1)), end: ymd(now) };
    case 'lastMonth': return { start: ymd(new Date(y, m - 1, 1)), end: ymd(new Date(y, m, 0)) };
    case 'quarter': { const q = Math.floor(m / 3) * 3; return { start: ymd(new Date(y, q, 1)), end: ymd(now) }; }
    case 'year': return { start: ymd(new Date(y, 0, 1)), end: ymd(now) };
    default: return null;
  }
}

/** 由起止日期反推当前命中的预设（用于刷新页面后高亮）。 */
export function matchPreset(start, end, now = todayCST()) {
  for (const p of PRESETS) {
    if (p.key === 'custom') continue;
    const r = presetRange(p.key, now);
    if (r.start === start && r.end === end) return p.key;
  }
  return 'custom';
}

export const MAX_DAYS = 400;

export function daysBetween(start, end) {
  const a = new Date(`${start}T00:00:00`), b = new Date(`${end}T00:00:00`);
  return Math.round((b - a) / 86400000) + 1;
}
