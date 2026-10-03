/** 指标卡。tone: primary|success|warning|danger|info。 */
const TONE = { primary: 'text-primary bg-primary-soft', success: 'text-success bg-success-soft', warning: 'text-warning bg-warning-soft', danger: 'text-danger bg-danger-soft', info: 'text-info bg-info-soft' };

export default function StatCard({ icon: Icon, label, value, sub, tone = 'primary', loading }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-fg-muted">{label}</span>
        {Icon && <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${TONE[tone]}`}><Icon size={16} /></span>}
      </div>
      {loading ? <div className="skeleton h-7 w-24" /> : <div className="text-xl font-bold text-fg break-all">{value}</div>}
      {sub && <div className="text-xs text-fg-subtle mt-1">{sub}</div>}
    </div>
  );
}
