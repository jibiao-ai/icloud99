package detail

import (
	"context"
	"fmt"
	"time"

	"icloud99/internal/newapi"
	"icloud99/internal/usage"
)

// 同步参数。
const (
	// syncOverlap 增量同步时向前回溯的秒数，覆盖上次拉取瞬间尚在写入的日志（upsert 幂等，重复无害）。
	syncOverlap = 300
	// settleSecs 一天刚结束的这段时间内先不标记为完整，等延迟写入的日志到齐后由下一轮补齐。
	settleSecs = 300
)

// Store 本地明细库接口（生产实现为 *Local，测试用内存实现）。
type Store interface {
	Upsert(ctx context.Context, items []newapi.LogItem) error
	DayState(ctx context.Context, from, to string) (map[string]int64, error)
	MarkDay(ctx context.Context, day string, until, dayS, dayE int64) error
}

// Syncer 把 New API 明细按天增量同步到本地库。Fetch 应已套上 Throttle（全局限速 + 429 暂停）。
type Syncer struct {
	Store       Store
	Fetch       Fetch
	Concurrency int
}

// SyncState 同步进度回调参数。
type SyncState struct {
	DaysTotal  int    // 需要（重新）同步的天数
	DaysDone   int    // 已完成天数
	DaysCached int    // 本地库已完整、直接跳过的天数
	Day        string // 正在同步的日期
}

// SyncResult 同步结果。
type SyncResult struct {
	DaysTotal, DaysDone, DaysCached int
	Incomplete                      []string // 取到条数少于上游总数、未标记完整的日期
}

type syncDay struct {
	day    string
	s, e   int64 // 本次拉取范围
	ds, de int64 // 自然日起止
}

// plan 计算需要同步的天；已完整（水位 >= 当日最后一秒）的天跳过。
func (y *Syncer) plan(ctx context.Context, startTs, endTs, nowTs int64) (todo []syncDay, cached int, err error) {
	if endTs > nowTs {
		endTs = nowTs
	}
	if endTs < startTs {
		return nil, 0, nil
	}
	state, err := y.Store.DayState(ctx, usage.TsToDay(startTs), usage.TsToDay(endTs))
	if err != nil {
		return nil, 0, err
	}
	for ds := startTs; ds <= endTs; {
		de := DayEnd(ds)
		day := usage.TsToDay(ds)
		wm := state[day]
		switch {
		case wm >= de:
			cached++
		default:
			s := ds
			if wm > ds {
				s = max(ds, wm-syncOverlap)
			}
			todo = append(todo, syncDay{day: day, s: s, e: min(de, endTs), ds: ds, de: de})
		}
		ds = de + 1
	}
	return todo, cached, nil
}

// Missing 返回尚未完整落库的日期（不发起任何上游请求）。
func (y *Syncer) Missing(ctx context.Context, startTs, endTs, nowTs int64) ([]string, error) {
	todo, _, err := y.plan(ctx, startTs, endTs, nowTs)
	out := make([]string, 0, len(todo))
	for _, t := range todo {
		out = append(out, t.day)
	}
	return out, err
}

// Count 返回将要同步的天数与已缓存天数（不发起任何上游请求）。
func (y *Syncer) Count(ctx context.Context, startTs, endTs, nowTs int64) (todo, cached int, err error) {
	t, c, err := y.plan(ctx, startTs, endTs, nowTs)
	return len(t), c, err
}

// Sync 保证 [startTs,endTs]（CST 自然日边界）的明细已在本地库。按天串行，天内按 Collect 的分段策略拉取；
// 每天完成后立即记录水位，因此中途失败/取消/被限流放弃时，已完成的天不会丢，重试只补缺口。
func (y *Syncer) Sync(ctx context.Context, startTs, endTs, nowTs int64, prog *Progress, hook func(SyncState)) (SyncResult, error) {
	todo, cached, err := y.plan(ctx, startTs, endTs, nowTs)
	res := SyncResult{DaysTotal: len(todo), DaysCached: cached}
	if err != nil {
		return res, err
	}
	notify := func(day string) {
		if hook != nil {
			hook(SyncState{DaysTotal: res.DaysTotal, DaysDone: res.DaysDone, DaysCached: cached, Day: day})
		}
	}
	notify("")
	for _, t := range todo {
		if err := ctx.Err(); err != nil {
			return res, err
		}
		notify(t.day)
		before := prog.Incomplete()
		p := Params{StartTs: t.s, EndTs: t.e, Concurrency: y.Concurrency}
		if err := Collect(ctx, y.Fetch, p, prog, func(items []newapi.LogItem) error { return y.Store.Upsert(ctx, items) }); err != nil {
			return res, fmt.Errorf("同步 %s 失败：%w", t.day, err)
		}
		if prog.Incomplete() > before {
			res.Incomplete = append(res.Incomplete, t.day)
			prog.warn(fmt.Sprintf("%s 的明细未能完整取回，未标记为已同步，下次会自动重试", t.day))
		} else {
			until := t.e
			if t.e == t.de && nowTs < t.de+settleSecs {
				until = t.de - settleSecs
			}
			if err := y.Store.MarkDay(ctx, t.day, until, t.ds, t.de); err != nil {
				return res, err
			}
		}
		res.DaysDone++
		notify(t.day)
	}
	return res, nil
}

// RecentRange 返回「今天往前 days 天」（含今天）的起止时间戳（CST 自然日边界）。
func RecentRange(now time.Time, days int) (startTs, endTs int64) {
	if days < 1 {
		days = 1
	}
	n := now.In(usage.CST)
	today := time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, usage.CST)
	return today.AddDate(0, 0, -(days - 1)).Unix(), today.Unix() + 86400 - 1
}
