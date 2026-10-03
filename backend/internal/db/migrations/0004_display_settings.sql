-- 0004 展示参数：令牌用量查询的额度换算与货币符号（页面可配置）
INSERT IGNORE INTO settings (k, v) VALUES
  ('site.quota_per_unit', '500000'),
  ('site.currency_symbol', '¥');
