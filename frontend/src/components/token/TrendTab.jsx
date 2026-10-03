import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { LineChart as LineIcon } from 'lucide-react';
import { useChartPalette } from '../../hooks/useChartPalette';
import EmptyState from '../EmptyState';

export default function TrendTab({ daily, perUnit, symbol }) {
  const pal = useChartPalette();
  const data = daily.map((d) => ({ day: d.day.slice(5), cost: Number(((d.quota || 0) / perUnit).toFixed(4)), count: d.count }));
  const empty = data.every((d) => d.count === 0 && d.cost === 0);
  return (
    <section className="card overflow-hidden fade-in">
      <div className="px-5 py-4 border-b border-line flex items-center gap-2"><LineIcon size={16} className="text-primary" /><h3 className="text-sm font-semibold text-fg">每日用量趋势</h3><span className="text-xs text-fg-subtle ml-auto">最近 {data.length} 天</span></div>
      {empty ? <EmptyState title="暂无每日用量数据" description="最近 30 天内没有调用记录。" /> : (
        <div className="p-5" style={{ height: 360 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={pal.grid} strokeDasharray="3 3" />
              <XAxis dataKey="day" stroke={pal.text} tick={{ fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis yAxisId="l" stroke={pal.text} tick={{ fontSize: 11 }} />
              <YAxis yAxisId="r" orientation="right" stroke={pal.text} tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ background: pal.card, border: `1px solid ${pal.line}`, borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area yAxisId="l" type="monotone" dataKey="cost" name={`费用 (${symbol})`} stroke={pal.primary} fill={pal.primary} fillOpacity={0.15} />
              <Area yAxisId="r" type="monotone" dataKey="count" name="调用次数" stroke={pal.warn} fill={pal.warn} fillOpacity={0.12} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
