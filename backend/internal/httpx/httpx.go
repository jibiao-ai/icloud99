// Package httpx 统一响应信封 {code,message,data} 与错误类型。
package httpx

import (
	"encoding/json"
	"errors"
	"net/http"
)

// 业务码。
const (
	CodeOK         = 0
	CodeValidation = 40001
	CodeBadRequest = 40000
	CodeUnauth     = 40101
	CodeForbidden  = 40301
	CodeNotFound   = 40401
	CodeNoConfig   = 40002
	CodeConflict   = 40901
	CodeTooMany    = 42901
	CodeServer     = 50000
	CodeUpstream   = 50201
)

type envelope struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data"`
}

// Error 带 HTTP 状态与业务码的错误。
type Error struct {
	Status  int
	Code    int
	Message string
	Fields  map[string]string
}

func (e *Error) Error() string { return e.Message }

// Err 构造错误，业务码由状态码推导。
func Err(status int, msg string) *Error {
	code := CodeServer
	switch status {
	case http.StatusBadRequest:
		code = CodeBadRequest
	case http.StatusUnauthorized:
		code = CodeUnauth
	case http.StatusForbidden:
		code = CodeForbidden
	case http.StatusNotFound:
		code = CodeNotFound
	case http.StatusTooManyRequests:
		code = CodeTooMany
	case http.StatusBadGateway:
		code = CodeUpstream
	}
	return &Error{Status: status, Code: code, Message: msg}
}

// NotConfigured 依赖的外部配置尚未在页面录入（前端据此引导去设置页）。
func NotConfigured(msg string) *Error {
	return &Error{Status: http.StatusBadRequest, Code: CodeNoConfig, Message: msg}
}

// Conflict 资源冲突（如任务已在运行）。
func Conflict(msg string) *Error {
	return &Error{Status: http.StatusConflict, Code: CodeConflict, Message: msg}
}

// Invalid 字段校验失败：HTTP 400 / code 40001 / data.fields。
func Invalid(msg string, fields map[string]string) *Error {
	return &Error{Status: http.StatusBadRequest, Code: CodeValidation, Message: msg, Fields: fields}
}

func write(w http.ResponseWriter, status int, env envelope) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(env)
}

// OK 成功响应。
func OK(w http.ResponseWriter, data any) {
	write(w, http.StatusOK, envelope{Code: CodeOK, Message: "ok", Data: data})
}

// Fail 将 error 写成响应。
func Fail(w http.ResponseWriter, err error) {
	var he *Error
	if errors.As(err, &he) {
		var data any
		if he.Fields != nil {
			data = map[string]any{"fields": he.Fields}
		}
		write(w, he.Status, envelope{Code: he.Code, Message: he.Message, Data: data})
		return
	}
	write(w, http.StatusInternalServerError, envelope{Code: CodeServer, Message: "服务内部错误"})
}

// Decode 解析 JSON 请求体。
func Decode(r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(nil, r.Body, 4<<20)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		return Err(http.StatusBadRequest, "请求体格式错误")
	}
	return nil
}
