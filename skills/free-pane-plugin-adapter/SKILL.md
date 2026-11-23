---
name: free-pane-plugin-adapter
description: Use when a DSH plugin, host route, right-sidebar panel, or client widget should appear inside dsh-free-pane cards, or when an existing card cannot show a plugin's data. Classifies the surface first, then uses the smallest bridge (host RPC, panel embed, page iframe, native card, or same-origin postMessage) and verifies it on the user's machine.
---

# Free-pane plugin bridge

Free-pane 的卡片不是只能画本地 UI；它可以把**宿主的路由、面板、服务、会话和跨卡消息**接进来。先判断插件有什么表面，再选最小桥，不要一上来复制 UI。

## 0. 权限与顺序

1. 先只读：`plugin_manager list_bundles`、读插件 `package.json`、host/client 入口；不读密钥、不碰 `.env`。
2. 报告它有什么：HTTP 路由 / 右栏 tab / 客户端 slot / 会话产物 / 纯 DOM。
3. 让用户选：只报告、只改 free-pane、改插件加路由、写自定义卡。没有明确“改/装/可以”，不要写文件。
4. 写之前列出要改的文件与预期行为；保留 git 可回滚。

## 1. 选桥（从上往下，能高不低）

| 插件提供 | 用的桥 | free-pane 落点 |
|---|---|---|
| HTTP JSON 路由 | **host RPC / dash 数据桥** | `dash:<route>` 指标，或 `std` 数据卡 |
| HTTP HTML 页面 | **页面桥** | `dash:<route>` / `browser` iframe |
| `sidebarRightTabs.register` 的 tab | **面板桥（整份宿主面板）** | `panel` 卡：`tabKind` + `bindId` |
| Cordis 服务 / host 数据库 | **host RPC 桥** | 自定义卡片，客户端 fetch |
| 工具产出的会话文件/产物 | **产物桥** | `files` 卡 / 笔记卡 |
| 只画客户端 slot、没有路由 | **先加只读路由**，或自定义卡 | 不要伪造成 iframe |

**不要**把只存在于客户端 slot 的 React 树硬克隆进卡；slot 的生命周期、store 和权限都不在 iframe 里。

## 2. 新增一种卡（自定义桥）

按这个顺序改 `client.js`，少一步就会“菜单有、打开空”：

1. `ADD_META[id] = { label, icon, note }`。
2. `CANVAS_LABEL[id]`（标题/无障碍名）。
3. `addIds`（**只加互不重复的种类**；变体收进卡内标签，见 `docs/card-kinds.md`）。
4. `contentFor(id)` 返回默认 leaf；需要会话就留空 `sessionId`，不要猜。
5. `normalizeLeaf` / `treeLeaf` 允许的新字段（`bindId`、`tabKind`、`path`…）。
6. `bodyFor`/`body` 分支渲染卡片。
7. CSS 全部用 `.fp-*` 变量与 token；深色模式不能出现白块。
8. 如果卡片要宿主数据，先在 `index.js` 加 `ROUTES.name`。

## 3. Host RPC 桥（最稳）

`index.js`：

```js
ROUTES.myData = async function (args) {
  // 只读、限量、超时；路径必须 resolve 后校验
  return { ok: true, rows: [] }
}
```

- 路由前缀 `/_dsh/dsh-free-pane/`，同源保护 `requestRejection` 已在 dispatcher 里；写操作要 POST。
- 执行命令/打开系统程序必须 POST + `x-fp-local: 1`，不要暴露给任意网页。
- 不返回密钥、token、完整环境变量；大结果分页/截断。
- 客户端 `fetch(RPC_BASE + '/myData', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(args) })`。

## 4. 面板桥（整份宿主面板）

右栏 tab 不要自己重画；把宿主的**整份面板**放进 `panel` 卡：

```js
addContent({ kind:'panel', tabKind:'files', bindId: sessionId })
```

- 选 `cwd` 包含目标文件的会话；`bindId` 让面板副本挂到那场会话。
- 面板副本在 `drivePanelEmbed(sr)` 里等 `[class*=panelBody]`，`sr.toggleExpanded()`，再 `sr.openTab(kind, {})`。
- 要定位单个文件时，用会话相对地址：`dsh-resource://file/session/<sid>/<rel>`，在 sidebar adopt 之后（约 250/900ms 重试）调 `sr.openResourceIn(sid, addr, {kind:'files'})`；调不通就退化为打开面板树，不要留空白 tab。
- 面板首次挂载约 8–10 秒；兜底文案至少等 60 秒，别 6 秒就判失败。
- 不要从父窗口遥控被画布隐藏的右栏；面板卡是自包含的。

## 5. 页面 / dash 桥

- `dash:<route>` 默认 GET；POST 路由在 `contentFor` 里写 `{ method:'POST', body:{...} }`。
- 目标站 `X-Frame-Options: DENY` / CSP 时 iframe 必失败；如实说“不能内嵌”，给系统打开/新窗口，别做假预览。
- 页面桥的 404 要有可读兜底，不能只显示 `Unexpected token`。

## 6. 同源跨卡 `fp:bridge`（v1）

只对**同一 origin 的副本**有效；外部网站没有接收端。

```js
// 源卡
iframe.contentWindow.postMessage({ fp:'bridge', v:1, channel:'session', payload:{ sessionId, title } }, origin)
// 目标副本
window.addEventListener('fp:bridge', (ev) => {
  if (ev.detail.channel === 'session') { /* 切会话 */ }
})
```

通道：`session`（切会话）、`selection`（选中文本）、`file`（打开路径）、`usage`（只展示）。消息只搬运语义，不授予能力；目标侧必须自己实现监听。

## 7. 会话契约（冻结）

- 新会话卡**永远为空**，由用户在标题下拉/会话树里选。
- 只认 `bindId` → `sessionId`；不要按几何、邻居、lastSession、焦点自动绑。
- 一份会话只跑一个活客户端；重复卡显示“改在这里显示/排队”。
- 全局看板、OCR 不挂会话下拉；`usage/context/region` 和 `ctx` 的步骤/事件/文件/命令挂。

详见 `docs/session-operations.md`。

## 8. 验收

- 路由：200、正确 Content-Type、一个样例值。
- 卡片：标题、图标、正文；空/404 可读；约 900×600 与 500×600 不横向溢出。
- 面板：树真的出现（不是“面板还没出来”），文件能点开，深色模式不白。
- 会话：默认空、选了才加载、换会话重读、没有位置自动绑。
- 记录改了哪些文件、桥的契约、仍不支持什么；失败只回滚自己的 diff。

## 8.5 兼容性门槛（别交“预览包”）

- `package.json` 写 `engines.dsh`（已验证的版本范围），没有验证过的版本不要写进去；DSH 会在安装/激活时挡住不满足的 profile。
- 加一个 `npm run preflight`：语法检查、必备文件、`dsh.bundle.patch`、`engines.dsh`，并扫描本机路径 / 固定端口 / 测试会话 id。
- 宿主 CSS 只用 `[class*=centerCol]` 这类**后缀**匹配；结构大改要回归会话宽度、右栏隐藏、面板 tab。
- 明确区分“安装验证”和“运行时验证”；只跑过安装不要声称全版本兼容。把测试矩阵写进 `COMPATIBILITY.md`。
- 非 Windows、非测试版本、目标站 iframe 策略、缺 `dsh-context`/`dsh-ocr-local` 都只是 best-effort，不要写成保证。

## 9. 已知限制

- 终端桥是单命令；没有宿主终端服务时不要假装交互 shell。
- OCR 需要 `dsh-ocr-local`；技能榜/步骤/事件/文件活动/命令需要 `dsh-context`。
- `panel` 卡是完整客户端副本，受活池上限约束；冷卡先点“加载这个面板”。
- 页面桥受目标站 iframe 策略限制；不要绕过。
