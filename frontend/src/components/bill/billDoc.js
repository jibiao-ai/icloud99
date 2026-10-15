// 账单草稿的编辑态转换：金额在编辑时用字符串，提交时转数字。
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
export const money = (v) => num(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const payableOf = (m) => Math.max(0, Math.round((num(m.total) - num(m.discount)) * 100) / 100);

export const toEdit = (d) => ({
  ...d,
  months: (d.months || []).map((m) => ({ ...m, total: String(m.total ?? 0), discount: String(m.discount ?? 0) })),
  items: (d.items || []).map((i) => ({ ...i, amount: String(i.amount ?? 0) })),
});

export const toPayload = (d) => ({
  ...d,
  months: d.months.map((m) => ({ ...m, total: num(m.total), discount: num(m.discount), payable: payableOf(m) })),
  items: d.items.map((i) => ({ ...i, amount: num(i.amount) })),
});

/** 最近 12 个月（含当月）选项，北京时间。 */
export function monthOptions() {
  const cst = new Date(Date.now() + 8 * 3600 * 1000);
  let y = cst.getUTCFullYear(); let m = cst.getUTCMonth() + 1;
  const out = [];
  for (let i = 0; i < 12; i += 1) {
    const v = `${y}-${String(m).padStart(2, '0')}`;
    out.push({ value: v, label: `${y} 年 ${String(m).padStart(2, '0')} 月` });
    m -= 1; if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}
