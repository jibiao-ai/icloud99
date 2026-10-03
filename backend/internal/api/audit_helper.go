package api

import (
	"time"

	"icloud99/internal/audit"
)

func auditEntry(module, action, target, link string, detail any, err error, t0 time.Time) audit.Entry {
	return audit.Entry{Module: module, Action: action, Target: target, Link: link, Detail: detail, Err: err, Started: t0}
}
