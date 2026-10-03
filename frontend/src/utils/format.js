// 展示格式化工具。

export const fmtInt = (n) => Number(n || 0).toLocaleString('zh-CN');

/** quota → 金额（站点额度单位与货币符号均来自系统参数）。 */
export const quotaToMoney = (quota, perUnit = 500000) => (Number(quota) || 0) / (Number(perUnit) || 500000);

export function fmtMoney(v, symbol = '¥', digits) {
  const n = Number(v) || 0;
  if (digits !== undefined) return `${symbol}${n.toFixed(digits)}`;
  if (n >= 10000) return `${symbol}${(n / 10000).toFixed(2)}W`;
  if (n >= 1000) return `${symbol}${(n / 1000).toFixed(2)}K`;
  if (n >= 1) return `${symbol}${n.toFixed(2)}`;
  return `${symbol}${n.toFixed(4)}`;
}

export const fmtPct = (n, d = 1) => `${(Number(n || 0) * 100).toFixed(d)}%`;

export function fmtDateTime(v) {
  if (!v) return '-';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '-';
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function timeAgo(v) {
  const t = new Date(v).getTime();
  if (!t) return '-';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}秒前`;
  if (s < 3600) return `${Math.floor(s / 60)}分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)}小时前`;
  return `${Math.floor(s / 86400)}天前`;
}

export const ymd = (d) => {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** 北京时间今天（周期预设以东八区自然日为口径）。 */
export function todayCST() {
  const n = new Date(Date.now() + (new Date().getTimezoneOffset() + 480) * 60000);
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
