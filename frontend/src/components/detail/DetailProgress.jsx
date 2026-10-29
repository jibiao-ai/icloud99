import { AlertTriangle, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { fmtInt } from '../../utils/format';

const PHASE = {
  sync: { icon: Loader2, spin: true, tone: 'text-primary', text: '正在把缺少的天同步到本地库' },
  write: { icon: Loader2, spin: true, tone: 'text-primary', text: '正在从本地库写入 Excel' },
  done: { icon: CheckCircle2, tone: 'text-success', text: '导出完成' },
  failed: { icon: XCircle, tone: 'text-danger', text: '导出失败' },
  canceled: { icon: XCircle, tone: 'text-warning', text: '已取消' },
  expired: { icon: AlertTriangle, tone: 'text-warning', text: '文件已过期，请重新导出' },
};

const fmtSec = (s) => (s >= 60 ? `${Math.floor(s / 60)} 分 ${s % 60} 秒` : `${s || 0} 秒`);

/** 任务进度：阶段、行数/预估、分段数、耗时、告警。 */
export default function DetailProgress({ st }) {
  const meta = PHASE[st.phase];
  if (!meta) return null;
  const Icon = meta.icon;
  const rows = st.rows || 0;
  const syncing = st.phase === 'sync';
  const writing = st.phase === 'write' || st.phase === 'done';
  const pct = syncing
    ? (st.daysTotal > 0 ? Math.floor((st.daysDone / st.daysTotal) * 100) : 0)
    : (st.estimate > 0 ? Math.min(100, Math.floor((rows / st.estimate) * 100)) : 0);
  const showBar = syncing || writing;
  const users = st.users?.length ? `${st.users.length} 个用户` : '全部用户';
  const paused = st.running && st.pausedSec > 0;

  return (
    <section className="card px-4 py-4 mb-4" aria-label="导出进度" aria-live="polite">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon size={17} className={`${meta.tone} ${meta.spin ? 'spin' : ''}`} />
        <span className="text-fg">{meta.text}</span>
        <span className="text-xs text-fg-muted font-normal">{st.start} ~ {st.end} · {users}</span>
      </div>
      {showBar && (
        <div className="mt-3">
          <div className="h-2 rounded-full bg-muted overflow-hidden" role="progressbar" aria-valuenow={st.phase === 'done' ? 100 : pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-primary transition-all" style={{ width: `${st.phase === 'done' ? 100 : pct}%` }} />
          </div>
          <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-fg-muted">
            {syncing ? (
              <>
                <div><dt className="inline">同步天数 </dt><dd className="inline text-fg tabular-nums">{fmtInt(st.daysDone)} / {fmtInt(st.daysTotal)}</dd></div>
                <div><dt className="inline">本地库已有 </dt><dd className="inline text-fg tabular-nums">{fmtInt(st.daysCached)}</dd><dd className="inline"> 天（跳过）</dd></div>
                {st.syncDay && <div><dt className="inline">当前 </dt><dd className="inline text-fg tabular-nums">{st.syncDay}</dd></div>}
                <div><dt className="inline">分段 </dt><dd className="inline text-fg tabular-nums">{fmtInt(st.segDone)} / {fmtInt(st.segTotal)}</dd></div>
                <div><dt className="inline">自动二分 </dt><dd className="inline text-fg tabular-nums">{fmtInt(st.splits)}</dd><dd className="inline"> 次</dd></div>
              </>
            ) : (
              <div><dt className="inline">已写入 </dt><dd className="inline text-fg tabular-nums">{fmtInt(rows)}</dd><dd className="inline"> / {fmtInt(st.estimate)} 行</dd></div>
            )}
            <div><dt className="inline">耗时 </dt><dd className="inline text-fg tabular-nums">{fmtSec(st.elapsedSec)}</dd></div>
          </dl>
        </div>
      )}
      {paused && (
        <p className="mt-3 text-xs text-warning bg-warning-soft border border-warning rounded-lg px-3 py-2" role="status">
          上游接口触发限流（429），已自动暂停，约 {fmtSec(st.pausedSec)}后继续，无需操作；已同步完成的天不会丢失。累计限流 {fmtInt(st.rateHits)} 次。
        </p>
      )}
      {st.error && st.phase !== 'canceled' && <p className="mt-3 text-xs text-danger break-words" role="alert">{st.error}</p>}
      {st.warnings?.length > 0 && (
        <ul className="mt-3 text-xs text-warning bg-warning-soft border border-warning rounded-lg px-3 py-2 space-y-1" role="alert">
          {st.warnings.slice(0, 5).map((w) => <li key={w}>{w}</li>)}
          {st.warnings.length > 5 && <li>另有 {st.warnings.length - 5} 条告警</li>}
        </ul>
      )}
    </section>
  );
}
