package bootstrap

import (
	"context"
	"database/sql"
)

// ChannelDef 渠道目录项。
type ChannelDef struct {
	Provider string
	Model    string
	Label    string
}

// Catalog 渠道目录：provider × 模型；每个模型在 lite/standard/ultra 三个分组各一条。
var Catalog = []ChannelDef{
	{"openai", "gpt-5.6-sol", "GPT-5.6-SOL"},
	{"openai", "gpt-6-astra", "GPT-6-ASTRA"},
	{"openai", "gpt-5.6-terra", "GPT-5.6-TERRA"},
	{"openai", "gpt-6-sol", "GPT-6-SOL"},
	{"anthropic", "claude-opus-4-6", "Claude-Opus-4-6"},
	{"anthropic", "claude-fable-5", "Claude-Fable-5"},
	{"anthropic", "claude-opus-4-7", "Claude-Opus-4-7"},
	{"anthropic", "claude-opus-4-8", "Claude-Opus-4-8"},
}

// TierNames 分组显示名。
var TierNames = map[string]string{"lite": "Lite", "standard": "Standard", "ultra": "Ultra"}

// Tiers 分组顺序。
var Tiers = []string{"lite", "standard", "ultra"}

// SeedChannels 幂等写入渠道目录（不覆盖历史检测数据、不写入任何密钥）。返回新增条数。
func SeedChannels(ctx context.Context, db *sql.DB) (int, error) {
	added := 0
	for _, tier := range Tiers {
		for i, c := range Catalog {
			order := i%4 + 1
			res, err := db.ExecContext(ctx, `INSERT INTO channels(name,provider,tier,model_id,icon,rate_multiplier,sort_order)
				SELECT ?,?,?,?,'',1.0,? FROM DUAL
				WHERE NOT EXISTS (SELECT 1 FROM channels WHERE provider=? AND tier=? AND model_id=?)`,
				TierNames[tier]+" · "+c.Label, c.Provider, tier, c.Model, order, c.Provider, tier, c.Model)
			if err != nil {
				return added, err
			}
			if n, _ := res.RowsAffected(); n > 0 {
				added++
			}
		}
	}
	return added, nil
}

// RemoveModel 删除某模型的全部渠道及其检测记录（用于清理无效渠道）。
func RemoveModel(ctx context.Context, db *sql.DB, model string) (int64, error) {
	if _, err := db.ExecContext(ctx, `DELETE t FROM channel_tests t JOIN channels c ON c.id=t.channel_id WHERE c.model_id=?`, model); err != nil {
		return 0, err
	}
	res, err := db.ExecContext(ctx, `DELETE FROM channels WHERE model_id=?`, model)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
