# Cloudflare D1 数据库设置指南

本文档说明如何设置和使用 Cloudflare D1 数据库来存储观察列表数据。

## 功能特性

✅ **云端存储** - 观察列表数据保存在 Cloudflare D1 数据库中
✅ **跨设备同步** - 任何设备访问都能看到相同的数据
✅ **永久保存** - 数据不会因为换浏览器或清除缓存而丢失
✅ **自动去重** - 相同币种+时间的记录会自动更新而不是创建新记录
✅ **批量导入** - 支持从JSON文件批量导入观察列表

## 前置要求

1. **Cloudflare 账号** - 免费账号即可
2. **wrangler CLI** - Cloudflare 的命令行工具
3. **Node.js 18+** - 用于构建前端代码

## 部署步骤

### 1. 安装 wrangler（如果尚未安装）

```bash
npm install -g wrangler
```

### 2. 登录 Cloudflare

```bash
wrangler login
```

### 3. 创建 D1 数据库

```bash
cd /home/user/CSRV
npm run d1:create
```

这会创建一个名为 `backtest-db` 的数据库并返回数据库 ID。

### 4. 更新 wrangler.toml

如果数据库 ID 与 `wrangler.toml` 中的不同，请更新：

```toml
[[d1_databases]]
binding = "DB"
database_name = "backtest-db"
database_id = "你的数据库ID"  # 替换为实际的数据库ID
```

### 5. 初始化数据库表结构

```bash
npm run d1:init
```

这会执行 `schema.sql` 文件，创建必要的表和索引。

### 6. 迁移现有数据（可选）

如果数据库已存在但缺少 `zone_type` 字段，运行迁移：

```bash
wrangler d1 execute backtest-db --file=./migrations/001_add_zone_type.sql
```

### 7. 构建前端代码

```bash
npm run build
```

这会构建 Cloudflare 版本的前端代码到 `public/` 目录。

### 8. 部署到 Cloudflare Pages

```bash
npm run deploy
```

或者手动部署：

```bash
wrangler pages deploy public
```

## 本地开发测试

### 使用本地 D1 数据库测试

```bash
npm run dev:wrangler
```

这会启动一个本地开发服务器，使用本地 D1 数据库副本进行测试。

### 查看数据库内容

```bash
# 列出所有观察记录
wrangler d1 execute backtest-db --command="SELECT * FROM search_history ORDER BY created_at DESC"

# 查看记录数量
wrangler d1 execute backtest-db --command="SELECT COUNT(*) as total FROM search_history"
```

## API 端点说明

### 获取观察列表
```
GET /api/watchlist
返回: { success: true, data: [...] }
```

### 保存/更新记录
```
POST /api/watchlist
Body: {
  symbol: "BTCUSDT",
  time: "2024-01-01T12:00",
  interval: "1h",
  price: 45000,
  zone_type: "bottom"  // 或 "top"
}
返回: { success: true, action: "created" | "updated", id: 123 }
```

### 删除记录
```
DELETE /api/watchlist
Body: { id: 123 }
返回: { success: true, action: "deleted", id: 123 }
```

### 批量导入
```
POST /api/watchlist/import
Body: { items: [...] }
返回: {
  success: true,
  imported: 10,  // 新增数量
  updated: 5,    // 更新数量
  failed: 0      // 失败数量
}
```

## 数据结构

### search_history 表

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | INTEGER | 主键，自增 |
| symbol | TEXT | 交易对（如 BTCUSDT） |
| time | TEXT | 观察时间 |
| interval | TEXT | K线周期（如 1h, 4h） |
| price | REAL | 价格 |
| zone_type | TEXT | 区域类型：bottom(兜底区) 或 top(探顶区) |
| created_at | INTEGER | 创建时间戳（毫秒） |
| updated_at | INTEGER | 更新时间戳（毫秒） |

## 数据迁移

### 从本地 localStorage 迁移到 D1

1. 在本地版本中导出观察列表（JSON文件）
2. 部署 Cloudflare 版本后访问
3. 使用导入功能上传 JSON 文件
4. 系统会自动批量导入到 D1 数据库

## 常见问题

### Q: 如何在本地版本和云端版本之间切换？

A: 项目支持两个版本：
- **本地版本**: `npm run build:local` - 数据存储在 localStorage
- **云端版本**: `npm run build` - 数据存储在 D1 数据库

### Q: 数据会丢失吗？

A: 云端版本的数据存储在 Cloudflare D1 数据库中，不会因为换浏览器或清除缓存而丢失。建议定期导出备份。

### Q: 免费配额够用吗？

A: Cloudflare D1 免费配额：
- 每天 100,000 次读操作
- 每天 50,000 次写操作
- 5GB 存储空间

对于个人使用完全足够。

### Q: 如何备份数据？

A: 两种方式：
1. **UI导出**: 使用网页上的"导出备份"按钮下载 JSON 文件
2. **命令行**:
```bash
wrangler d1 execute backtest-db --command="SELECT * FROM search_history" --json > backup.json
```

### Q: 如何清空所有数据？

A: 使用命令行（云端版本的UI不支持批量清空）：
```bash
wrangler d1 execute backtest-db --command="DELETE FROM search_history"
```

## 技术架构

```
前端 (React)
    ↓
Cloudflare Pages
    ↓
Functions API (/api/watchlist)
    ↓
Cloudflare D1 Database
```

## 相关文件

- `wrangler.toml` - Cloudflare 配置
- `schema.sql` - 数据库表结构
- `migrations/001_add_zone_type.sql` - 数据库迁移脚本
- `functions/api/watchlist.ts` - 观察列表 API
- `functions/api/watchlist/import.ts` - 批量导入 API
- `react-src/src/services/cloudflare/api.js` - 前端 API 调用
- `react-src/src/cloudflare/main.jsx` - Cloudflare 版本入口

## 支持

如有问题，请查看：
- [Cloudflare D1 文档](https://developers.cloudflare.com/d1/)
- [Cloudflare Pages 文档](https://developers.cloudflare.com/pages/)
- [项目主文档](./README.md)
