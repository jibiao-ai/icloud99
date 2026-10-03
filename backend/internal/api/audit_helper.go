package api

import (
	"time"

	"cloudwatch/internal/audit"
)

func auditEntry(module, action, target, link string, detail any, err error, t0 time.Time) audit.Entry {
	return audit.Entry{Module: module, Action: action, Target: target, Link: link, Detail: detail, Err: err, Started: t0}
}
