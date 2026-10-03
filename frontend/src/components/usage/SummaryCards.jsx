import { CheckCircle2, AlertTriangle, Coins, Users, Zap, Hash } from 'lucide-react';
import StatCard from '../StatCard';
import { fmtInt } from '../../utils/format';

const money = (sym, n) => `${sym}${Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function SummaryCards({ s, loading }) {
  const sym = s?.currency?.symbol || '';
  const t = s?.totals;
  const rec = t?.reconciled;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      <StatCard loading={loading} icon={Coins} label="周期总消费" tone="primary" value={t ? money(sym, t.amount) : '-'}
        sub={t && rec !== null ? (
          <span className={`inline-flex items-center gap-1 ${rec ? 'text-success' : 'text-warning'}`}>
            {rec ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}{rec ? `已与后台对账一致` : `与后台差异（后台 ${money(sym, t.siteAmount)}）`}
          </span>
        ) : '未对账'} />
      <StatCard loading={loading} icon={Zap} label="调用次数" tone="info" value={t ? fmtInt(t.count) : '-'} sub={t ? `人均 ${money(sym, t.avgPerActiveUser)}` : ''} />
      <StatCard loading={loading} icon={Hash} label="Token 用量" tone="warning" value={t ? fmtInt(t.tokens) : '-'} />
      <StatCard loading={loading} icon={Users} label="有消费用户 / 注册用户" tone="success" value={t ? `${t.activeUsers} / ${t.registeredUsers}` : '-'} />
    </div>
  );
}
