# 潜力区币回测工具 - React版本

## 项目说明

本项目是对原始HTML版本的React重构，包含两个独立版本：
- **本地版本**：使用IndexedDB本地存储，直接调用币安API
- **Cloudflare版本**：使用Cloudflare D1数据库，通过Workers代理调用API

两个版本共享所有UI组件和业务逻辑，仅数据层不同。

## 项目结构

```
react-src/
├── src/
│   ├── components/          # 共享UI组件
│   │   ├── Chart/          # K线图表组件
│   │   ├── Controls/       # 控制面板组件
│   │   ├── Sidebar/        # 侧边栏组件
│   │   └── Backtest/       # 回测工具组件
│   ├── services/           # 业务逻辑服务
│   │   ├── indicators.js   # 技术指标计算
│   │   ├── backtest.js     # 回测逻辑
│   │   ├── local/          # 本地版数据层
│   │   └── cloudflare/     # Cloudflare版数据层
│   ├── hooks/              # React Hooks
│   ├── styles/             # 样式文件
│   ├── local/              # 本地版入口
│   │   ├── App.jsx
│   │   └── main.jsx
│   └── cloudflare/         # Cloudflare版入口
│       ├── App.jsx
│       └── main.jsx
├── index-local.html        # 本地版HTML入口
├── index-cloudflare.html   # Cloudflare版HTML入口
├── package.json
├── vite.config.local.js    # 本地版Vite配置
└── vite.config.cloudflare.js # Cloudflare版Vite配置
```

## 安装依赖

```bash
cd react-src
npm install
```

## 开发命令

### 本地版本
```bash
# 开发模式
npm run dev:local

# 构建
npm run build:local
# 输出目录: ../dist-local/
```

### Cloudflare版本
```bash
# 开发模式
npm run dev:cloudflare

# 构建
npm run build:cloudflare
# 输出目录: ../public-react/
```

## 部署说明

### 本地版本
构建后直接打开 `dist-local/index.html` 即可使用。

### Cloudflare版本
1. 构建项目：`npm run build:cloudflare`
2. 将 `public-react/` 目录内容复制到项目根目录的 `public/` 文件夹
3. 按照原有的Cloudflare部署流程部署

## 功能特性

### 核心功能（两个版本一致）
- ✅ K线图表展示（LightweightCharts）
- ✅ 多种技术指标（MA、EMA、布林带）
- ✅ 回测工具（手动开多/开空/平仓）
- ✅ 潜力观察列表（历史记录管理）
- ✅ 数据缓存（自动缓存减少API请求）
- ✅ 导入/导出功能

### 本地版本特有
- 使用IndexedDB本地数据库
- 直接调用币安公开API
- 无需服务器，开箱即用

### Cloudflare版本特有
- 使用Cloudflare D1云数据库
- 通过Workers代理避免CORS
- 全球边缘网络，访问速度快

## 技术栈

- **前端框架**: React 18
- **构建工具**: Vite 5
- **图表库**: LightweightCharts 3.7
- **样式**: CSS（无预处理器）
- **状态管理**: React Hooks（无额外状态库）

## 开发注意事项

1. **组件共享**: 所有UI组件在 `src/components/` 中是两个版本共用的
2. **数据层隔离**: 通过依赖注入（props）传递不同的数据服务
3. **样式统一**: 使用全局CSS，保持两个版本UI完全一致
4. **类型安全**: 建议后续添加TypeScript支持

## 待完成的组件

以下组件架构已设计但需要补充实现：

1. `src/components/Controls/SearchControls.jsx` - 搜索控制面板
2. `src/components/Controls/IndicatorsPanel.jsx` - 技术指标面板
3. `src/components/Controls/BacktestPanel.jsx` - 回测控制面板
4. `src/components/Sidebar/Sidebar.jsx` - 侧边栏容器
5. `src/components/Sidebar/HistoryList.jsx` - 历史列表
6. `src/components/Sidebar/HistoryFilters.jsx` - 历史筛选器

所有组件的业务逻辑已在原始HTML中实现，React化只需：
- 将DOM操作转换为状态管理
- 将事件监听转换为事件处理器
- 提取可复用的子组件

## 迁移检查清单

- [x] 项目结构搭建
- [x] 配置文件（package.json、vite.config）
- [x] 技术指标计算模块
- [x] 回测逻辑模块
- [x] IndexedDB服务（本地版）
- [x] API服务（Cloudflare版）
- [x] 全局样式CSS
- [ ] K线图表组件
- [ ] 控制面板组件
- [ ] 侧边栏组件
- [ ] 主应用组件（本地版）
- [ ] 主应用组件（Cloudflare版）
- [ ] 测试两个版本功能一致性

## 贡献指南

在完成剩余组件时，请遵循以下原则：

1. **保持功能一致性**: 确保React版本与原HTML版本功能完全相同
2. **组件化**: 将大型组件拆分为小的可复用组件
3. **Hooks优先**: 使用自定义Hooks封装复杂逻辑
4. **性能优化**: 使用 `useMemo` 和 `useCallback` 避免不必要的重渲染
5. **代码风格**: 保持一致的命名和代码结构

## 许可证

与原项目保持一致
