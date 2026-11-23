# Material 命名对照（2026-11-19）

CSS 类名没有全量改名（会碰坏现有选择器）。每种结构元素在 DOM 上多了 `data-m3`，它才是**语义名**；旧 `.fp-*` 类名保留兼容。

| 界面元素 | 旧类 / 节点 | `data-m3` | Material 名称 |
|---|---|---|---|
| 整块画布 | `.fp-canvas` | `surface` | Surface |
| 顶栏 | `.fp-appbar` | `top-app-bar` | Top app bar |
| 卡片外框 | `.fp-win` | `card` | Card |
| 卡片标题栏 | `.fp-win-head` | `card-header` | Card header |
| 卡片内容区 | `.fp-win-body` | — | Card body（内部） |
| 右下添加按钮 | `.fp-fab` | `fab` | FAB (Floating action button) |
| 侧边抽屉 | `.fp-sheet` | `side-sheet` | Side sheet |
| 弹出菜单 | `.fp-menu` | `menu` | Menu |
| 标签条 | `.fp-tabs` / `.fp-btabs` | `tabs` | Tabs |
| 空卡选择器 | `.fp-picker` | `search-picker` | Search picker（含 Search bar） |
| 浮条 / 提示 | `.fp-portal` | — | Snackbar（后续补） |
| 确认框 | `.fp-prompt` | — | Dialog（后续补） |
| 分隔条 | `.fp-divider` | — | Divider（内部） |

## 标准窗口（std）

一套固定接口，四种视图：

```json
{ "title": "…", "subtitle": "…", "metrics": [], "columns": [], "rows": [], "items": [] }
```

- `metrics[]`：`{ label, value, hint, tone }`
- `table`：`columns[{ key, label, numeric }]` + `rows[]`
- `list`：`items[{ primary, secondary, meta, badge }]`
- `progress`：`items[{ label, value, max, unit }]`

卡片工具栏的「JSON」可直接编辑这份数据；「示例」恢复内置样例。

## 本轮删除的重复

- 头部「链条」按钮 + 右键「断开数据源」：与会话下拉重复，删除。
- `api.chainOf`、`api.toggleChain`、`api.ownerOf` 三个别名：只留 `bindFor` / `sessionOwner`。
- `contentFor()` 里重复的 `if (kind === 'files')` 分支：只留一个。
- 自动吸附链（左上邻居 / lastSession / 列表第一）：已由显式 `bindId` 取代。
