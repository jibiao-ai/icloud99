-- MariaDB schema for 元擎智算可视化

CREATE TABLE IF NOT EXISTS admin_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS api_configs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  provider VARCHAR(50) NOT NULL,
  tier VARCHAR(50) NOT NULL,
  config_json TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_provider_tier (provider, tier)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS channels (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  provider VARCHAR(50) NOT NULL,
  tier VARCHAR(50) DEFAULT '',
  model_id VARCHAR(255) NOT NULL,
  icon VARCHAR(50) DEFAULT '',
  rate_multiplier DOUBLE DEFAULT 1.0,
  is_active TINYINT DEFAULT 1,
  sort_order INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS channel_tests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  channel_id INT NOT NULL,
  response_time_ms INT,
  ping_ms INT,
  success TINYINT DEFAULT 1,
  tested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_channel_id (channel_id),
  INDEX idx_tested_at (tested_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS iq_tests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  provider VARCHAR(50) NOT NULL,
  tier VARCHAR(50) NOT NULL,
  model VARCHAR(255) NOT NULL,
  test_type VARCHAR(50) NOT NULL,
  result VARCHAR(50) NOT NULL,
  score DOUBLE,
  raw_response LONGTEXT,
  reasoning_tokens INT,
  input_tokens INT,
  output_tokens INT,
  response_time_ms INT,
  image_url TEXT DEFAULT '',
  svg_code LONGTEXT DEFAULT NULL,
  tested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tested_at (tested_at),
  INDEX idx_model_tier (model, tier)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  action VARCHAR(100) NOT NULL,
  detail TEXT,
  ip VARCHAR(100) DEFAULT '',
  username VARCHAR(255) DEFAULT 'system',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_action (action),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Default admin user (password: admin123)
INSERT IGNORE INTO admin_users (username, password_hash)
VALUES ('admin', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy');
