package usage

import (
	"sort"

	"icloud99/internal/newapi"
)

// ModelAgg 模型聚合。
type ModelAgg struct {
	Quota  float64
	Count  float64
	Tokens float64
}

// UserAgg 用户聚合。
type UserAgg struct {
	ID          int64
	Username    string
	DisplayName string
	Group       string
	Role        int
	Status      int
	Balance     float64
	Quota       float64
	Count       float64
	Tokens      float64
	Models      map[string]*ModelAgg
	Days        map[string]float64
	Months      map[string]float64
	FirstAt     int64
	LastAt      int64
}

// NewUserAgg 由 New API 用户创建聚合。
func NewUserAgg(u newapi.User) *UserAgg {
	return &UserAgg{
		ID: u.ID, Username: u.Username, DisplayName: u.DisplayName, Group: u.Group, Role: u.Role,
		Status: u.Status, Balance: float64(u.Quota),
		Models: map[string]*ModelAgg{}, Days: map[string]float64{}, Months: map[string]float64{},
	}
}

// AddRows 把 /api/data/ 的行累加到用户聚合；周期外或他人数据被忽略。
func (a *UserAgg) AddRows(rows []newapi.QuotaRow, p Period) {
	for _, r := range rows {
		if r.Username != "" && r.Username != a.Username {
			continue
		}
		if r.CreatedAt < p.StartTs || r.CreatedAt > p.EndTs {
			continue
		}
		a.Quota += r.Quota
		a.Count += r.Count
		a.Tokens += r.TokenUsed
		name := r.ModelName
		if name == "" {
			name = "unknown"
		}
		m := a.Models[name]
		if m == nil {
			m = &ModelAgg{}
			a.Models[name] = m
		}
		m.Quota += r.Quota
		m.Count += r.Count
		m.Tokens += r.TokenUsed
		day := TsToDay(r.CreatedAt)
		a.Days[day] += r.Quota
		a.Months[day[:7]] += r.Quota
		if a.FirstAt == 0 || r.CreatedAt < a.FirstAt {
			a.FirstAt = r.CreatedAt
		}
		if r.CreatedAt > a.LastAt {
			a.LastAt = r.CreatedAt
		}
	}
}

// Reconciled 与后台 /api/log/stat 对账：误差不超过 max(1000, 0.1%) 视为一致。
func Reconciled(site, sum float64) bool {
	tol := site * 0.001
	if tol < 1000 {
		tol = 1000
	}
	d := site - sum
	if d < 0 {
		d = -d
	}
	return d <= tol
}

// TopModel 模型排行项。
type TopModel struct {
	Model  string  `json:"model"`
	Quota  float64 `json:"quota"`
	Amount float64 `json:"amount"`
	Count  float64 `json:"count"`
	Tokens float64 `json:"tokens"`
}

// UserRow 返回给前端的用户行。
type UserRow struct {
	ID           int64              `json:"id"`
	Username     string             `json:"username"`
	DisplayName  string             `json:"displayName"`
	Group        string             `json:"group"`
	Role         int                `json:"role"`
	Status       int                `json:"status"`
	Quota        float64            `json:"quota"`
	Amount       float64            `json:"amount"`
	Count        float64            `json:"count"`
	Tokens       float64            `json:"tokens"`
	Balance      float64            `json:"balance"`
	Share        float64            `json:"share"`
	MonthAmounts map[string]float64 `json:"monthAmounts"`
	TopModels    []TopModel         `json:"topModels"`
	FirstAt      int64              `json:"firstAt"`
	LastAt       int64              `json:"lastAt"`
}

// ModelTotal 全站模型汇总。
type ModelTotal struct {
	Model  string  `json:"model"`
	Quota  float64 `json:"quota"`
	Count  float64 `json:"count"`
	Tokens float64 `json:"tokens"`
	Users  int     `json:"users"`
	Amount float64 `json:"amount"`
}

// GroupTotal 分组汇总。
type GroupTotal struct {
	Group  string  `json:"group"`
	Quota  float64 `json:"quota"`
	Users  int     `json:"users"`
	Amount float64 `json:"amount"`
}

// DayTotal 每日汇总。
type DayTotal struct {
	Day    string  `json:"day"`
	Quota  float64 `json:"quota"`
	Amount float64 `json:"amount"`
}

// Totals 周期总览。
type Totals struct {
	Quota           float64  `json:"quota"`
	Amount          float64  `json:"amount"`
	Count           float64  `json:"count"`
	Tokens          float64  `json:"tokens"`
	RegisteredUsers int      `json:"registeredUsers"`
	ActiveUsers     int      `json:"activeUsers"`
	AvgPerActive    float64  `json:"avgPerActiveUser"`
	SiteQuota       float64  `json:"siteQuota"`
	SiteAmount      *float64 `json:"siteAmount"`
	Reconciled      *bool    `json:"reconciled"`
}

// Summary 周期汇总结果。
type Summary struct {
	Period   Period       `json:"period"`
	Currency Currency     `json:"currency"`
	Totals   Totals       `json:"totals"`
	Months   []string     `json:"months"`
	Daily    []DayTotal   `json:"daily"`
	Models   []ModelTotal `json:"models"`
	Groups   []GroupTotal `json:"groups"`
	Users    []UserRow    `json:"users"`
	Meta     Meta         `json:"meta"`
}

// Meta 汇总元信息。
type Meta struct {
	Source      string   `json:"source"`
	Candidates  int      `json:"candidates"`
	Errors      []string `json:"errors"`
	ElapsedMs   int64    `json:"elapsedMs"`
	GeneratedAt int64    `json:"generatedAt"`
	Cached      bool     `json:"cached"`
}

// Assemble 把用户聚合装配成 Summary（纯函数）。siteQuota<0 表示未对账。
func Assemble(p Period, cur Currency, aggs []*UserAgg, siteQuota float64) Summary {
	days := p.ListDays()
	months := p.ListMonths()
	daily := make(map[string]float64, len(days))
	for _, d := range days {
		daily[d] = 0
	}
	modelTotals := map[string]*ModelTotal{}
	groupTotals := map[string]*GroupTotal{}
	var sum, cnt, tok float64
	for _, a := range aggs {
		sum += a.Quota
		cnt += a.Count
		tok += a.Tokens
		for d, q := range a.Days {
			if _, ok := daily[d]; ok {
				daily[d] += q
			}
		}
		for m, v := range a.Models {
			t := modelTotals[m]
			if t == nil {
				t = &ModelTotal{Model: m}
				modelTotals[m] = t
			}
			t.Quota += v.Quota
			t.Count += v.Count
			t.Tokens += v.Tokens
			t.Users++
		}
		if a.Quota > 0 {
			g := a.Group
			if g == "" {
				g = "default"
			}
			gt := groupTotals[g]
			if gt == nil {
				gt = &GroupTotal{Group: g}
				groupTotals[g] = gt
			}
			gt.Quota += a.Quota
			gt.Users++
		}
	}
	sorted := append([]*UserAgg(nil), aggs...)
	sort.SliceStable(sorted, func(i, j int) bool {
		if sorted[i].Quota != sorted[j].Quota {
			return sorted[i].Quota > sorted[j].Quota
		}
		return sorted[i].ID < sorted[j].ID
	})
	rows := make([]UserRow, 0, len(sorted))
	active := 0
	for _, a := range sorted {
		ma := make(map[string]float64, len(months))
		for _, m := range months {
			ma[m] = cur.Money(a.Months[m])
		}
		type kv struct {
			k string
			v *ModelAgg
		}
		var ms []kv
		for k, v := range a.Models {
			ms = append(ms, kv{k, v})
		}
		sort.Slice(ms, func(i, j int) bool { return ms[i].v.Quota > ms[j].v.Quota })
		if len(ms) > 5 {
			ms = ms[:5]
		}
		top := make([]TopModel, 0, len(ms))
		for _, x := range ms {
			top = append(top, TopModel{x.k, x.v.Quota, cur.Money(x.v.Quota), x.v.Count, x.v.Tokens})
		}
		share := 0.0
		if sum > 0 {
			share = a.Quota / sum
		}
		if a.Quota > 0 || a.Count > 0 {
			active++
		}
		rows = append(rows, UserRow{
			ID: a.ID, Username: a.Username, DisplayName: a.DisplayName, Group: a.Group, Role: a.Role, Status: a.Status,
			Quota: a.Quota, Amount: cur.Money(a.Quota), Count: a.Count, Tokens: a.Tokens, Balance: cur.Money(a.Balance),
			Share: share, MonthAmounts: ma, TopModels: top, FirstAt: a.FirstAt, LastAt: a.LastAt,
		})
	}
	dl := make([]DayTotal, 0, len(days))
	for _, d := range days {
		dl = append(dl, DayTotal{d, daily[d], cur.Money(daily[d])})
	}
	mt := make([]ModelTotal, 0, len(modelTotals))
	for _, v := range modelTotals {
		v.Amount = cur.Money(v.Quota)
		mt = append(mt, *v)
	}
	sort.Slice(mt, func(i, j int) bool { return mt[i].Quota > mt[j].Quota })
	gt := make([]GroupTotal, 0, len(groupTotals))
	for _, v := range groupTotals {
		v.Amount = cur.Money(v.Quota)
		gt = append(gt, *v)
	}
	sort.Slice(gt, func(i, j int) bool { return gt[i].Quota > gt[j].Quota })

	t := Totals{Quota: sum, Amount: cur.Money(sum), Count: cnt, Tokens: tok, RegisteredUsers: len(aggs), ActiveUsers: active, SiteQuota: siteQuota}
	if active > 0 {
		t.AvgPerActive = cur.Money(sum / float64(active))
	}
	if siteQuota >= 0 {
		a := cur.Money(siteQuota)
		r := Reconciled(siteQuota, sum)
		t.SiteAmount, t.Reconciled = &a, &r
	}
	return Summary{Period: p, Currency: cur, Totals: t, Months: months, Daily: dl, Models: mt, Groups: gt, Users: rows}
}
