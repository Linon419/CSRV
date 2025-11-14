#!/bin/bash
# 检查数据库表结构

echo "检查 search_history 表结构..."
npx wrangler d1 execute backtest-db --command="PRAGMA table_info(search_history)"

echo ""
echo "检查是否有数据..."
npx wrangler d1 execute backtest-db --command="SELECT COUNT(*) as total FROM search_history"
