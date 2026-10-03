// Package audit 写入审计日志（写操作与导出均需记录，详情递归脱敏）。
package audit

import (
	"database/sql"
	"encoding/json"
	"log"
	"time"

	"icloud99/internal/secret"
)

// Entry 一条审计记录。
type Entry struct {
	Module   string
	Action   string
	Target   string
	Link     string
	Detail   any
	IP       string
	Username string
	Err      error
	Started  time.Time
}

// Recorder 审计写入器。
type Recorder struct{ DB *sql.DB }

// Record 写入审计；自身失败只记日志，不影响业务。
func (r *Recorder) Record(e Entry) {
	detail := ""
	if e.Detail != nil {
		var generic any
		if b, err := json.Marshal(e.Detail); err == nil {
			_ = json.Unmarshal(b, &generic)
		}
		if b, err := json.Marshal(secret.Redact(generic)); err == nil {
			detail = string(b)
		}
	}
	if len(detail) > 4000 {
		detail = detail[:4000]
	}
	ok := 1
	if e.Err != nil {
		ok = 0
		if detail == "" {
			detail = e.Err.Error()
		}
	}
	user := e.Username
	if user == "" {
		user = "system"
	}
	dur := 0
	if !e.Started.IsZero() {
		dur = int(time.Since(e.Started).Milliseconds())
	}
	_, err := r.DB.Exec(`INSERT INTO audit_logs(module,action,target,link,detail,ip,username,success,duration_ms,created_at)
		VALUES(?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP())`,
		e.Module, e.Action, trunc(e.Target, 250), trunc(e.Link, 490), detail, trunc(e.IP, 90), user, ok, dur)
	if err != nil {
		log.Printf("[audit] 写入失败: %v", err)
	}
}

func trunc(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}
