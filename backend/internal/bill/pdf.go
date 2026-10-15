package bill

import (
	"bytes"
	_ "embed"
	"fmt"
	"strings"

	"github.com/signintech/gopdf"
)

//go:embed assets/NotoSansSC-Regular.ttf
var fontRegular []byte

//go:embed assets/NotoSansSC-Bold.ttf
var fontBold []byte

//go:embed assets/runes.txt
var runesTxt string

//go:embed assets/logo.png
var logoPNG []byte

var glyphs = func() map[rune]bool {
	m := make(map[rune]bool, len(runesTxt))
	for _, r := range runesTxt {
		m[r] = true
	}
	return m
}()

// 版面（A4，单位 pt）与配色（与页面主题蓝一致的浅色账单样式）。
const (
	pageW, pageH = 595.28, 841.89
	mx           = 42.0
	contentW     = pageW - 2*mx
	footerY      = pageH - 44
	bottomLimit  = footerY - 14
)

type rgb struct{ r, g, b uint8 }

var (
	cInk     = rgb{31, 41, 55}
	cMuted   = rgb{120, 128, 142}
	cLine    = rgb{224, 228, 235}
	cHead    = rgb{243, 245, 249}
	cTotal   = rgb{247, 248, 251}
	cPrimary = rgb{47, 85, 164}
	cBox     = rgb{234, 240, 252}
	cBoxLine = rgb{200, 214, 240}
)

type renderer struct {
	pdf  *gopdf.GoPdf
	y    float64
	page int
	doc  *Doc
}

// clean 过滤字体中不存在的字符，避免渲染出缺字方块。
func clean(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r == '\n' || r == '\r' || r == '\t':
			b.WriteRune(' ')
		case glyphs[r]:
			b.WriteRune(r)
		default:
			b.WriteRune('?')
		}
	}
	return b.String()
}

func (p *renderer) font(bold bool, size float64) {
	fam := "r"
	if bold {
		fam = "b"
	}
	_ = p.pdf.SetFont(fam, "", size)
}

func (p *renderer) color(c rgb) { p.pdf.SetTextColor(c.r, c.g, c.b) }

func (p *renderer) fill(c rgb) { p.pdf.SetFillColor(c.r, c.g, c.b) }

func (p *renderer) rect(x, y, w, h float64, c rgb) {
	p.fill(c)
	p.pdf.RectFromUpperLeftWithStyle(x, y, w, h, "F")
}

func (p *renderer) hline(x, y, w float64, c rgb, lw float64) {
	p.pdf.SetStrokeColor(c.r, c.g, c.b)
	p.pdf.SetLineWidth(lw)
	p.pdf.Line(x, y, x+w, y)
}

// text 在 (x,y) 起、宽 w、高 h 的格内绘制单行文本。align: l/r/c。
func (p *renderer) text(s string, x, y, w, h float64, align string) {
	opt := gopdf.CellOption{Align: gopdf.Middle}
	switch align {
	case "r":
		opt.Align |= gopdf.Right
	case "c":
		opt.Align |= gopdf.Center
	default:
		opt.Align |= gopdf.Left
	}
	p.pdf.SetXY(x, y)
	_ = p.pdf.CellWithOption(&gopdf.Rect{W: w, H: h}, clean(s), opt)
}

func (p *renderer) wrap(s string, w float64) []string {
	s = clean(s)
	if s == "" {
		return []string{""}
	}
	lines, err := p.pdf.SplitTextWithOption(s, w, &gopdf.BreakOption{Mode: gopdf.BreakModeStrict, BreakIndicator: 0})
	if err != nil || len(lines) == 0 {
		return []string{s}
	}
	return lines
}

func (p *renderer) newPage() {
	p.pdf.AddPage()
	p.page++
	p.y = 48
}

func (p *renderer) ensure(h float64) {
	if p.y+h > bottomLimit {
		p.newPage()
	}
}

func (p *renderer) section(no, title string) {
	p.ensure(60)
	p.y += 18
	p.font(false, 8.5)
	p.color(cMuted)
	p.text(no, mx, p.y, 22, 16, "l")
	p.font(true, 11)
	p.color(cInk)
	p.text(title, mx+22, p.y, 300, 16, "l")
	p.y += 24
}

type col struct {
	title string
	w     float64 // 占比
	align string
}

func widths(cols []col) []float64 {
	var sum float64
	for _, c := range cols {
		sum += c.w
	}
	out := make([]float64, len(cols))
	for i, c := range cols {
		out[i] = contentW * c.w / sum
	}
	return out
}

func (p *renderer) tableHead(cols []col) {
	ws := widths(cols)
	p.rect(mx, p.y, contentW, 24, cHead)
	p.font(false, 8.5)
	p.color(cMuted)
	x := mx
	for i, c := range cols {
		p.text(c.title, x+8, p.y-1, ws[i]-16, 24, c.align)
		x += ws[i]
	}
	p.y += 24
}

func (p *renderer) tableRow(cols []col, vals []string, bold bool, bg *rgb) {
	ws := widths(cols)
	size := 9.0
	p.font(bold, size)
	lines := make([][]string, len(cols))
	maxL := 1
	for i := range cols {
		lines[i] = p.wrap(vals[i], ws[i]-16)
		if len(lines[i]) > maxL {
			maxL = len(lines[i])
		}
	}
	lh := 13.0
	h := float64(maxL)*lh + 14
	if h < 28 {
		h = 28
	}
	if p.y+h > bottomLimit {
		p.newPage()
		p.tableHead(cols)
		p.font(bold, size)
	}
	if bg != nil {
		p.rect(mx, p.y, contentW, h, *bg)
	}
	p.color(cInk)
	x := mx
	for i, c := range cols {
		for j, ln := range lines[i] {
			p.text(ln, x+8, p.y+7+float64(j)*lh, ws[i]-16, lh, c.align)
		}
		x += ws[i]
	}
	p.y += h
	p.hline(mx, p.y, contentW, cLine, 0.6)
}

// Render 渲染为 PDF 字节。调用前应先 Normalize。
func Render(d *Doc) ([]byte, error) {
	pdf := &gopdf.GoPdf{}
	pdf.Start(gopdf.Config{PageSize: gopdf.Rect{W: pageW, H: pageH}})
	pdf.SetInfo(gopdf.PdfInfo{Title: clean(d.Title), Author: clean(d.Company), Subject: clean(d.PeriodLabel()), Creator: "icloud99"})
	if err := pdf.AddTTFFontData("r", fontRegular); err != nil {
		return nil, fmt.Errorf("加载字体失败: %w", err)
	}
	if err := pdf.AddTTFFontData("b", fontBold); err != nil {
		return nil, fmt.Errorf("加载字体失败: %w", err)
	}
	p := &renderer{pdf: pdf, doc: d}
	p.newPage()
	p.header()
	p.payableBox()
	p.meta()
	p.accountSection()
	p.monthsSection()
	p.itemsSection()
	p.remark()
	p.footers()
	var buf bytes.Buffer
	if _, err := pdf.WriteTo(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func (p *renderer) header() {
	d := p.doc
	// logo + 公司名
	if h, err := gopdf.ImageHolderByBytes(logoPNG); err == nil {
		_ = p.pdf.ImageByHolder(h, mx, p.y, &gopdf.Rect{W: 30, H: 30})
	}
	p.font(true, 13)
	p.color(cInk)
	p.text(d.Company, mx+38, p.y, 220, 18, "l")
	p.font(false, 7.5)
	p.color(cMuted)
	p.text("BILLING STATEMENT", mx+38, p.y+17, 220, 12, "l")
	// 右上：账单月份
	p.font(false, 8.5)
	p.color(cMuted)
	p.text("账单月份", mx+contentW-220, p.y, 220, 14, "r")
	p.font(false, 17)
	p.color(cInk)
	p.text(d.PeriodLabel(), mx+contentW-260, p.y+14, 260, 24, "r")
	p.y += 52
	// 标题
	p.font(true, 25)
	p.color(cInk)
	p.text(d.Title, mx, p.y, 330, 34, "l")
	p.y += 36
	p.font(false, 8.5)
	p.color(cMuted)
	s, e := d.PeriodRange()
	sub := d.Subtitle
	if s != "" {
		sub += "　|　账期 " + s + " 至 " + e
	}
	p.text(sub, mx, p.y, contentW, 14, "l")
	p.y += 22
	p.hline(mx, p.y, contentW, cLine, 0.8)
	p.y += 14
}

func (p *renderer) payableBox() {
	d := p.doc
	h := 52.0
	p.rect(mx, p.y, contentW, h, cBox)
	p.pdf.SetStrokeColor(cBoxLine.r, cBoxLine.g, cBoxLine.b)
	p.pdf.SetLineWidth(0.6)
	p.pdf.RectFromUpperLeftWithStyle(mx, p.y, contentW, h, "D")
	p.font(false, 10)
	p.color(rgb{70, 80, 100})
	p.text("本期应付金额", mx+18, p.y, 200, h, "l")
	p.font(true, 22)
	p.color(cPrimary)
	amt := Fmt(d.Payable())
	p.text(d.Currency+" "+amt, mx+contentW-300-18, p.y, 300, h, "r")
	p.y += h + 16
}

func (p *renderer) meta() {
	d := p.doc
	s, e := d.PeriodRange()
	rows := [][2]string{
		{"导出账号", d.ExportedBy},
		{"导出时间", d.ExportedAt},
		{"账单月份", d.MonthsPlain()},
		{"账期起止", s + " 至 " + e},
	}
	for _, r := range rows {
		if strings.TrimSpace(r[1]) == "" || strings.TrimSpace(r[1]) == " 至 " {
			continue
		}
		p.ensure(20)
		p.font(false, 9)
		p.color(cMuted)
		p.text(r[0], mx, p.y, 70, 18, "l")
		p.color(cInk)
		p.text(r[1], mx+72, p.y, contentW-72, 18, "l")
		p.y += 20
	}
	p.y += 2
	p.hline(mx, p.y, contentW, cLine, 0.8)
}

func (p *renderer) accountSection() {
	cols := []col{{"账号", 1, "l"}, {"账号 ID", 1, "l"}}
	p.section("01", "账户信息")
	p.tableHead(cols)
	id := p.doc.AccountID
	if strings.TrimSpace(id) == "" {
		id = "-"
	}
	p.tableRow(cols, []string{p.doc.Account, id}, false, nil)
}

func (p *renderer) monthsSection() {
	d := p.doc
	cols := []col{{"账单月份", 1.1, "l"}, {"账期开始", 1.2, "l"}, {"账期截止", 1.2, "l"}, {"费用总额", 1, "r"}, {"优惠抵扣", 1, "r"}, {"应付金额", 1.1, "r"}}
	p.section("02", "月度费用汇总")
	p.tableHead(cols)
	for _, m := range d.Months {
		p.tableRow(cols, []string{m.Month, m.Start, m.End, Fmt(m.Total), Fmt(m.Discount), Fmt(m.Payable)}, false, nil)
	}
	tb := cTotal
	p.tableRow(cols, []string{"合计", "", "", Fmt(d.Total()), Fmt(d.Discount()), Fmt(d.Payable())}, true, &tb)
}

func (p *renderer) itemsSection() {
	d := p.doc
	cols := []col{{"资源购买账号", 1.1, "l"}, {"资源归属账号", 1.1, "l"}, {"产品名称", 1.3, "l"}, {"商品名称", 1.2, "l"}, {"账单月份", 0.9, "l"}, {"费用金额", 0.9, "r"}}
	p.section("03", "产品费用明细")
	p.tableHead(cols)
	if len(d.Items) == 0 {
		p.tableRow(cols, []string{"暂无明细", "", "", "", "", ""}, false, nil)
	}
	for _, it := range d.Items {
		p.tableRow(cols, []string{it.Buyer, it.Owner, it.Product, it.Goods, it.Month, Fmt(it.Amount)}, false, nil)
	}
	tb := cTotal
	p.tableRow(cols, []string{"合计", "", "", "", "", Fmt(d.ItemsTotal())}, true, &tb)
}

func (p *renderer) remark() {
	r := strings.TrimSpace(p.doc.Remark)
	if r == "" {
		return
	}
	p.section("04", "备注")
	p.font(false, 9)
	p.color(cInk)
	for _, ln := range p.wrap(r, contentW-8) {
		p.ensure(16)
		p.text(ln, mx+4, p.y, contentW-8, 15, "l")
		p.y += 15
	}
}

// footers 每页底部：金额单位 / 英文名 / 页码。
func (p *renderer) footers() {
	d := p.doc
	total := p.page
	for i := 1; i <= total; i++ {
		_ = p.pdf.SetPage(i)
		p.hline(mx, footerY, contentW, cLine, 0.8)
		p.font(false, 8)
		p.color(cMuted)
		left := d.Footer
		if strings.TrimSpace(left) == "" {
			left = "金额单位：" + d.CurrencyCN
		}
		p.text(left, mx, footerY+6, 300, 14, "l")
		right := fmt.Sprintf("费用账单 / BILLING STATEMENT　%d / %d", i, total)
		p.text(right, mx+contentW-260, footerY+6, 260, 14, "r")
	}
}
