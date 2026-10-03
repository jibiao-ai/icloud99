// Package iq 实现“智力检测”：糖果推理题 + 鹈鹕骑行 SVG 生成，以及评分与调度。
package iq

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Tiers 轮转分组。
var Tiers = []string{"lite", "standard", "ultra"}

// CandyPrompt 糖果推理题（标准答案 21）。
const CandyPrompt = `不使用任何外部工具回答以下问题：

在一个黑色的袋子里放有三种口味的糖果，每种糖果有两种不同的形状（圆形和五角星形，不同的形状靠手感可以分辨）。现已知不同口味的糖和不同形状的数量统计如下表。参赛者需要在活动前决定摸出的糖果数目，那么，最少取出多少个糖果才能保证手中同时拥有不同形状的苹果味和桃子味的糖？（同时手中有圆形苹果味匹配五角星桃子味糖果，或者有圆形桃子味匹配五角星苹果味糖果都满足要求）

        苹果味  桃子味  西瓜味
圆形       7      9      8
五角星形   7      6      4`

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
	CandyOK         bool
	HasSVG          bool
}

var (
	answerRe = regexp.MustCompile(`(?:^|[^\d])21(?:[^\d]|$)`)
	svgRe    = regexp.MustCompile(`(?is)<svg.*?</svg>`)
)

// ScoreCandy 评估糖果题回答：含 21 且有推理说明 → pass；仅含答案 → works；否则 degraded。
func ScoreCandy(content string) (string, float64) {
	if !answerRe.MatchString(content) {
		return "degraded", 0
	}
	if len([]rune(content)) > 200 && (strings.Contains(content, "最少") || strings.Contains(content, "保证")) {
		return "pass", 100
	}
	return "works", 70
}

// Combine 综合两项结果：生成了 SVG 时，降智升为可疑，通过满分。
func Combine(result string, score float64, hasSVG bool) (string, float64) {
	if hasSVG && result == "degraded" {
		if score < 50 {
			score = 50
		}
		return "works", score
	}
	if hasSVG && result == "pass" {
		return "pass", 100
	}
	return result, score
}

// ExtractSVG 提取首个完整 <svg>…</svg>。
func ExtractSVG(content string) string { return svgRe.FindString(content) }

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
		return "", 0, 0, 0, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if resp.StatusCode != 200 {
		return "", 0, 0, 0, fmt.Errorf("HTTP %d", resp.StatusCode)
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

// Run 并行执行糖果题与 SVG 生成并综合评分。
func Run(ctx context.Context, hc *http.Client, baseURL, key, model string) Result {
	var candy, svg struct {
		content         string
		in, out, reason int
		err             error
		ms              int
	}
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		t0 := time.Now()
		candy.content, candy.in, candy.out, candy.reason, candy.err = Chat(ctx, hc, baseURL, key, model, CandyPrompt, 4096, 120*time.Second)
		candy.ms = int(time.Since(t0).Milliseconds())
	}()
	go func() {
		defer wg.Done()
		t0 := time.Now()
		svg.content, svg.in, svg.out, svg.reason, svg.err = Chat(ctx, hc, baseURL, key, model, SVGPrompt, 16000, 180*time.Second)
		svg.ms = int(time.Since(t0).Milliseconds())
	}()
	wg.Wait()

	res, score := "degraded", 0.0
	raw := ""
	if candy.err != nil {
		raw = "Error: " + candy.err.Error()
	} else {
		res, score = ScoreCandy(candy.content)
		raw = candy.content
		if r := []rune(raw); len(r) > 2000 {
			raw = string(r[:2000])
		}
	}
	svgCode := ""
	if svg.err == nil {
		svgCode = ExtractSVG(svg.content)
	}
	final, fscore := Combine(res, score, svgCode != "")
	ms := candy.ms
	if svg.ms > ms {
		ms = svg.ms
	}
	return Result{
		Result: final, Score: fscore, RawResponse: raw, SVG: svgCode, HasSVG: svgCode != "", CandyOK: res != "degraded",
		ReasoningTokens: candy.reason + svg.reason, InputTokens: candy.in + svg.in, OutputTokens: candy.out + svg.out, ResponseTimeMs: ms,
	}
}
