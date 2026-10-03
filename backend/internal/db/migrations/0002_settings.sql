-- 0002 页面可配置参数（铁律1）：键值表 + New API 管理员连接
CREATE TABLE IF NOT EXISTS settings (
  k VARCHAR(100) NOT NULL PRIMARY KEY,
  v TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS newapi_admin (
  id TINYINT NOT NULL PRIMARY KEY,
  base_url VARCHAR(500) NOT NULL,
  username VARCHAR(100) NOT NULL,
  password_enc TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 默认参数（可在「管理设置 → 系统参数」页面修改）
INSERT IGNORE INTO settings (k, v) VALUES
  ('site.name', '元擎智算'),
  ('site.token_base_url', 'https://api.icloud99.cn'),
  ('site.primary_color', '#6C5CE7'),
  ('monitor.interval_minutes', '60'),
  ('monitor.enabled', '1'),
  ('monitor.retention_days', '90'),
  ('iq.model', 'gpt-6-astra'),
  ('iq.enabled', '1'),
  ('iq.start_hour', '2'),
  ('iq.end_hour', '8'),
  ('radar.url', '');
