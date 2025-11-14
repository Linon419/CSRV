#!/bin/bash
# 迁移数据库（添加 zone_type 字段到已有表）

echo "正在迁移数据库..."
npx wrangler d1 execute backtest-db --file=./migrations/001_add_zone_type.sql

echo ""
echo "数据库迁移完成！"
echo ""
echo "检查表结构..."
npx wrangler d1 execute backtest-db --command="PRAGMA table_info(search_history)"
