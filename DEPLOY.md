# 部署指南 - React版本

## 📋 前提条件

确保已安装：
- Node.js 18+
- npm 或 yarn

## 🚀 部署到 Cloudflare Pages

### 方式一：命令行部署（推荐）

#### 1. 安装依赖

```bash
# 安装根目录依赖（Wrangler）
npm install

# 安装React项目依赖
cd react-src
npm install
cd ..
```

#### 2. 登录 Cloudflare

```bash
npx wrangler login
```

#### 3. 创建 D1 数据库（首次部署）

```bash
npm run d1:create
```

执行后会返回数据库ID，将其填入 `wrangler.toml` 的 `database_id` 字段：

```toml
[[d1_databases]]
binding = "DB"
database_name = "backtest-db"
database_id = "你的数据库ID"  # 填入这里
```

#### 4. 初始化数据库表（首次部署）

```bash
npm run d1:init
```

#### 5. 构建并部署

```bash
npm run deploy
```

这个命令会：
1. 构建React应用到 `public/` 目录
2. 部署到Cloudflare Pages

### 方式二：通过 GitHub 自动部署

#### 1. 推送代码到 GitHub

```bash
git add .
git commit -m "Update deployment config"
git push
```

#### 2. 在 Cloudflare Dashboard 配置

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 `Pages` → `Create a project` → `Connect to Git`
3. 选择你的 GitHub 仓库
4. 配置构建设置：
   ```
   Build command: npm run build
   Build output directory: public
   ```

5. 在 `Settings` → `Functions` → `D1 database bindings` 中绑定数据库：
   - **Variable name:** `DB`
   - **D1 database:** 选择 `backtest-db`

6. 点击 `Save and Deploy`

## 🔄 更新已部署的应用

### 更新代码

```bash
# 重新构建并部署
npm run deploy
```

### 更新数据库结构

如果修改了 `schema.sql`：

```bash
npm run d1:init
```

## 🛠️ 开发环境

### 本地开发（React开发服务器）

```bash
npm run dev
```

访问 http://localhost:5173

### 本地开发（使用Wrangler模拟Cloudflare环境）

```bash
# 先构建
npm run build

# 然后启动Wrangler dev服务器
npm run dev:wrangler
```

访问 http://localhost:8788

## 📁 目录结构说明

```
CSRV/
├── react-src/               # React源代码
│   ├── src/
│   │   └── components/
│   │       └── App.jsx     # 主组件（包含回放功能）
│   ├── index-cloudflare.html  # Cloudflare版入口HTML
│   ├── vite.config.cloudflare.js  # Cloudflare构建配置
│   └── package.json
├── public/                  # 构建输出目录（由vite生成）
│   ├── index.html
│   └── assets/
├── functions/               # Cloudflare Functions (API)
│   └── api/
├── wrangler.toml           # Cloudflare配置
├── schema.sql              # D1数据库结构
└── package.json            # 根package.json
```

## 🎯 npm脚本说明

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动React开发服务器 |
| `npm run build` | 构建React应用到public/ |
| `npm run deploy` | 构建并部署到Cloudflare |
| `npm run dev:wrangler` | 启动Wrangler本地服务器 |
| `npm run d1:create` | 创建D1数据库 |
| `npm run d1:init` | 初始化数据库表 |

## ⚠️ 注意事项

1. **首次部署**必须先创建D1数据库并初始化表结构
2. **构建输出**直接到 `public/` 目录，会覆盖旧文件
3. **API Functions** 在 `functions/api/` 目录，自动部署
4. **环境变量**通过Wrangler绑定，无需.env文件

## 🔍 常见问题

### Q: 部署后看不到最新代码？
A: 执行 `npm run deploy` 重新构建并部署

### Q: D1数据库报错？
A: 确认 `wrangler.toml` 中的 `database_id` 正确填写

### Q: 本地开发无法访问？
A: 使用 `npm run dev` 启动开发服务器，访问 http://localhost:5173

### Q: 如何查看构建输出？
A: 构建后的文件在 `public/` 目录

## 📊 Cloudflare 免费额度

- **Pages:** 无限请求，500次构建/月
- **Workers:** 100,000 请求/天
- **D1:** 25GB存储，500万行读取/天，10万行写入/天

对于个人项目完全够用！
