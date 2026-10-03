import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartPalette } from '../../hooks/useChartPalette';
import EmptyState from '../EmptyState';

function Box({ title, sub, children, empty }) {
  return (
    <section className="card p-4">
      <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-fg">{title}</h3><span className="text-xs text-fg-subtle">{sub}</span></div>
      {empty ? <EmptyState title="暂无数据" description="该周期内没有消费记录。" /> : <div style={{ height: 260 }}>{children}</div>}
    </section>
  );
}

export default function Charts({ s }) {
  const pal = useChartPalette();
  const sym = s.currency.symbol;
  const daily = s.daily.map((d) => ({ day: d.day.slice(5), amount: d.amount }));
  const models = s.models.slice(0, 8).map((m) => ({ name: m.model, value: m.amount }));
  const tip = { contentStyle: { background: pal.card, border: `1px solid ${pal.line}`, borderRadius: 8, fontSize: 12 }, formatter: (v) => `${sym}${Number(v).toFixed(2)}` };
  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
      <div className="xl:col-span-2">
        <Box title="每日消费趋势" sub={`${s.period.days} 天`} empty={daily.every((d) => !d.amount)}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={daily} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={pal.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="day" stroke={pal.text} tick={{ fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis stroke={pal.text} tick={{ fontSize: 11 }} width={56} />
              <Tooltip {...tip} cursor={{ fill: pal.grid }} />
              <Bar dataKey="amount" name="消费" fill={pal.primary} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Box>
      </div>
      <Box title="模型消费 Top 8" sub="按金额" empty={models.length === 0}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={models} dataKey="value" nameKey="name" innerRadius={50} outerRadius={86} paddingAngle={2} stroke={pal.card}>
              {models.map((_, i) => <Cell key={i} fill={pal.series[i % pal.series.length]} />)}
            </Pie>
            <Tooltip {...tip} />
          </PieChart>
        </ResponsiveContainer>
      </Box>
    </div>
  );
}
