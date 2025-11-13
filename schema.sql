-- K线数据表
CREATE TABLE IF NOT EXISTS klines (
  id TEXT PRIMARY KEY,  -- 格式: symbol_interval_timestamp
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL,
  open_time INTEGER NOT NULL,  -- 时间戳（毫秒）
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume REAL NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- 创建索引优化查询性能
CREATE INDEX IF NOT EXISTS idx_symbol_interval_time
ON klines(symbol, interval, open_time);

CREATE INDEX IF NOT EXISTS idx_symbol_interval
ON klines(symbol, interval);

CREATE INDEX IF NOT EXISTS idx_open_time
ON klines(open_time);

-- 查询历史记录表
CREATE TABLE IF NOT EXISTS search_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  time TEXT NOT NULL,
  interval TEXT NOT NULL,
  price REAL NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_history_symbol
ON search_history(symbol);

CREATE INDEX IF NOT EXISTS idx_history_created_at
ON search_history(created_at DESC);
