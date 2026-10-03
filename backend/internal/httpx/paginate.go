package httpx

import (
	"net/http"
	"strconv"
	"strings"
)

// ListQuery 列表查询参数（默认 10 条/页）。
type ListQuery struct {
	Page      int
	PageSize  int
	SortKey   string
	SortOrder string // asc / desc
	Keyword   string
}

// ParseListQuery 解析 page/pageSize/sortKey/sortOrder/keyword；pageSize 上限 maxSize。
func ParseListQuery(r *http.Request, defSize, maxSize int) ListQuery {
	q := r.URL.Query()
	n := func(k string, def int) int {
		v, err := strconv.Atoi(q.Get(k))
		if err != nil || v < 1 {
			return def
		}
		return v
	}
	lq := ListQuery{Page: n("page", 1), PageSize: n("pageSize", defSize), SortKey: q.Get("sortKey"), SortOrder: strings.ToLower(q.Get("sortOrder")), Keyword: strings.TrimSpace(q.Get("keyword"))}
	if lq.PageSize > maxSize {
		lq.PageSize = maxSize
	}
	if lq.SortOrder != "asc" {
		lq.SortOrder = "desc"
	}
	return lq
}

// Offset SQL 偏移量。
func (q ListQuery) Offset() int { return (q.Page - 1) * q.PageSize }

// Paginate 对内存切片分页，页码越界时回落到最后一页。返回 (当前页数据, 实际页码)。
func Paginate[T any](rows []T, q ListQuery) ([]T, int) {
	total := len(rows)
	pages := (total + q.PageSize - 1) / q.PageSize
	if pages < 1 {
		pages = 1
	}
	page := q.Page
	if page > pages {
		page = pages
	}
	if page < 1 {
		page = 1
	}
	start := (page - 1) * q.PageSize
	end := start + q.PageSize
	if start > total {
		start = total
	}
	if end > total {
		end = total
	}
	return rows[start:end], page
}

// PageResult 统一列表返回。
type PageResult struct {
	List       any `json:"list"`
	Total      int `json:"total"`
	Page       int `json:"page"`
	PageSize   int `json:"pageSize"`
	TotalPages int `json:"totalPages"`
}

// NewPageResult 构造分页结果。
func NewPageResult(list any, total, page, size int) PageResult {
	pages := (total + size - 1) / size
	if pages < 1 {
		pages = 1
	}
	return PageResult{List: list, Total: total, Page: page, PageSize: size, TotalPages: pages}
}
