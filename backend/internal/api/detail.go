package api

import (
	"archive/zip"
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"icloud99/internal/auth"
	"icloud99/internal/detail"
	"icloud99/internal/httpx"
	"icloud99/internal/newapi"
	"icloud99/internal/usage"
)

const (
	detailKeep    = 2 * time.Hour // 导出文件保留时间
	detailTimeout = 6 * time.Hour // 单次任务最长时间
)

// detailJob 当前/最近一次明细导出任务（单实例内存态；同一时刻只允许一个任务，避免压垮 New API）。
type detailJob struct {
	mu       sync.Mutex
	id       string
	running  bool
	cancel   context.CancelFunc
	canceled bool
	by       string
	start    string
	end      string
	users    []string
	started  time.Time
	finished time.Time
	phase    string // sync / write / done / failed / canceled / expired
	errMsg   string
	estimate int64
	// 本地库同步进度（按天）
	daysTotal, daysDone, daysCached int
	syncDay                         string
	prog                            *detail.Progress
	files                           []detail.File
	dir                             string
}

type detailReq struct {
	Start       string   `json:"start"`
	End         string   `json:"end"`
	Users       []string `json:"users"`
	RowsPerFile int      `json:"rowsPerFile"`
}

// parseDetailReq 校验并规范化导出参数（纯函数，便于测试）。
func parseDetailReq(in detailReq, now time.Time) (detail.Params, error) {
	fields := map[string]string{}
	if in.Start == "" {
		fields["start"] = "请选择开始日期"
	}
	if in.End == "" {
		fields["end"] = "请选择结束日期"
	}
	if len(fields) > 0 {
		return detail.Params{}, httpx.Invalid("请选择导出周期", fields)
	}
	p, err := usage.ParsePeriod(in.Start, in.End, "", now)
	if err != nil {
		return detail.Params{}, httpx.Invalid(err.Error(), map[string]string{"start": err.Error()})
	}
	seen := map[string]bool{}
	var users []string
	for _, u := range in.Users {
		if u = strings.TrimSpace(u); u != "" && !seen[u] {
			seen[u] = true
			users = append(users, u)
		}
	}
	if len(users) > detail.MaxUsers {
		return detail.Params{}, httpx.Invalid(fmt.Sprintf("最多指定 %d 个用户，导出全部用户请不要选择用户", detail.MaxUsers),
			map[string]string{"users": fmt.Sprintf("最多 %d 个用户", detail.MaxUsers)})
	}
	return detail.Params{Start: p.Start, End: p.End, StartTs: p.StartTs, EndTs: p.EndTs, Users: users,
		MaxRowsPerFile: detail.ClampPerFile(in.RowsPerFile)}, nil
}

func newJobID() string { return strconv.FormatInt(time.Now().UnixNano(), 36) }

func detailSheet(start, end string) string {
	if len(start) >= 7 && start[:7] == end[:7] {
		return start[5:7] + "月明细"
	}
	return "使用明细"
}

func (s *Server) detailStart(w http.ResponseWriter, r *http.Request, p *auth.Principal) error {
	var in detailReq
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	params, err := parseDetailReq(in, time.Now())
	if err != nil {
		return err
	}
	cfg, err := s.newapiCfg(r)
	if err != nil {
		return err
	}
	if len(params.Users) > 0 {
		all, err := s.NewAPI.ListAllUsers(r.Context(), cfg)
		if err != nil {
			return upstream(err)
		}
		exist := map[string]bool{}
		for _, u := range all {
			exist[u.Username] = true
		}
		for _, u := range params.Users {
			if !exist[u] {
				return httpx.Invalid("用户不存在："+u, map[string]string{"users": "用户 " + u + " 不存在"})
			}
		}
	}
	params.QuotaPerUnit = s.Usage.Currency(r.Context(), cfg).QuotaPerUnit
	user := ""
	if p != nil {
		user = p.Username
	}
	if !s.startDetail(cfg, params, user, clientIP(r)) {
		return httpx.Conflict("已有明细导出任务正在运行，请等待完成或先取消")
	}
	httpx.OK(w, map[string]any{"started": true})
	return nil
}

// startDetail 启动后台任务；已有任务运行时返回 false。
func (s *Server) startDetail(cfg newapi.Cfg, p detail.Params, user, ip string) bool {
	j := &s.detailJob
	j.mu.Lock()
	if j.running {
		j.mu.Unlock()
		return false
	}
	old := j.dir
	ctx, cancel := context.WithTimeout(context.Background(), detailTimeout)
	// 只重置业务字段，不能整体赋值覆盖（会连同已加锁的 mu 一起清零）
	j.id, j.running, j.cancel, j.canceled = newJobID(), true, cancel, false
	j.by, j.start, j.end, j.users = user, p.Start, p.End, p.Users
	j.started, j.finished = time.Now(), time.Time{}
	j.phase, j.errMsg, j.estimate = "sync", "", 0
	j.daysTotal, j.daysDone, j.daysCached, j.syncDay = 0, 0, 0, ""
	j.prog, j.files, j.dir = &detail.Progress{}, nil, ""
	id, prog := j.id, j.prog
	j.mu.Unlock()
	if old != "" {
		_ = os.RemoveAll(old)
	}
	go func() {
		defer cancel()
		t0 := time.Now()
		var files []detail.File
		var dir string
		var runErr error
		func() {
			defer func() {
				if rec := recover(); rec != nil {
					runErr = fmt.Errorf("内部错误: %v", rec)
					log.Printf("[detail] panic: %v", rec)
				}
			}()
			files, dir, runErr = s.runDetail(ctx, j, cfg, p, prog)
		}()
		j.mu.Lock()
		j.running, j.finished, j.files, j.dir = false, time.Now(), files, dir
		switch {
		case runErr == nil:
			j.phase = "done"
		case j.canceled || ctx.Err() == context.Canceled:
			j.phase, j.errMsg = "canceled", "已取消"
			runErr = nil
		default:
			j.phase, j.errMsg = "failed", runErr.Error()
			log.Printf("[detail] 导出失败: %v", runErr)
		}
		phase, rows := j.phase, int64(0)
		for _, f := range files {
			rows += int64(f.Rows)
		}
		if phase != "done" && dir != "" { // 失败/取消不保留半成品
			_ = os.RemoveAll(dir)
			j.dir, j.files = "", nil
		}
		j.mu.Unlock()
		segTotal, _, splits, _, _, warns := prog.Snapshot()
		s.rec2(user, ip, "detail", "export", p.Start+" ~ "+p.End, "/detail-export", map[string]any{
			"result": phase, "start": p.Start, "end": p.End, "users": len(p.Users), "rows": rows, "files": len(files),
			"segments": segTotal, "splits": splits, "warnings": len(warns), "elapsedSec": int(time.Since(t0).Seconds()),
		}, runErr, t0)
		if phase == "done" {
			time.AfterFunc(detailKeep, func() { s.expireDetail(id) })
		}
	}()
	return true
}

func (s *Server) expireDetail(id string) {
	j := &s.detailJob
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.id == id && !j.running && j.dir != "" {
		_ = os.RemoveAll(j.dir)
		j.dir, j.files, j.phase = "", nil, "expired"
	}
}

// runDetail 先把缺失的天同步到本地库（带全局限速，遇 429 等待后继续），再从本地库流式写 Excel。
// 每天同步完立即记录水位：失败/取消后已同步的天不会丢，重试只补缺口。
func (s *Server) runDetail(ctx context.Context, j *detailJob, cfg newapi.Cfg, p detail.Params, prog *detail.Progress) ([]detail.File, string, error) {
	// 1) 独占同步闸门（先让后台预同步让路；它已完成的天已落库）
	s.auto.stop()
	if err := s.gate.acquire(ctx); err != nil {
		return nil, "", err
	}
	defer s.gate.release()

	// 2) 同步缺失的天
	now := time.Now()
	sy := s.syncer(ctx, cfg)
	res, err := sy.Sync(ctx, p.StartTs, p.EndTs, now.Unix(), prog, func(x detail.SyncState) {
		j.mu.Lock()
		j.daysTotal, j.daysDone, j.daysCached, j.syncDay = x.DaysTotal, x.DaysDone, x.DaysCached, x.Day
		j.mu.Unlock()
	})
	if err != nil {
		if ctx.Err() != nil {
			return nil, "", ctx.Err()
		}
		if detail.IsRate(err) {
			return nil, "", fmt.Errorf("上游持续限流（429），已等待较长时间仍未恢复。已同步的 %d 天已保存到本地库，稍后重试只会补剩余的天：%w", res.DaysDone, err)
		}
		return nil, "", fmt.Errorf("%w（已同步的 %d 天已保存到本地库，重试只会补剩余的天）", upstreamMsg(err), res.DaysDone)
	}

	// 3) 从本地库统计并流式写 Excel
	total, err := s.local().Count(ctx, p.StartTs, p.EndTs, p.Users)
	if err != nil {
		return nil, "", err
	}
	if total > int64(detail.MaxTotalRows) {
		return nil, "", fmt.Errorf("该周期共 %d 条明细，超过单次导出上限 %d 条，请缩短周期或指定用户后分批导出", total, detail.MaxTotalRows)
	}
	j.mu.Lock()
	j.estimate, j.phase = total, "write"
	j.mu.Unlock()

	dir, err := os.MkdirTemp("", "icloud99-detail-*")
	if err != nil {
		return nil, "", err
	}
	base := fmt.Sprintf("使用明细_%s_%s", p.Start, p.End)
	if len(p.Users) == 1 {
		base += "_" + safeName(p.Users[0])
	}
	w := detail.NewWriter(dir, base, detailSheet(p.Start, p.End), p.MaxRowsPerFile)
	var n int64
	err = s.local().Stream(ctx, p.StartTs, p.EndTs, p.Users, p.QuotaPerUnit, func(r detail.Row) error {
		if err := w.Add(r); err != nil {
			return err
		}
		n++
		if n%2000 == 0 {
			prog.SetRows(n)
		}
		return nil
	})
	prog.SetRows(n)
	if err != nil {
		w.Abort()
		_ = os.RemoveAll(dir)
		return nil, "", err
	}
	files, err := w.Close()
	if err != nil {
		_ = os.RemoveAll(dir)
		return nil, "", err
	}
	return files, dir, nil
}

// upstreamMsg 返回 upstream(err) 转换后的可读错误。
func upstreamMsg(err error) error {
	if e := upstream(err); e != nil {
		return e
	}
	return err
}

// safeName 去掉文件名里的路径分隔符等字符。
func safeName(n string) string {
	return strings.Map(func(r rune) rune {
		if strings.ContainsRune(`/\:*?"<>|`, r) || r < 32 {
			return '_'
		}
		return r
	}, n)
}

func (s *Server) detailStatus(w http.ResponseWriter, _ *http.Request, _ *auth.Principal) error {
	j := &s.detailJob
	j.mu.Lock()
	defer j.mu.Unlock()
	out := map[string]any{"running": j.running, "phase": j.phase, "error": j.errMsg, "id": j.id, "start": j.start, "end": j.end,
		"users": j.users, "by": j.by, "estimate": j.estimate, "files": []detail.File{}, "warnings": []string{}}
	if j.id == "" {
		out["phase"] = "idle"
		httpx.OK(w, out)
		return nil
	}
	out["daysTotal"], out["daysDone"], out["daysCached"], out["syncDay"] = j.daysTotal, j.daysDone, j.daysCached, j.syncDay
	if t := s.throttle; t != nil && j.running {
		out["pausedSec"], out["rateHits"] = int(t.PausedFor().Seconds()), t.Hits()
	}
	if j.prog != nil {
		segTotal, segDone, splits, rows, _, warns := j.prog.Snapshot()
		out["segTotal"], out["segDone"], out["splits"], out["rows"], out["warnings"] = segTotal, segDone, splits, rows, warns
	}
	if j.running {
		out["elapsedSec"] = int(time.Since(j.started).Seconds())
	} else if !j.finished.IsZero() {
		out["elapsedSec"] = int(j.finished.Sub(j.started).Seconds())
		out["finishedAt"] = j.finished.UTC().Format(time.RFC3339)
		if j.phase == "done" {
			out["expiresAt"] = j.finished.Add(detailKeep).UTC().Format(time.RFC3339)
		}
	}
	if len(j.files) > 0 {
		out["files"] = j.files
	}
	httpx.OK(w, out)
	return nil
}

func (s *Server) detailCancel(w http.ResponseWriter, _ *http.Request, _ *auth.Principal) error {
	j := &s.detailJob
	j.mu.Lock()
	defer j.mu.Unlock()
	if !j.running {
		return httpx.Conflict("当前没有正在运行的导出任务")
	}
	j.canceled = true
	j.cancel()
	httpx.OK(w, map[string]any{"canceling": true})
	return nil
}

// detailDownload 下载单个文件；file=all（或缺省且有多个文件）时流式打包 zip（xlsx 已压缩，zip 只存储不再压缩）。
func (s *Server) detailDownload(w http.ResponseWriter, r *http.Request, _ *auth.Principal) error {
	j := &s.detailJob
	j.mu.Lock()
	running, dir := j.running, j.dir
	files := append([]detail.File(nil), j.files...)
	start, end := j.start, j.end
	j.mu.Unlock()
	if running {
		return httpx.Conflict("导出任务仍在运行，请等待完成")
	}
	if len(files) == 0 || dir == "" {
		return httpx.Err(http.StatusNotFound, "没有可下载的导出文件（可能已过期，请重新导出）")
	}
	name := r.URL.Query().Get("file")
	if name == "" && len(files) == 1 {
		name = files[0].Name
	}
	set := func(fn, ct string) {
		w.Header().Set("Content-Type", ct)
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="download"; filename*=UTF-8''%s`, url.PathEscape(fn)))
		w.Header().Set("Cache-Control", "no-store")
	}
	if name != "" && name != "all" {
		for _, f := range files {
			if f.Name == name {
				fh, err := os.Open(filepath.Join(dir, filepath.Base(f.Path)))
				if err != nil {
					return httpx.Err(http.StatusNotFound, "文件已不存在，请重新导出")
				}
				defer fh.Close()
				set(f.Name, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
				w.Header().Set("Content-Length", strconv.FormatInt(f.Size, 10))
				_, _ = io.Copy(w, fh)
				return nil
			}
		}
		return httpx.Err(http.StatusNotFound, "文件不存在")
	}
	sort.Slice(files, func(a, b int) bool { return files[a].Name < files[b].Name })
	set(fmt.Sprintf("使用明细_%s_%s.zip", start, end), "application/zip")
	zw := zip.NewWriter(w)
	for _, f := range files {
		fh, err := os.Open(filepath.Join(dir, filepath.Base(f.Path)))
		if err != nil {
			return nil // 头已发出，只能中断
		}
		hd := &zip.FileHeader{Name: f.Name, Method: zip.Store, Modified: time.Now()}
		ww, err := zw.CreateHeader(hd)
		if err == nil {
			_, err = io.Copy(ww, fh)
		}
		fh.Close()
		if err != nil {
			return nil
		}
	}
	_ = zw.Close()
	return nil
}
