#!/bin/bash
# 初始化数据库（首次使用）

echo "正在初始化数据库..."
npx wrangler d1 execute backtest-db --file=./schema.sql

echo ""
echo "数据库初始化完成！"
echo ""
echo "检查表结构..."
npx wrangler d1 execute backtest-db --command="PRAGMA table_info(search_history)"
