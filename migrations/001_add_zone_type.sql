-- 为现有数据库添加zone_type和updated_at字段
ALTER TABLE search_history ADD COLUMN zone_type TEXT DEFAULT 'bottom';
ALTER TABLE search_history ADD COLUMN updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000);
