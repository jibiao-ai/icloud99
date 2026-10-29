package detail

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"icloud99/internal/newapi"
	"icloud99/internal/usage"
)

// Local 本地明细库（usage_logs / usage_log_days）：把 New API 的调用明细提前落到自己的 MariaDB，
// 导出时只读本地库，避免每次导出都大量请求上游而触发限流。
type Local struct{ DB *sql.DB }

const upsertBatch = 200

// streamPage 本地库游标分页大小（测试中缩小以覆盖翻页）。
var streamPage = 5000

func tsText(ts int64) string { return usage.TsToDateTime(ts) }

var logCols = "log_id,created_at,user_id,username,token_name,group_name,model,prompt_tokens,completion_tokens,quota,channel,channel_name,request_id,upstream_id,use_time,is_stream,ip,content"

func cut(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}

// Upsert 幂等写入（按 log_id 覆盖），重复同步同一时间段不会产生重复行。
func (l *Local) Upsert(ctx context.Context, items []newapi.LogItem) error {
	for i := 0; i < len(items); i += upsertBatch {
		j := min(i+upsertBatch, len(items))
		var sb strings.Builder
		args := make([]any, 0, (j-i)*18)
		n := 0
		for _, it := range items[i:j] {
			if it.ID == 0 {
				continue
			}
			if n > 0 {
				sb.WriteByte(',')
			}
			n++
			sb.WriteString("(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
			r := ToRow(it, 1)
			args = append(args, it.ID, it.CreatedAt, it.UserID, cut(it.Username, 100), cut(it.TokenName, 200), cut(it.Group, 100),
				cut(it.ModelName, 200), it.PromptTokens, it.CompletionTokens, it.Quota, r.Channel, cut(it.ChannelName, 200),
				cut(it.RequestID, 100), cut(r.UpstreamID, 200), it.UseTime, r.IsStream, cut(it.IP, 64), it.Content)
		}
		if n == 0 {
			continue
		}
		q := "INSERT INTO usage_logs (" + logCols + ") VALUES " + sb.String() +
			" ON DUPLICATE KEY UPDATE created_at=VALUES(created_at),user_id=VALUES(user_id),username=VALUES(username)," +
			"token_name=VALUES(token_name),group_name=VALUES(group_name),model=VALUES(model),prompt_tokens=VALUES(prompt_tokens)," +
			"completion_tokens=VALUES(completion_tokens),quota=VALUES(quota),channel=VALUES(channel),channel_name=VALUES(channel_name)," +
			"request_id=VALUES(request_id),upstream_id=VALUES(upstream_id),use_time=VALUES(use_time),is_stream=VALUES(is_stream)," +
			"ip=VALUES(ip),content=VALUES(content)"
		if _, err := l.DB.ExecContext(ctx, q, args...); err != nil {
			return fmt.Errorf("写入本地明细库失败: %w", err)
		}
	}
	return nil
}

// DayState 返回 [from,to]（YYYY-MM-DD）内每天的同步水位（unix 秒）；未同步的天不在 map 中。
func (l *Local) DayState(ctx context.Context, from, to string) (map[string]int64, error) {
	rows, err := l.DB.QueryContext(ctx, `SELECT day, synced_until FROM usage_log_days WHERE day BETWEEN ? AND ?`, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int64{}
	for rows.Next() {
		var d string
		var u int64
		if err := rows.Scan(&d, &u); err != nil {
			return nil, err
		}
		out[d] = u
	}
	return out, rows.Err()
}

// MarkDay 记录某天已同步到 until（水位只增不减），并刷新当天行数。
func (l *Local) MarkDay(ctx context.Context, day string, until, dayS, dayE int64) error {
	var n int64
	if err := l.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM usage_logs WHERE created_at BETWEEN ? AND ?`, dayS, dayE).Scan(&n); err != nil {
		return err
	}
	_, err := l.DB.ExecContext(ctx, `INSERT INTO usage_log_days(day,synced_until,rows_cnt) VALUES(?,?,?)
		ON DUPLICATE KEY UPDATE synced_until=GREATEST(synced_until,VALUES(synced_until)), rows_cnt=VALUES(rows_cnt), synced_at=NOW()`, day, until, n)
	return err
}

// Stats 本地库概况。
type Stats struct {
	Rows          int64     `json:"rows"`
	Days          int       `json:"days"`
	FirstDay      string    `json:"firstDay"`
	LastDay       string    `json:"lastDay"`
	SyncedThrough int64     `json:"syncedThrough"`
	SyncedAt      time.Time `json:"syncedAt"`
}

// Stats 读取概况（只扫日表，行数取各日汇总，不全表 COUNT）。
func (l *Local) Stats(ctx context.Context) (Stats, error) {
	var st Stats
	var at sql.NullTime
	err := l.DB.QueryRowContext(ctx, `SELECT COALESCE(SUM(rows_cnt),0), COUNT(*), COALESCE(MIN(day),''), COALESCE(MAX(day),''),
		COALESCE(MAX(synced_until),0), MAX(synced_at) FROM usage_log_days`).Scan(&st.Rows, &st.Days, &st.FirstDay, &st.LastDay, &st.SyncedThrough, &at)
	if at.Valid {
		st.SyncedAt = at.Time
	}
	return st, err
}

func userClause(users []string) (string, []any) {
	if len(users) == 0 {
		return "", nil
	}
	args := make([]any, len(users))
	for i, u := range users {
		args[i] = u
	}
	return " AND username IN (" + strings.TrimSuffix(strings.Repeat("?,", len(users)), ",") + ")", args
}

// Count 统计范围内（可按用户过滤）的行数。
func (l *Local) Count(ctx context.Context, startTs, endTs int64, users []string) (int64, error) {
	uc, ua := userClause(users)
	var n int64
	err := l.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM usage_logs WHERE created_at BETWEEN ? AND ?`+uc, append([]any{startTs, endTs}, ua...)...).Scan(&n)
	return n, err
}

// Stream 按 (created_at, log_id) 升序游标分页读取，逐行回调；内存与行数无关。
func (l *Local) Stream(ctx context.Context, startTs, endTs int64, users []string, qpu float64, fn func(Row) error) error {
	if qpu <= 0 {
		qpu = 500000
	}
	uc, ua := userClause(users)
	lastTs, lastID := startTs-1, int64(0)
	hint := ""
	switch {
	case len(users) == 1:
		hint = " USE INDEX (idx_user_created)"
	case len(users) > 1:
		hint = " FORCE INDEX (idx_created)" // 按时间顺序扫描并过滤，避免对大结果集 filesort
	}
	q := `SELECT ` + logCols + ` FROM usage_logs` + hint + ` WHERE created_at BETWEEN ? AND ?` + uc +
		` AND (created_at > ? OR (created_at = ? AND log_id > ?)) ORDER BY created_at, log_id LIMIT ?`
	for {
		args := append([]any{startTs, endTs}, ua...)
		args = append(args, lastTs, lastTs, lastID, streamPage)
		rs, err := l.DB.QueryContext(ctx, q, args...)
		if err != nil {
			return err
		}
		n := 0
		for rs.Next() {
			var r Row
			var ts int64
			var content sql.NullString
			if err := rs.Scan(&r.LogID, &ts, &r.UserID, &r.Username, &r.TokenName, &r.Group, &r.Model, &r.Prompt, &r.Completion,
				&r.Quota, &r.Channel, &r.ChannelName, &r.RequestID, &r.UpstreamID, &r.UseTime, &r.IsStream, &r.IP, &content); err != nil {
				rs.Close()
				return err
			}
			r.Time = tsText(ts)
			r.Total = r.Prompt + r.Completion
			r.CostUSD = float64(r.Quota) / qpu
			r.LogType = 2
			r.Content = content.String
			lastTs, lastID = ts, r.LogID
			n++
			if err := fn(r); err != nil {
				rs.Close()
				return err
			}
		}
		err = rs.Err()
		rs.Close()
		if err != nil {
			return err
		}
		if n < streamPage {
			return ctx.Err()
		}
		if err := ctx.Err(); err != nil {
			return err
		}
	}
}

// Prune 删除 beforeTs 之前的明细及对应的日水位（分批删除，避免长事务）。
func (l *Local) Prune(ctx context.Context, beforeTs int64, beforeDay string) (int64, error) {
	var total int64
	for {
		res, err := l.DB.ExecContext(ctx, `DELETE FROM usage_logs WHERE created_at < ? LIMIT 20000`, beforeTs)
		if err != nil {
			return total, err
		}
		n, _ := res.RowsAffected()
		total += n
		if n < 20000 {
			break
		}
	}
	_, err := l.DB.ExecContext(ctx, `DELETE FROM usage_log_days WHERE day < ?`, beforeDay)
	return total, err
}
