package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"icloud99/internal/auth"
	"icloud99/internal/httpx"
	"icloud99/internal/tokenq"
)

// tokenQuery 用访客自带的令牌 Key 查询额度与日志；Key 仅用于本次请求转发，不落库、不进审计。
func (s *Server) tokenQuery(w http.ResponseWriter, r *http.Request, p *auth.Principal) error {
	t0 := time.Now()
	var in struct {
		Key string `json:"key"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	in.Key = strings.TrimSpace(in.Key)
	if in.Key == "" {
		return httpx.Invalid("请输入令牌 Key", map[string]string{"key": "请输入令牌 Key"})
	}
	base := strings.TrimRight(s.Store.Setting(r.Context(), "site.token_base_url", ""), "/")
	if base == "" {
		return httpx.NotConfigured("尚未配置令牌查询的 New API 地址，请管理员在「管理设置 → 系统参数」中填写")
	}
	info, err := s.fetchJSON(r.Context(), base+"/api/usage/token/", in.Key, 15*time.Second)
	if err != nil {
		var ue *upstreamError
		if errors.As(err, &ue) && ue.Status == http.StatusTooManyRequests {
			return httpx.Err(http.StatusTooManyRequests, ue.Msg)
		}
		if errors.As(err, &ue) {
			return httpx.Err(http.StatusBadGateway, ue.Msg)
		}
		return httpx.Err(http.StatusBadGateway, "无法连接令牌服务: "+err.Error())
	}
	if ok, _ := info["code"].(bool); !ok {
		msg, _ := info["message"].(string)
		if msg == "" {
			msg = "令牌无效"
		}
		return httpx.Err(http.StatusBadRequest, msg)
	}
	var logs []tokenq.Log
	if lg, err := s.fetchJSON(r.Context(), base+"/api/log/token/", in.Key, 30*time.Second); err == nil {
		if arr, ok := lg["data"].([]any); ok {
			raw, _ := json.Marshal(arr)
			_ = json.Unmarshal(raw, &logs)
		}
	}
	for i := range logs {
		logs[i].OtherParsed = tokenq.ParseOther(logs[i].OtherRaw)
		logs[i].OtherRaw = ""
	}
	models, daily := tokenq.Aggregate(logs, time.Now(), 30, s.CST)
	s.rec(r, p, "token", "query", "令牌用量", "/token-usage", map[string]any{"logs": len(logs)}, nil, t0)
	httpx.OK(w, map[string]any{
		"tokenInfo": info["data"], "logs": logs, "totalLogs": len(logs),
		"modelStats": models, "modelOrder": tokenq.SortedModels(models), "dailyStats": daily,
	})
	return nil
}

// upstreamError 上游返回了非预期的 HTTP 状态；Status 供调用方映射为友好提示。
type upstreamError struct {
	Status int
	Msg    string
}

func (e *upstreamError) Error() string { return e.Msg }

func (s *Server) fetchJSON(ctx context.Context, url, key string, timeout time.Duration) (map[string]any, error) {
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, _ := http.NewRequestWithContext(cctx, http.MethodGet, url, nil)
	req.Header.Set("Authorization", "Bearer "+key)
	resp, err := s.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	out := map[string]any{}
	if len(strings.TrimSpace(string(raw))) > 0 {
		if err := json.Unmarshal(raw, &out); err != nil {
			if resp.StatusCode >= 400 {
				return nil, &upstreamError{Status: resp.StatusCode, Msg: "上游服务返回异常（HTTP " + strconv.Itoa(resp.StatusCode) + "）"}
			}
			return nil, &upstreamError{Status: resp.StatusCode, Msg: "上游服务返回了无法解析的内容（HTTP " + strconv.Itoa(resp.StatusCode) + "）"}
		}
		return out, nil
	}
	// 空响应体：按状态码给出明确原因（上游限流时即为 429 + 空体）
	switch {
	case resp.StatusCode == http.StatusTooManyRequests:
		return nil, &upstreamError{Status: 429, Msg: "查询过于频繁，已被上游限流，请稍后（约 1 分钟）再试"}
	case resp.StatusCode >= 500:
		return nil, &upstreamError{Status: resp.StatusCode, Msg: "上游服务暂时不可用（HTTP " + strconv.Itoa(resp.StatusCode) + "），请稍后再试"}
	default:
		return nil, &upstreamError{Status: resp.StatusCode, Msg: "上游服务返回空响应（HTTP " + strconv.Itoa(resp.StatusCode) + "）"}
	}
}
