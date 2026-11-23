# 插件卡片自查（2026-11-16）

本机 `profiles/desktop/node_modules` 里的 16 个插件，逐个体检「它的卡片能不能单独抠成画布卡片、抠出来能不能用」。

自检方式：`?fpMain=1&fpReset=1&fpCards=1&fpTrace=1` —— 让画布把每种卡片依次真造一遍，
再用 DOM 量它是否渲染出内容（文字长度 / iframe / 输入框 / 高度），结果写进
`%TEMP%\dsh-free-pane-trace.log` 的 `card-probe` 行。最近一次：**19 种卡片，15 项有内容**。

## 结论表

| 插件 | 界面形态 | 能不能单独抠 | 落地方式 |
|---|---|---|---|
| dsh-context | 一整页统计面板（上下文/Token/耗时/趋势） | ✅ 四张卡都能 | 不嵌页面，改用 `ctx:tokens` / `ctx:timing` / `ctx:turns` / `ctx:days` / `context`，读它同一份投影缓存 |
| dsh-bili-whale | 桌面挂件（小鲸鱼 + 余额） | ✅ | `grab:whale`（`.dshwv-root`，按 200px 原始尺寸） |
| dsh-claude-style | 样式 + 输入框底部条 | ✅ 部分 | `grab:stats` / `grab:dock`（走会话副本回传，`live:true`） |
| dsh-whale-widget | 鲸鱼挂件（与 bili-whale 同源 DOM） | ✅ | 同 `grab:whale`，避免重复入口 |
| dsh-bottom-info-bar | 底部信息栏 + 可折叠卡片 | ✅ 整条；卡片需打开时才有 | `grab:bottombar` / `grab:bibcard`（后者仅当它在屏上时出现在菜单） |
| dsh-talk-map | 对话地图（节点芯片） | ✅ 仅在它渲染时 | `grab:talkmap`（`[class*="cardChip"]`，没在屏上就不列） |
| dsh-world | 世界/房间活动卡（`dw-*`） | ✅ 仅在它渲染时 | `grab:worldcard`（`[class*="dw-card"]`、`[class*="dw-bar"]`） |
| dsh-plugin-hub | 插件市场面板（`dph-*`） | ✅ 仅在它渲染时 | `grab:hubarea`（`[class*="dph-area"]`、`[class*="dph-body"]`） |
| dsh-ocr-local | 面板 + 两个模型工具 | ✅ 自建卡 | `ocr` 卡片：选图 → 本机 OCR → 结果推给下方笔记 |
| dsh-plugin-screenshot | 工具（截图） | ❌ 无常驻卡片 DOM | 不虚构；截图需求由「获取（取点）」覆盖 |
| dsh-daily10words | 纯模型工具（每日十词） | ❌ 无卡片 UI | 工具型，只能由对话调用 |
| dsh-office-tools | 纯模型工具（Office 读写） | ❌ 无卡片 UI | 同上 |
| dsh-session-relocate | 菜单/批量操作 | ❌ 无常驻卡片 | 不虚构 |
| dsh-call-session | 会话调用 | ❌ 无常驻卡片 | 同上 |
| dsh-free-pane | 本插件（画布 + 会话卡片…） | — | 自身提供 19 种卡片 |
| （宿主自带） | 会话 / 文件 / 终端 / 设置 / 浏览器 / 插件接口 / 笔记 | ✅ 自建 | 不依赖插件 |

## 两条硬规则

1. **不摆空壳**：抓取类入口只在「此刻真在界面上」时出现（`document.querySelector(sel)` 命中），
   否则点了只能得到空白卡片。`live` 的几项例外 —— 它们的内容由会话副本通过 `postMessage` 回传。
2. **不嵌别人的整页**：插件页面在副本里装不进去（tab 组件不加载，宿主只回「这类内容还没有可用的查看方式」），
   所以一律走「读它同一份数据 / 抓它的 DOM 块」，而不是堆一份客户端。

## 每张卡片都要能单独绑定一场对话

卡片标题栏的链条：`⛓` 断开 / `🔗` 已接上（悬停显示接的是哪场）。默认在小工具卡片上自动接
「左上/正上方那场对话」，一张卡片只有一个输入口，接新源会覆盖旧的；手动断开后会持久记住（`linked:false`）。
