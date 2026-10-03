// Package iq 实现“智力检测”：鹈鹕骑行 SVG 动画生成检测，以及评分与调度。
package iq

import (
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

type chatResp struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		Details          struct {
			Reasoning int `json:"reasoning_tokens"`
		} `json:"completion_tokens_details"`
	} `json:"usage"`
}

// ChatTimeout 单次上游调用超时（SVG 生成实测 2~3 分钟）。
const ChatTimeout = 280 * time.Second

// Chat 调用 OpenAI 兼容 chat/completions。
func Chat(ctx context.Context, hc *http.Client, baseURL, key, model, prompt string, maxTokens int, timeout time.Duration) (content string, in, out, reasoning int, err error) {
	body, _ := json.Marshal(map[string]any{"model": model, "messages": []map[string]string{{"role": "user", "content": prompt}}, "max_tokens": maxTokens, "stream": false})
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, _ := http.NewRequestWithContext(cctx, http.MethodPost, strings.TrimRight(baseURL, "/")+"/v1/chat/completions", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	resp, err := hc.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return "", 0, 0, 0, fmt.Errorf("上游响应超时（>%ds）", int(timeout.Seconds()))
		}
		return "", 0, 0, 0, fmt.Errorf("连接上游失败: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if resp.StatusCode != 200 {
		msg := strings.TrimSpace(string(raw))
		if r := []rune(msg); len(r) > 160 {
			msg = string(r[:160])
		}
		return "", 0, 0, 0, fmt.Errorf("上游返回 HTTP %d: %s", resp.StatusCode, msg)
	}
	var r chatResp
	if err := json.Unmarshal(raw, &r); err != nil {
		return "", 0, 0, 0, fmt.Errorf("响应解析失败")
	}
	if len(r.Choices) > 0 {
		content = r.Choices[0].Message.Content
	}
	return content, r.Usage.PromptTokens, r.Usage.CompletionTokens, r.Usage.Details.Reasoning, nil
}

// Run 调用上游生成鹈鹕骑行 SVG 并评分。上游失败不 panic，返回降智记录并带 Err。
func Run(ctx context.Context, hc *http.Client, baseURL, key, model string) Result {
	t0 := time.Now()
	content, in, out, reasoning, err := Chat(ctx, hc, baseURL, key, model, SVGPrompt, 16000, ChatTimeout)
	ms := int(time.Since(t0).Milliseconds())
	if err != nil {
		return Result{Result: "degraded", RawResponse: "Error: " + err.Error(), ResponseTimeMs: ms, InputTokens: in, OutputTokens: out, ReasoningTokens: reasoning, Err: err}
	}
	svg := ExtractSVG(content)
	res, score := ScoreSVG(svg)
	raw := content
	if r := []rune(raw); len(r) > 2000 {
		raw = string(r[:2000])
	}
	return Result{Result: res, Score: score, RawResponse: raw, SVG: svg, HasSVG: svg != "",
		ReasoningTokens: reasoning, InputTokens: in, OutputTokens: out, ResponseTimeMs: ms}
}
