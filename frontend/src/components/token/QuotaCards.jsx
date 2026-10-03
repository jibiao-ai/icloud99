import { CheckCircle2, Coins, Gauge, Wallet } from 'lucide-react';
import StatCard from '../StatCard';
import { fmtDateTime } from '../../utils/format';

export default function QuotaCards({ info, money }) {
  const granted = info.total_granted || 0;
  const used = info.total_used || 0;
  const avail = info.total_available || 0;
  const pct = granted > 0 ? (used / granted) * 100 : 0;
  const tone = pct > 90 ? 'danger' : pct > 70 ? 'warning' : 'success';
  const unlimited = !!info.unlimited_quota;
  const expire = info.expires_at > 0 ? fmtDateTime(info.expires_at * 1000) : '永不过期';
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <StatCard icon={Wallet} label="总额度" tone="info" value={unlimited ? '无限' : money.full(granted)} />
        <StatCard icon={Coins} label="已用额度" tone="primary" value={money.full(used)} />
        <StatCard icon={CheckCircle2} label="剩余额度" tone={tone} value={unlimited ? '无限' : money.full(avail)} />
        <StatCard icon={Gauge} label="过期时间" tone="warning" value={<span className="text-base">{expire}</span>} />
      </div>
      {!unlimited && (
        <div className="card p-4 mb-4">
          <div className="flex items-center justify-between mb-2 text-xs"><span className="font-medium text-fg-muted">额度使用进度</span><span className="font-mono font-bold text-fg">{pct.toFixed(1)}%</span></div>
          <div className="h-2 rounded-full bg-muted overflow-hidden" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
            <div className={`h-full rounded-full ${tone === 'danger' ? 'bg-danger' : tone === 'warning' ? 'bg-warning' : 'bg-success'}`} style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
        </div>
      )}
    </>
  );
}
