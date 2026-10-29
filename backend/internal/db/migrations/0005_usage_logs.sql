-- 0005 使用明细本地库：从 New API 同步的调用明细 + 按天的同步水位 + 可配置参数
CREATE TABLE IF NOT EXISTS usage_logs (
  log_id BIGINT NOT NULL PRIMARY KEY,
  created_at BIGINT NOT NULL,
  user_id BIGINT NOT NULL DEFAULT 0,
  username VARCHAR(100) NOT NULL DEFAULT '',
  token_name VARCHAR(200) NOT NULL DEFAULT '',
  group_name VARCHAR(100) NOT NULL DEFAULT '',
  model VARCHAR(200) NOT NULL DEFAULT '',
  prompt_tokens BIGINT NOT NULL DEFAULT 0,
  completion_tokens BIGINT NOT NULL DEFAULT 0,
  quota BIGINT NOT NULL DEFAULT 0,
  channel BIGINT NOT NULL DEFAULT 0,
  channel_name VARCHAR(200) NOT NULL DEFAULT '',
  request_id VARCHAR(100) NOT NULL DEFAULT '',
  upstream_id VARCHAR(200) NOT NULL DEFAULT '',
  use_time INT NOT NULL DEFAULT 0,
  is_stream TINYINT NOT NULL DEFAULT 0,
  ip VARCHAR(64) NOT NULL DEFAULT '',
  content MEDIUMTEXT NULL,
  KEY idx_created (created_at, log_id),
  KEY idx_user_created (username, created_at, log_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 每个北京时间自然日的同步水位：synced_until >= 当日 23:59:59 即该日已完整落库
CREATE TABLE IF NOT EXISTS usage_log_days (
  day CHAR(10) NOT NULL PRIMARY KEY,
  synced_until BIGINT NOT NULL DEFAULT 0,
  rows_cnt INT NOT NULL DEFAULT 0,
  synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO settings (k, v) VALUES
  ('detail.sync_enabled', '1'),
  ('detail.sync_interval_minutes', '30'),
  ('detail.sync_days', '3'),
  ('detail.retention_days', '180'),
  ('detail.rate_limit', '45');
