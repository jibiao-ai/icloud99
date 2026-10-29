import { Database } from 'lucide-react';
import { fmtDateTime, fmtInt } from '../../utils/format';

/** 本地明细库概况：提前同步的数据范围、后台同步状态与上游限流情况。 */
export default function LocalStatus({ info }) {
  if (!info) return null;
  const { stats = {}, auto = {}, config = {}, throttle = {} } = info;
  const has = stats.days > 0;
  const bg = !config.enabled ? '后台预同步已关闭' : auto.running ? `后台同步中${auto.day ? `（${auto.day}）` : ''}` : auto.lastAt ? `上次同步 ${fmtDateTime(auto.lastAt)}` : '等待首次同步';

  return (
    <section className="card px-4 py-3 mb-4" aria-label="本地明细库">
      <div className="flex items-center gap-2 text-sm font-medium text-fg">
        <Database size={16} className="text-primary" />
        <span>本地明细库</span>
        <span className="text-xs text-fg-muted font-normal">导出读取本地库，只会向上游补缺少的天，避免触发限流</span>
      </div>
      <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-fg-muted">
        <div><dt className="inline">已存 </dt><dd className="inline text-fg tabular-nums">{fmtInt(stats.rows)}</dd><dd className="inline"> 条 / {fmtInt(stats.days)} 天</dd></div>
        {has && <div><dt className="inline">范围 </dt><dd className="inline text-fg tabular-nums">{stats.firstDay} ~ {stats.lastDay}</dd></div>}
        <div><dt className="inline">后台预同步 </dt><dd className="inline text-fg">{bg}</dd>{config.enabled && <dd className="inline">（最近 {config.syncDays} 天，每 {config.intervalMinutes} 分钟）</dd>}</div>
        <div><dt className="inline">上游限速 </dt><dd className="inline text-fg tabular-nums">{fmtInt(config.ratePerMinute)}</dd><dd className="inline"> 次/分钟</dd></div>
        {throttle.hits > 0 && <div><dt className="inline">累计限流 </dt><dd className="inline text-fg tabular-nums">{fmtInt(throttle.hits)}</dd><dd className="inline"> 次</dd></div>}
      </dl>
      {auto.lastError && <p className="mt-2 text-xs text-danger break-words" role="alert">后台同步最近一次失败：{auto.lastError}</p>}
    </section>
  );
}
