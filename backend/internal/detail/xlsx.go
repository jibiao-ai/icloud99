package detail

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/xuri/excelize/v2"
)

const (
	minPerFile = 1000
	// maxPerFile Excel 单表最多 1048576 行（含表头）。
	maxPerFile = 1_000_000
)

// File 一个已生成的 Excel 文件。
type File struct {
	Name string `json:"name"`
	Path string `json:"-"`
	Rows int    `json:"rows"`
	Size int64  `json:"size"`
}

// Writer 流式写 Excel：边收边写，内存占用与总行数无关；达到每文件行数上限自动换新文件。
type Writer struct {
	dir, base, sheet string
	perFile          int
	f                *excelize.File
	sw               *excelize.StreamWriter
	n                int // 当前文件已写数据行
	parts            []File
	hdr, body        int
}

// ClampPerFile 规范每文件行数。
func ClampPerFile(n int) int {
	if n <= 0 {
		return DefaultRowsPerFile
	}
	if n < minPerFile {
		return minPerFile
	}
	if n > maxPerFile {
		return maxPerFile
	}
	return n
}

// NewWriter 创建写入器。base 为不含扩展名的文件名前缀，sheet 为工作表名（≤31 字符）。
func NewWriter(dir, base, sheet string, perFile int) *Writer {
	return &Writer{dir: dir, base: base, sheet: sheet, perFile: ClampPerFile(perFile)}
}

var colWidths = []float64{20, 10, 9, 16, 18, 12, 24, 14, 18, 14, 10, 12, 9, 9, 16, 44, 32, 9, 10, 16, 30}

func (w *Writer) open() error {
	f := excelize.NewFile()
	if err := f.SetSheetName("Sheet1", w.sheet); err != nil {
		return err
	}
	var err error
	if w.hdr, err = f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Bold: true, Family: "微软雅黑", Size: 11},
		Fill:      excelize.Fill{Type: "pattern", Color: []string{"D9E2F3"}, Pattern: 1},
		Alignment: &excelize.Alignment{Horizontal: "center", Vertical: "center"},
	}); err != nil {
		return err
	}
	if w.body, err = f.NewStyle(&excelize.Style{Font: &excelize.Font{Family: "微软雅黑", Size: 11}}); err != nil {
		return err
	}
	sw, err := f.NewStreamWriter(w.sheet)
	if err != nil {
		return err
	}
	for i, wd := range colWidths {
		if err = sw.SetColWidth(i+1, i+1, wd); err != nil {
			return err
		}
	}
	if err = sw.SetPanes(&excelize.Panes{Freeze: true, YSplit: 1, TopLeftCell: "A2", ActivePane: "bottomLeft"}); err != nil {
		return err
	}
	head := make([]interface{}, len(Headers))
	for i, h := range Headers {
		head[i] = excelize.Cell{StyleID: w.hdr, Value: h}
	}
	if err = sw.SetRow("A1", head); err != nil {
		return err
	}
	w.f, w.sw, w.n = f, sw, 0
	return nil
}

func (w *Writer) rotate() error {
	if w.f == nil {
		return nil
	}
	if err := w.sw.Flush(); err != nil {
		return err
	}
	p := filepath.Join(w.dir, fmt.Sprintf("part-%03d.xlsx", len(w.parts)+1))
	if err := w.f.SaveAs(p); err != nil {
		return err
	}
	_ = w.f.Close()
	st, err := os.Stat(p)
	if err != nil {
		return err
	}
	w.parts = append(w.parts, File{Path: p, Rows: w.n, Size: st.Size()})
	w.f, w.sw = nil, nil
	return nil
}

func nz(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

// Add 追加一行。
func (w *Writer) Add(r Row) error {
	if w.f == nil {
		if err := w.open(); err != nil {
			return err
		}
	}
	vals := []interface{}{r.Time, r.LogID, r.UserID, nz(r.Username), nz(r.TokenName), nz(r.Group), nz(r.Model), r.Prompt, r.Completion,
		r.Total, r.Quota, r.CostUSD, r.LogType, r.Channel, nz(r.ChannelName), nz(r.RequestID), nz(r.UpstreamID), r.UseTime, r.IsStream, nz(r.IP), nz(r.Content)}
	if err := w.sw.SetRow(fmt.Sprintf("A%d", w.n+2), vals, excelize.RowOpts{StyleID: w.body}); err != nil {
		return err
	}
	w.n++
	if w.n >= w.perFile {
		return w.rotate()
	}
	return nil
}

// Close 收尾并给文件正式命名：只有一个文件时为 base.xlsx，否则 base_第N部分.xlsx。无数据时生成只有表头的空表。
func (w *Writer) Close() ([]File, error) {
	if w.f == nil && len(w.parts) == 0 {
		if err := w.open(); err != nil {
			return nil, err
		}
	}
	if err := w.rotate(); err != nil {
		return nil, err
	}
	for i := range w.parts {
		name := w.base + ".xlsx"
		if len(w.parts) > 1 {
			name = fmt.Sprintf("%s_第%d部分.xlsx", w.base, i+1)
		}
		np := filepath.Join(w.dir, name)
		if err := os.Rename(w.parts[i].Path, np); err != nil {
			return nil, err
		}
		w.parts[i].Name, w.parts[i].Path = name, np
	}
	return w.parts, nil
}

// Abort 放弃：关闭未完成的文件（调用方负责删除目录）。
func (w *Writer) Abort() {
	if w.f != nil {
		_ = w.f.Close()
		w.f, w.sw = nil, nil
	}
}
