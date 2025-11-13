# 潜力区币回测工具 - Cloudflare 部署版

基于 Cloudflare Pages + Workers + D1 的加密货币回测工具，支持查看历史K线数据，分析潜力区币种的价格走势。

## ✨ 特性

- 📊 专业的K线图表（基于 LightweightCharts）
- 🚀 Cloudflare 全球边缘网络，超快访问速度
- 💾 D1 SQLite 数据库自动缓存，避免重复请求
- 🌐 支持所有币安交易对
- ⚡ 分批并发请求，快速获取大量数据
- 🔄 自动使用浏览器本地时区
- 📈 多条均线显示（MA5、MA10、MA20、MA60）

## 🏗️ 项目结构

```
├── public/
│   └── index.html          # 前端页面
├── functions/
│   └── api/
│       ├── klines.ts       # API: 获取K线数据
│       ├── save-klines.ts  # API: 保存K线数据
│       └── binance-proxy.ts # API: 币安代理
├── schema.sql              # D1 数据库表结构
├── wrangler.toml           # Cloudflare 配置
├── package.json
└── README.md
```

## 📦 部署步骤

### 1. 安装依赖

```bash
npm install
```

### 2. 登录 Cloudflare

```bash
npx wrangler login
```

### 3. 创建 D1 数据库

```bash
npx wrangler d1 create backtest-db
```

执行后会返回数据库ID，类似：
```
✅ Successfully created DB 'backtest-db'!
database_id = "xxxx-xxxx-xxxx-xxxx"
```

将 `database_id` 复制到 `wrangler.toml` 文件的 `database_id` 字段。

### 4. 初始化数据库表

```bash
npx wrangler d1 execute backtest-db --file=./schema.sql
```

### 5. 本地开发测试

```bash
npm run dev
```

访问 http://localhost:8788

### 6. 部署到 Cloudflare Pages

#### 方式一：通过命令行部署

```bash
npm run deploy
```

#### 方式二：通过 GitHub 自动部署

1. 将代码推送到 GitHub 仓库
2. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
3. 进入 `Pages` → `Create a project` → `Connect to Git`
4. 选择你的 GitHub 仓库
5. 配置构建设置：
   - **Build command:** `echo "Static site"`
   - **Build output directory:** `public`
6. 在 `Settings` → `Functions` → `D1 database bindings` 中绑定数据库：
   - **Variable name:** `DB`
   - **D1 database:** 选择你创建的 `backtest-db`
7. 点击 `Save and Deploy`

### 7. 绑定自定义域名（可选）

在 Cloudflare Pages 项目设置中，可以绑定自己的域名。

## 🔧 配置说明

### wrangler.toml

```toml
name = "backtest-tool"
compatibility_date = "2024-01-01"

pages_build_output_dir = "public"

[[d1_databases]]
binding = "DB"
database_name = "backtest-db"
database_id = "你的数据库ID"  # 填入第3步创建的数据库ID
```

## 📖 API 接口

### 1. 获取K线数据

```
GET /api/klines?symbol=BTCUSDT&interval=1h&startTime=xxx&endTime=xxx
```

### 2. 保存K线数据

```
POST /api/save-klines
Content-Type: application/json

{
  "symbol": "BTCUSDT",
  "interval": "1h",
  "klines": [[timestamp, open, high, low, close, volume], ...]
}
```

### 3. 币安API代理

```
GET /api/binance-proxy?symbol=BTCUSDT&interval=1h&startTime=xxx&endTime=xxx&limit=1000
```

## 💾 数据库表结构

### klines 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键，格式: `symbol_interval_timestamp` |
| symbol | TEXT | 交易对，如 BTCUSDT |
| interval | TEXT | 时间周期，如 1m, 1h |
| open_time | INTEGER | 开盘时间戳（毫秒） |
| open | REAL | 开盘价 |
| high | REAL | 最高价 |
| low | REAL | 最低价 |
| close | REAL | 收盘价 |
| volume | REAL | 成交量 |
| created_at | INTEGER | 创建时间戳 |

## 🎯 使用说明

1. 输入交易对（如 BTCUSDT）
2. 选择时间点（自动使用浏览器本地时区）
3. 选择K线周期（1m、5m、1h等）
4. 输入兜底/探顶价格
5. 点击搜索，查看K线图表

数据会自动获取当天到后一天的48小时K线数据，并标记你输入的时间点。

## 🚀 性能优化

- ✅ D1 数据库缓存，避免重复请求币安API
- ✅ 分批并发请求，快速获取大量数据
- ✅ Cloudflare Workers 边缘计算，全球低延迟
- ✅ 币安API代理，避免CORS问题

## 📊 免费额度

Cloudflare 免费版额度：

- **Pages:** 无限请求，500次构建/月
- **Workers:** 100,000 请求/天
- **D1 数据库:**
  - 25GB 存储空间
  - 500万行 读取/天
  - 10万行 写入/天

对于个人项目，完全够用！

## 🔗 相关链接

- [Cloudflare Pages 文档](https://developers.cloudflare.com/pages/)
- [Cloudflare D1 文档](https://developers.cloudflare.com/d1/)
- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [币安API文档](https://binance-docs.github.io/apidocs/)

## 📝 License

MIT
