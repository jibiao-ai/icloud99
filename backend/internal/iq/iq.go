// Package iq 实现“智力检测”：鹈鹕骑行 SVG 动画生成检测，以及评分与调度。
package iq

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// Tiers 轮转分组。
var Tiers = []string{"lite", "standard", "ultra"}

// SVGPrompt 鹈鹕骑行动画提示词。
const SVGPrompt = `Generate an SVG of a pelican riding a bicycle. The SVG must include CSS animations to show the pelican pedaling and the bicycle wheels spinning. Make it a fun animated scene with the pelican actively cycling. Use <animate> or CSS @keyframes for smooth continuous animation.`

// Result 检测结果。
type Result struct {
	Result          string // pass / works / degraded
	Score           float64
	RawResponse     string
	ReasoningTokens int
	InputTokens     int
	OutputTokens    int
	ResponseTimeMs  int
	SVG             string
	HasSVG          bool
	Err             error // 上游调用失败原因（失败也会落一条降智记录，便于排查）
}

var svgRe = regexp.MustCompile(`(?is)<svg.*?</svg>`)

// ExtractSVG 提取首个完整 <svg>…</svg>。
func ExtractSVG(content string) string { return svgRe.FindString(content) }

// animRe 识别 SVG 内的动画：CSS @keyframes / animation 属性 / SMIL 标签。
var animRe = regexp.MustCompile(`(?i)@keyframes|animation\s*:|animation-name|<animate(Transform|Motion)?[\s>/]|<set[\s>/]`)

// ScoreSVG 评估鹈鹕骑行 SVG：
// 含有效 SVG 且带动画 → pass(100)；有 SVG 但无动画 → works(60，可疑)；无 SVG/调用失败 → degraded(0)。
func ScoreSVG(svg string) (string, float64) {
	if len(svg) < 200 {
		return "degraded", 0
	}
	if animRe.MatchString(svg) {
		return "pass", 100
	}
	return "works", 60
}

// TierAt 返回 CST 小时对应的检测分组；窗口外返回 ok=false。窗口 [start,end)。
func TierAt(hour, start, end int) (string, bool) {
	if hour < start || hour >= end {
		return "", false
	}
	return Tiers[(hour-start)%len(Tiers)], true
}

// NextRun 计算某分组下一次自动检测时间（CST 小时整点）。
func NextRun(now time.Time, tier string, start, end int, loc *time.Location) (time.Time, bool) {
	n := now.In(loc)
	for d := 0; d <= 1; d++ {
		for h := start; h < end; h++ {
			t, ok := TierAt(h, start, end)
			if !ok || t != tier {
				continue
			}
			cand := time.Date(n.Year(), n.Month(), n.Day()+d, h, 0, 0, 0, loc)
			if cand.After(n) {
				return cand, true
			}
		}
	}
	return time.Time{}, false
}

// chunk 同时兼容流式增量（delta）与非流式完整（message）响应。
type chunk struct {
	Choices []struct {
		Delta struct {
			Content string `json:"content"`
		} `json:"delta"`
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Usage *struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		Details          struct {
			Reasoning int `json:"reasoning_tokens"`
		} `json:"completion_tokens_details"`
	} `json:"usage"`
}

const (
	// ChatTimeout 单次上游调用总超时。
	ChatTimeout = 600 * time.Second
	// IdleTimeout 流式响应中允许的最长无数据间隔。
	IdleTimeout = 300 * time.Second
	// MaxAttempts 失败（上游故障或未产出 SVG）时的最大尝试次数。
	MaxAttempts = 3
)

// RetryDelay 重试间隔（测试可调小）。
var RetryDelay = 8 * time.Second

// HTTPError 上游返回非 200。
type HTTPError struct {
	Status int
	Body   string
}

func (e *HTTPError) Error() string { return fmt.Sprintf("上游返回 HTTP %d: %s", e.Status, e.Body) }

// Retryable 网关超时/5xx/429 等可重试。
func (e *HTTPError) Retryable() bool { return e.Status >= 500 || e.Status == 429 || e.Status == 408 }

func trunc(s string, n int) string {
	if r := []rune(strings.TrimSpace(s)); len(r) > n {
		return string(r[:n])
	}
	return strings.TrimSpace(s)
}

// Chat 以流式调用 OpenAI 兼容 chat/completions（避免非流式长时间无响应被网关 524 切断）。
// timeout 为总超时；流中超过 IdleTimeout 无数据则中止。上游不支持流式而直接返回 JSON 时同样兼容。
func Chat(ctx context.Context, hc *http.Client, baseURL, key, model, prompt string, maxTokens int, timeout time.Duration) (content string, in, out, reasoning int, err error) {
	body, _ := json.Marshal(map[string]any{"model": model, "messages": []map[string]string{{"role": "user", "content": prompt}},
		"max_tokens": maxTokens, "stream": true, "stream_options": map[string]any{"include_usage": true}})
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, _ := http.NewRequestWithContext(cctx, http.MethodPost, strings.TrimRight(baseURL, "/")+"/v1/chat/completions", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	fail := func(e error) (string, int, int, int, error) {
		if errors.Is(cctx.Err(), context.DeadlineExceeded) || errors.Is(e, context.DeadlineExceeded) {
			return content, in, out, reasoning, fmt.Errorf("上游响应超时（>%ds）", int(timeout.Seconds()))
		}
		return content, in, out, reasoning, fmt.Errorf("上游连接中断: %w", e)
	}
	resp, err := hc.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return "", 0, 0, 0, fmt.Errorf("上游响应超时（>%ds）", int(timeout.Seconds()))
		}
		return "", 0, 0, 0, fmt.Errorf("连接上游失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return "", 0, 0, 0, &HTTPError{Status: resp.StatusCode, Body: trunc(string(raw), 160)}
	}
	// 空闲看门狗：每收到数据重置计时。
	idle := time.AfterFunc(IdleTimeout, cancel)
	defer idle.Stop()
	apply := func(c *chunk) {
		if len(c.Choices) > 0 {
			content += c.Choices[0].Delta.Content + c.Choices[0].Message.Content
		}
		if c.Usage != nil {
			in, out, reasoning = c.Usage.PromptTokens, c.Usage.CompletionTokens, c.Usage.Details.Reasoning
		}
	}
	if !strings.Contains(resp.Header.Get("Content-Type"), "event-stream") { // 上游忽略 stream，直接返回 JSON
		raw, rerr := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
		if rerr != nil {
			return fail(rerr)
		}
		var c chunk
		if json.Unmarshal(raw, &c) != nil {
			return "", 0, 0, 0, fmt.Errorf("响应解析失败")
		}
		apply(&c)
		return content, in, out, reasoning, nil
	}
	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 64<<10), 8<<20)
	done := false
	for sc.Scan() {
		idle.Reset(IdleTimeout)
		line := strings.TrimSpace(sc.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			done = true
			break
		}
		var c chunk
		if json.Unmarshal([]byte(data), &c) != nil {
			continue
		}
		apply(&c)
	}
	if err := sc.Err(); err != nil {
		return fail(err)
	}
	if !done && content == "" {
		if cctx.Err() != nil {
			return fail(cctx.Err())
		}
		return "", in, out, reasoning, fmt.Errorf("上游流式响应为空")
	}
	return content, in, out, reasoning, nil
}

// retryable 判断失败是否值得重试（鉴权/参数类 4xx 不重试）。
func retryable(err error) bool {
	var he *HTTPError
	if errors.As(err, &he) {
		return he.Retryable()
	}
	return true
}

// Run 调用上游生成鹈鹕骑行 SVG 并评分。上游故障或未产出 SVG 时自动重试（最多 MaxAttempts 次）。
// 返回 Err != nil 表示上游一直故障（属于基础设施问题，调用方不应记为“降智”）；
// Err == nil 且 HasSVG=false 表示上游正常应答但模型多次均未给出 SVG（真实的降智表现）。
func Run(ctx context.Context, hc *http.Client, baseURL, key, model string) Result {
	var res Result
	for attempt := 1; attempt <= MaxAttempts; attempt++ {
		t0 := time.Now()
		content, in, out, reasoning, err := Chat(ctx, hc, baseURL, key, model, SVGPrompt, 16000, ChatTimeout)
		ms := int(time.Since(t0).Milliseconds())
		if err != nil {
			res = Result{Result: "degraded", RawResponse: "Error: " + err.Error(), ResponseTimeMs: ms, InputTokens: in, OutputTokens: out, ReasoningTokens: reasoning, Err: err}
			if !retryable(err) || ctx.Err() != nil {
				return res
			}
		} else {
			svg := ExtractSVG(content)
			verdict, score := ScoreSVG(svg)
			res = Result{Result: verdict, Score: score, RawResponse: trunc(content, 2000), SVG: svg, HasSVG: svg != "",
				ReasoningTokens: reasoning, InputTokens: in, OutputTokens: out, ResponseTimeMs: ms}
			if verdict != "degraded" {
				return res
			}
		}
		if attempt < MaxAttempts {
			select {
			case <-ctx.Done():
				return res
			case <-time.After(RetryDelay):
			}
		}
	}
	return res
}
