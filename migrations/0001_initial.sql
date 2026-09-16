-- 管理员用户表
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- API密钥配置表 (存储各分组的令牌密钥)
CREATE TABLE IF NOT EXISTS api_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,        -- 'openai' or 'anthropic'
  tier TEXT NOT NULL,             -- 'lite', 'standard', 'ultra'
  config_json TEXT NOT NULL,      -- JSON: {"_type":"newapi_channel_conn","key":"...","url":"..."}
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, tier)
);

-- 渠道配置表
CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,         -- 'openai', 'anthropic', 'domestic'
  model_id TEXT NOT NULL,         -- e.g. 'gpt-5.6-sol', 'claude-sonnet-5'
  icon TEXT DEFAULT '',
  rate_multiplier REAL DEFAULT 1.0,
  is_active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 渠道检测结果表
CREATE TABLE IF NOT EXISTS channel_tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL,
  response_time_ms INTEGER,       -- 对话延迟ms
  ping_ms INTEGER,                -- 端点PING ms
  success INTEGER DEFAULT 1,      -- 1=成功 0=失败
  tested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (channel_id) REFERENCES channels(id)
);

-- 智力检测结果表 (鹦鹉骑行/codex-candy-eval)
CREATE TABLE IF NOT EXISTS iq_tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  tier TEXT NOT NULL,
  model TEXT NOT NULL,
  test_type TEXT NOT NULL,        -- 'parrot' (鹦鹉骑行) or 'codex_candy'
  result TEXT NOT NULL,           -- 'pass'=智力通过, 'works'=可以作品, 'degraded'=降智记录
  score REAL,
  raw_response TEXT,
  reasoning_tokens INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  response_time_ms INTEGER,
  tested_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_channel_tests_channel ON channel_tests(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_tests_time ON channel_tests(tested_at);
CREATE INDEX IF NOT EXISTS idx_iq_tests_time ON iq_tests(tested_at);
CREATE INDEX IF NOT EXISTS idx_iq_tests_model ON iq_tests(model, tier);

-- 插入默认管理员 (密码: admin123, bcrypt hash)
INSERT OR IGNORE INTO admin_users (username, password_hash) 
VALUES ('admin', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy');
