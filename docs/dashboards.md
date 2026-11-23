# 仪表插件是怎么显示的，free-pane 怎么接（2026-11-18）

研究范围：GitHub 上带「看板 / 体征 / HUD / 任务监控 / 图表」能力的 DSH 插件。
结论：**显示方式只有三种**，free-pane 能接前两种，第三种要插件自己改成路由或面板。

## 三种形态

### 1. 宿主自带 HTML 页（最好接）

代表：[`1420079678-ctrl/agent-body`](https://github.com/1420079678-ctrl/agent-body) 的 `dsh-anatomy-panel`。

- 宿主半 `ctx.webServer.register` 挂两个 GET：
  - `/anatomy`：自包含 HTML，页面里原生 JS 每 3 秒 `fetch('/anatomy/data.json')`；
  - `/anatomy/data.json`：实时 JSON（心跳、血压、器官、愈合账本、脉冲尾部）。
- 没有客户端 bundle、没有构建链，纯宿主路由。
- free-pane 接法：仪表卡片 `dash:/anatomy` 直接 iframe；`dash:/anatomy/data.json` 摊成指标。

### 2. 宿主 JSON + 客户端浮层（可桥数据，壳接不了）

代表：

- [`3450892121/dsh-task-monitor`](https://github.com/3450892121/dsh-task-monitor)：客户端右侧浮层，数据走 `POST /taskmonitor/data`（sessionId），另有 `/taskmonitor/git/*`。
- [`a903067276-rgb/dsh-hud`](https://github.com/a903067276-rgb/dsh-hud)：客户端 HUD，配置 `/api/dsh-hud/config`、事件 `/api/dsh-hud/events`、diff `/api/dsh-hud/diff`。
- [`ags-neto/dsh-status-telemetry`](https://github.com/ags-neto/dsh-status-telemetry)：composer dock 里的状态胶囊 + 展开面板。

这类插件的「壳」是客户端 slot，free-pane 不能直接 iframe；但它的 JSON 路由可以桥出来，用仪表卡片显示指标，或继续用「面板卡片」去接它注册的右栏 tab。

### 3. 会话卡片 / 工具产物（不能直接路由）

代表：[`66-zhimeng/dsh-chart-lab`](https://github.com/66-zhimeng/dsh-chart-lab)。

- 宿主只注册 `/plugins/dsh-chart-lab/assets` 静态资源；真正的卡片是会话里的 artifact，由客户端组件 + 工具调用生成。
- 没有「一个 URL 就是一张图」的页面，所以 iframe 接不了；要接只能复用它的卡片组件或调它的工具。

## free-pane 的接法

| 插件形态 | 卡片 | 说明 |
|---|---|---|
| HTML 路由 | `dash`（仪表卡片） | 直接 iframe，按 `every` 秒刷新 |
| JSON 路由 | `dash` | 数值 → 指标块；数组 → 行数 chip + 表格；字符串 → KV |
| 客户端右栏面板 | `panel:<kind>`（面板卡片） | 宿主已有的面板直接嵌 |
| 会话 artifact | 暂不接 | 需要插件提供路由或可复用组件 |

仪表卡片内置三个例子（插件没装时显示 HTTP 错误，不会白屏）：

- `dash:/anatomy` — agent-body 解剖面板（HTML）
- `dash:/anatomy/data.json` — 同上 JSON
- `dash:/taskmonitor/data` — dsh-task-monitor JSON（该路由要 POST + sessionId，当前卡片先按 GET 发，插件若拒绝会在卡片里显示状态码）

## 加一个新仪表

1. 先看插件有没有 `ctx.webServer.register`：有 HTML 路由就直接 `dash:<路由>`。
2. 只有 JSON 路由：`dash:<路由>`，卡片会自动摊指标；需要 POST 的，先在 `contentFor('dash:')` 或预设里补 `method/body`。
3. 只有客户端面板：用 `panel:<kind>`；`pickEntries` 里会自动列宿主注册的 panel kind。
4. 只有会话卡片：暂时不做假桥，等插件补路由/组件。

## 桥不通时的内建复刻（0.10.1）

仪表卡片不再停在“404 就报错”。三个预设路由会先经宿主 RPC `probeRoutes` 探活：

- 路由 200：照常桥接（HTML 进 iframe，JSON 摊成指标；`/taskmonitor/data` 用 POST 并带上卡头选中的 `sessionId`）。
- 路由 404：按钮标「未安装」；点开后卡片切到 `内建复刻`：
  - `/anatomy`、`/anatomy/data.json` → 本机 `dsh-bottom-info-bar` 账本（今日 Token/花费、累计、最近活动、最近七天）＋ 会话目录。
  - `/taskmonitor/data` → 最近会话目录 ＋ 当前会话的轮次/步数/上下文占用（读宿主投影缓存）。
- 插件装回后点「重试插件」重新走桥接，内建视图不删除。

这样“看板插件没装”仍然能看到同一批数字，而不是一张写着 404 的空卡。
