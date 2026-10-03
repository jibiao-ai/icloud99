import { fmtMoney } from '../../utils/format';

// 令牌用量的金额口径来自系统参数（额度单位 / 货币符号），不再硬编码。
export function useMoney(portal) {
  const per = Number(portal['site.quota_per_unit']) || 500000;
  const sym = portal['site.currency_symbol'] || '¥';
  return {
    sym,
    short: (q) => fmtMoney((Number(q) || 0) / per, sym),
    full: (q) => fmtMoney((Number(q) || 0) / per, sym, 6),
  };
}
