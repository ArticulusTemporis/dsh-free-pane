# 会话卡片：95% 那版是怎么做的（交接给新会话）

> 用途：新会话接手 `D:\fix\packages\dsh-free-pane` 时，先读这一页，别再从零推。
> 结论先行：**当年能进对话的那版，用的是 `fpEmbed=pure` + 「在副本里点会话行」的导航**；
> 后来为了让卡片显示「完整界面」改成 `fpEmbed=off`，侧栏变成抽屉、会话行不在可达 DOM 里，
> 于是一路卡在欢迎页（trace 里 `ms:0 / row:false / keys:10`），表现为「会话卡加载很慢」。

## 1. 会话卡的形态

- 一张会话卡 = **一份完整客户端副本**，装在 `iframe.fp-frame` 里。
- **一卡一个 origin**：host 侧起 9 个反向代理（`PROXY_COUNT = 9`，`startProxies()`），
  `proxyFor(leafId)` 按树序轮转分配端口。原因：浏览器每个 origin 只给 6 条连接，
  两份客户端同源会互相饿死（第二份连注入脚本都不跑，卡在 `Loading plugins…`）。
- iframe 的 `src`（**这是能用的那个版本**）：

  ```
  <proxy>/?autoSession=session-<uuid>&fpEmbed=pure&fpN=<Date.now()>
  ```

  - `autoSession` → 注入脚本据此知道要进哪场会话；
  - `fpEmbed=pure` → 注入脚本走「纯净嵌入」分支：藏左右栏、把中间列铺满、保留输入框；
  - `fpN` → 防浏览器缓存（注入脚本改动后不加这个会一直跑旧 HTML）。
- **反面教材**：`fpEmbed=off`（完整界面）虽然信息全，但侧栏是**抽屉收起态**，
  `[data-row-key]` 不可达 → 导航必然失败。要显示完整界面，也得先用 pure 进去再切。

## 2. 注入脚本（`index.js` 里拼进 HTML 的那段字符串）

入口守卫：`if (window.top === window.self && !/[?&]fpForce=1/.test(location.search)) return;`

`tick()`（大约 400ms 一轮）里的顺序很关键：

```
hideBodyLayers();      // 只藏面积 < 85% 视口的 body 直系子节点（宠物/吐司/浮提示）
collapseEmptyPanes();  // 宽或高 < 2 的 [class*=tabCell] → display:none（停靠布局的空格子会占 50%）
openSession();         // 导航
if (!SID || ok) hideSiblings();
hideRightColumn();
```

导航的三个零件：

- `sessionRow()`：`[data-row-key*="<UUID>"]`，**UUID 是去掉 `session-` 前缀的裸 uuid**
  （行 key 两种写法都出现过，所以要用 `*=` 而不是 `=`）。
- `openSidebar()`：按 `aria-label`/`title` 精确匹配 `/打开侧边栏|打开侧栏|展开侧边|打开菜单|显示侧边|open sidebar/i`，
  并**排除** `/收起|关闭|折叠|collapse|close/i`（曾因为兜底正则误点「收起侧边栏」把侧栏关掉）。
  每 4 次 tick 试一次（`sideTries < 60`）。
- `expandWorkspaces()`：把 `aria-expanded !== 'true'` 的 `[data-row-key^="workspace:"]` 点开，每 3 次 tick 一次。
- 点击用 `hardClick(el)`：`scrollIntoView` → 中心坐标 → 依次派发
  `pointerdown / mousedown / pointerup / mouseup / click`，选项
  `{bubbles:true,cancelable:true,composed:true,view:window,button:0,detail:1,buttons:1,isPrimary:true,pointerType:"mouse"}`。
  单纯 `el.click()` 在这个 app 里点不动会话行。

**进入成功的判据**（`inThread()`）：页面标题包含该会话名（最硬的判据，实测最可靠），
或者中间列 `[class*=msg],[class*=message],[class*=turn]` 数量 > 1 且不含欢迎语
（`/up next|选择工作区|查看工作区|开始新的对话/`）。

## 3. 已知能跑通的证据（当年）

- 单窗：`frame-msg` 心跳连续到 `n:100`，`cc:true, th:true, keys:23, dt:"… — DeepSeek Harness"`，
  窗内是本会话真实正文。
- 四窗并跑（端口 54659..54667）：每个窗都是真对话、各有输入框与用量条；Edge 约 2.4 GB。
- 加速要点：**冷启动只预热 2 个**，其余点「全部挂起」；`liveCap()` 只增不减（端口表异步到达时别让容量掉）。

## 4. 数据/标题这类「读宿主」的事

- 会话标题：读 `~/.dsh/storages/session_projcache/sessions/[session-]<uuid>.json` 的
  `record.rows.title.val`（毫秒级）；拿不到再深扫 `session.v4.jsonl.zstd` 的**尾部 1200 帧**
  取最后一个 `session/title`（全解 14000 帧要十几秒，会卡住宿主事件循环）。
- 上下文/用量/对话目录：同一份投影缓存里
  `contextPressure.val`、`contextBreakdown.val.breakdown`、`tokenUsage.val.totals`、
  `sessionStats`、`turnOutline.turns`、`contextActivity.days`。
- 卡片「跟哪场对话」= `boundFor(leaf)`：`leaf.bindId` → 手动断开则空 →
  几何（同一行左侧优先）→ 左上邻居递归 → `localStorage['dsh-free-pane.lastSession']`。

## 5. 现在要做的修复（新会话从这里开工）

1. 会话卡 iframe 回到 `fpEmbed=pure&autoSession=…`；完整界面作为进对话后的可选项，不要作为入口。
2. 导航兜底顺序改成：先尝试副本自身的会话选择（不依赖 DOM 行），再 `sessionRow` → `openSidebar` → `expandWorkspaces`。
3. 消掉那次多余的 `inject-boot`（13 秒后同 sid 二次启动）——`src` 里的 `fpN` 是常量，怀疑 `boot` 计数抖动导致 key 变化重挂。
4. 验收标准（trace）：`apply` 之后 `ms > 0`、`thread: true`、`inject-boot` 只出现一次。

## 6. 运维口令

- 改完 `node --check index.js client.js`；注入脚本要另抽出来验：抓 `?fpEmbed=off` 的最后一个
  `<script>` 写盘 `node --check`（宿主侧 check 查不出字符串里拼出来的语法错误）。
- 重载：`plugin_manager action=set_plugin target='include:free-pane' enabled=false` → `true`。
- 端口：`%TEMP%\dsh-free-pane-proxy.json`（每轮变）；日志：`%TEMP%\dsh-free-pane-trace.log`。
- 测试后 `Get-Process msedge | Stop-Process -Force`（副本每个 500 MB 级，堆多了会崩）。
