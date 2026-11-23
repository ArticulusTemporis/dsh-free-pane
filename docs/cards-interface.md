# 卡片接口约定（给下一轮加卡片的人）

这一版把「卡片」从一堆手写组件收成了一套固定接口：内容自己决定名字、尺寸自己适配、数据源
自己声明。加一张新卡片只需要动下面四处，不需要碰布局、拖拽、右键菜单这些公共代码。

## 1. 加一种卡片（kind）

1. **类型表** `KINDS`（`client.js` 里的 `PICK_ENTRIES` / `pickEntries`）：加一条
   `{ kind, label, group }`。`group` 决定它在类型选择器里落在哪一组（对话 / dsh-context /
   工具 / 抓取 / 面板），没有 `group` 会被归到「其他」。图标走 `appIconName(kind)`（返回
   Material Symbols 的名字，见 `client.js` 里的 `ICONS` 表）、配色走 `appTone(kind)`，不写就用默认。
2. **内容构造** `contentFor(kind)`：返回这张卡的初始字段（比如 `{ kind:'ctx', ctxMode:'dash' }`）。
   带 `:` 的写法（`ctx:dash`、`session:<id>`、`panel:<tab>`）在这里拆开，所以
   `?fpAdd=ctx:dash,session:xxx` 能直接造卡，验收脚本都靠它。
3. **渲染** 卡片体在 `CanvasLeaf` 的 `body` 分支里按 `leaf.kind` 分派；复杂卡片写成独立组件
   （参考 `CtxTable` / `FilesCell` / `ApiCell`），只接收 `{ leaf, api }`：
   - `api.onPatch(leafId, fields)` 改这张卡的字段（换会话、切标签都要走它，才会进撤销栈）；
   - `api.bindFor(leaf)` 拿这张卡当前接的会话 id；
   - `api.pushToNote(text)` 把内容甩到笔记卡；
   - `api.onOpenUrl(url)` 开成网页卡片（**不要用 `window.open`**：合成点击下会被浏览器拦）。
4. **名字** `canvasTitle(leaf)`：按内容自己取。用户右键改名写进 `leaf.title`，优先级最高。
   新 kind 在这里加一条分支；没有分支的 kind 会退回 `CANVAS_LABEL[kind]`。

## 2. 尺寸与响应式

- 卡片根 `.fp-win` 是容器查询的容器（`container-type: inline-size`），**内容只按容器宽度
  适配**，不要按窗口宽度写 media query。
- 表格统一用 `DataTable`：宽度 > 300px 时是真表格（表头 sticky、数字右对齐、`.opt` 列在
  ≤ 320px 时自动隐藏）；≤ 300px 时自动折成「列名 + 值」的列表（靠 `td[data-l]`）。
- 卡片被挤到 < 220px 时标题栏会收紧（`.fp-win-btn` 变小、普通按钮隐藏）。
- 一次加很多张卡（> 3 张）时，画布会自动摆成网格（`tidyIfTight` → `gridTreeOf`），
  保证每张至少约 230px 宽，不会出现 66px 的细条。

## 3. 数据源：dsh-context 的每一张表

看板卡片（kind `ctx`，模式在 `CTX_TABS` 里）直接打插件自己的 HTTP 接口，全部是
**POST + JSON**、`credentials: 'same-origin'`（跨端口时由代理带上宿主 cookie）：

| 卡片标签 | `ctxMode` | 接口 | body | 关键字段 |
| --- | --- | --- | --- | --- |
| 总览 | `dash` | `api/dsh-context/overview` | `{part:'summary'}` | `sessions/turns/tokens/costUsd/cacheHit/tokenParts/timing` |
| 会话 | `sessions` | `overview` | `{part:'page'}` | `items[{id,title,turns,tokens,updatedAt}]`、`total` |
| 每日 | `cal` | `overview` | `{part:'days'}` | `{ '2026-11-17': {tokens,sessions,costUsd} }` |
| 技能 | `skills` | `overview` | `{part:'tally'}` | `{field,stats[{name,n,sessions,last}]}` |
| 明细 | `steps` | `detail` | `{sessionId}` | `requests[{turn,step,prompt,cacheRead,output,activeMs}]` |
| 事件 | `events` | `detail` | `{sessionId}` | `events[{seq,kind,form,tokens,name}]` |
| 文件 | `files` | `detail` | `{sessionId}` | `fileOps[{path,kind,tool,added,removed,time}]` |
| 命令 | `commands` | `detail` | `{sessionId}` | `commands[{time,tool,cmd}]`、`commandStats` |

还没做成卡片的接口：`balance`（余额）、`skills`（技能目录）、`recom`（推荐）、`facts`、
`fleet`、`heads`、`delta`、`backfill`、`version`。加它们的路子一样：在 `CtxTable` 里多一个
`else if (mode === '...')` 分支 + 往 `CTX_TABS` 里加一个标签。

**会话 id 用完整写法**（`session-<uuid>`），dsh-context 不接受裁剪过的 uuid。

## 4. 宿主 RPC（`index.js` 的 `ROUTES`）

派发是按名字查表的：`if (!Object.prototype.hasOwnProperty.call(ROUTES, method)) respond(404)`，
所以加一个方法只要往 `ROUTES` 里塞函数即可，前端用 `POST /_dsh/dsh-free-pane/<name>` 调它。
现有：`listSessions, contextStats, usageSnapshot, plugins, listDir, readFile, openPath,
statPath, exec, ocr, gitStatus, probeSessions, webRoutes, screenshot` 等。

## 5. 验收脚本

```powershell
# 1) 改完先查语法
node --check client.js; node --check index.js
# 2) 让宿主重载（端口会变，必须重读）
#    plugin_manager: include:free-pane enabled=false -> true
Get-Content "$env:TEMP\dsh-free-pane-proxy.json" -Raw | ConvertFrom-Json | % port
# 3) 开页面（?fpAdd 直接造卡，?fpReset 从空画布开始，?fpTrace 写 trace.log）
#    http://127.0.0.1:<port>/?fpMain=1&fpReset=1&fpTrace=1&fpAdd=ctx:dash,ctx:sessions
# 4) CDP 驱动：$env:FP_PAGE='<port>'; node fp-cdp.js eval "@x.js" / shot / click x y
```

trace 里几个好用的探针事件：`nav-ok`（副本进对话用了多少毫秒）、`veil-drop` / `veil-ui`
（遮罩撤掉几次）、`tidy-grid`（自动排成网格）、`unpin-click` / `unpin-undo`（侧栏取消固定
与撤销）、`ctx-open`（右键菜单打开）。
