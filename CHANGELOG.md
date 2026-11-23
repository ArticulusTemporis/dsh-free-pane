## 0.10.20-alpha.1 (2026-11-22)

### Changed（界面）
- **空窗格整页重做，按 Material 3 空白页排版。** 去掉原来的玻璃卡片、四枚水印图标和一枚装饰大圆环，改成不透明 `surface` 底 + `surface-container-low → surface` 渐变 + 24px 点阵（带遮罩渐隐）+ 顶部柔和光晕；中间是 96px 正圆 tonal 主视觉（`primary-container`）+ 17px 标题 + 说明文案，下面是 pill 搜索框与竖排瓷砖。
- **入口从横排列表改成 M3 瓷砖网格**：52px 圆角图标容器 + 30px 图标 + 居中标签，容器查询在窄卡片里退到 44px/26px，`justify-content: safe center` 保证内容超高时从顶部排。
- **图标统一 Material Symbols Rounded 并整体放大一档**：全局 18→20、图标按钮 15→18、顶栏按钮 13.5→16、菜单项 15→18、搜索框 15→18、窗口按钮 12→15、FAB 18→22、空窗格主视觉 36→46。
- **默认配色改成 DeepSeek 蓝 `#4D6BFE`**（新增种子 `deepseek`，排在第一位）；`跟随宿主` 仍然保留，宿主兜底色也从 `#3964FE` 统一到品牌蓝。
- 宿主给全站设了 `corner-shape: superellipse(1.5)`，`border-radius: 50%` 会被画成方圆形，主视觉圆因此显式写了 `corner-shape: round`。

### Changed（菜单去重）
- **外观面板与设置面板不再重复列同一份配色**：设置里只留一行「配色 DeepSeek 蓝 · 跟随系统」+「打开外观」，12 个种子色只在外观里出现。
- **「更多」里删掉与设置重复的「雾化玻璃」和「开发者选项（尺寸）」**，顺带清掉失去上下文的动效说明；现在只剩全部挂起 / 复制右栏诊断 / 清空画布。
- **会话下拉里同名会话可以分辨了**：重名项自动补短 id（`你是研究员。用 web_search / web_f · 008804`），名字本身已含该 id 时不再重复拼。
- 「设置」卡片的说明从过时的「明暗 / 配色 / 尺寸」改成「排列 / 尺寸 / 动效」；画布右键的「新建空卡片（再挑类型）」改成「新建填空窗格 · 再挑类型」，与添加面板统一。
- 删掉会话卡标题下拉里早就不再使用的一段 `<optgroup>` 死代码。

### Changed（缩放与卡片）
- **75% 是设计基线**：`.fp-ui` 用 `zoom / 0.75`，75% = scale 1，100% = 4/3（顶栏 36→48、正文 10.5→14、侧栏 240→320），125% = 5/3。整套 UI 由外层 transform 统一放大，字号与 px 一起变。
- **缩放现在作用于整个自由窗格界面**（含顶栏、侧边面板、画布），外框按 `100/zoom%` 撑开，依旧铺满宿主区域；卡片内部的 frame zoom 仍是额外的一层内容缩放。
- **「填空窗格」回到添加菜单最后一项**，新画布默认就是这一张空窗格；演示布局改成 `?fpDemo=1` 才铺，且绝不覆盖已保存的排布，重启后保留上次的窗格。

### Changed（入口一致性）
- **「+ 菜单」和空窗口选择器共用同一份基础种类**（同一标签、同一分组）：会话、浏览器、笔记、文件、终端、Git、设置。`usage` 依赖 `dsh-bottom-info-bar` 的账本，不再出现在两个入口里；`grab:*` / `panel:*` 也从空窗口选择器移除。
- 添加菜单不再包含「开发者选项（尺寸）」和「恢复默认尺寸」，这两项只留在顶栏「设置」里。
- 排列预设不再显示名字，只保留线框图和 `n 格` 提示；设置页新增「窗口排列 → 选择布局」入口。

### Packaging
- 版本号统一为 `0.10.20-alpha.1`（alpha 通道，`publishConfig.tag = "alpha"`），此前 alpha.2/3/4 的改动全部并入这一版；发布用 `npm publish --tag alpha`，不会覆盖 `latest`。
- `engines.dsh` 不变（`>=0.2.2-rc.5 <0.3.0`）。

## 0.10.19 (2026-11-22)

### Changed
- **Zoom is now three explicit choices: 75% / 100% / 125%.** The top bar has a global selector that persists in `localStorage['dsh-free-pane.zoom']`, applies to every session/panel/browser/web card and becomes the default for new frame cards. Each frame card header has the same three options as a per-card override. The old +/- buttons are gone.
- **The add menu is down to 8 stable kinds:** 会话、文件、浏览器、笔记、终端、Git、用量、设置. `empty/std/ctx/context/ocr/capture/dash/api/web/panel` are no longer offered; existing cards still render (compatibility retained), and capture remains available via Alt+D.
- Compatibility harness now checks the eight menu labels and the 75/100/125 selector, and applies 100% during the run.

## 0.10.18 (2026-11-22)

### Packaging / compatibility
- **No longer an unqualified preview tarball.** `package.json` now declares `engines.dsh: >=0.2.2-rc.5 <0.3.0` (tested 0.2.2-rc.5), so DSH blocks installation/activation outside the supported range instead of failing silently.
- Added `COMPATIBILITY.md`: tested versions, host APIs used, what is intentionally not guaranteed, and the upgrade/regression checklist.
- Added `scripts/preflight.mjs` and `npm run preflight` before packing: syntax-check both entries, verify required files, `dsh.bundle.patch`, `engines.dsh`, and fail on machine-specific paths, fixed ports, test session ids or `fptest` strings.
- Package files now exclude screenshots and include `COMPATIBILITY.md` + preflight script; `private` is false.
- Verified the new tarball installs into a clean profile with `dsh plugin add`.

## 0.10.17 (2026-11-22)

### Changed
- **The add menu now lists card kinds, not every variant.** 31 entries → 14: `empty, session, files, browser, note, terminal, git, std:metrics, usage, context, ctx:dash, ocr, settings, capture`.
- `web` is merged into `browser`; the `dash:*` presets and `api` debugger are no longer offered (old cards still render); the ten `ctx:*` entries collapse into one `ctx:dash` card whose own tabs switch Token/会话/技能/步骤/事件/文件/命令; the four `std:*` entries collapse into one 数据卡 with an in-card 指标/表格/列表/进度 switcher.
- Icons-only card header, brief, and view switcher share the same 9 px chip styling.
- Panel cards now wait 60 s before showing the "still loading" fallback; the old 6 s copy replaced a live host panel with a false failure while its client was still mounting.
- Full kept/retired table in `docs/card-kinds.md`.

## 0.10.16 (2026-11-22)

### Changed
- **The file card now embeds the whole host files panel, bound to the right session.** 「在宿主文件面板打开」 no longer tries to remote-control the parent right sidebar (which is hidden by the canvas) and no longer auto-targets one file through `openResourceIn` (which often left an empty tab). It picks the session whose `cwd` contains the path and opens a `panel` card with `bindId`; the panel copy runs the real host files panel at that session's workspace root. The tree, search, previews, and Office handling are the host's own.
- Panel cards get 25 s before the "面板还没出来" fallback (the embedded client needs ~8–10 s on first load); previously 6 s fired while the tree was still mounting.
- Office files remain host-only in the file card (no in-card conversion); the brief's primary action opens this panel.

## 0.10.15 (2026-11-21)

### Changed
- **Office files no longer convert inside the card; the file card is host-only again.** The auto `officePreview` call was removed from `loadFile`, so opening a doc/xls/ppt shows the lightweight brief with one primary action: 「在宿主文件面板打开」. The host `officePreview` RPC remains available for future use but is not invoked by the card.
- **「宿主面板」now targets the real right sidebar, not a second embedded client.** For file paths it chooses the session whose `cwd` contains the file, computes the session-relative resource address (`dsh-resource://file/session/<sid>/<rel>`), temporarily lifts the free-pane rightbar hide (`HOST_RIGHT_HOLD`, restored after 45 s or when the sidebar collapses), and calls `sidebarRight.openResourceIn()` twice (250 ms / 900 ms) to survive sidebar adoption. If `sidebarRight` is unavailable it falls back to the old panel card, now carrying `bindId`/`panelRel`/`fpPath` so `drivePanelEmbed` can call `openResourceIn` itself.

## 0.10.14 (2026-11-21)

### Changed
- **Office files show a first-page preview immediately, still in the lightweight brief.** The 0.10.13 conversion now also renders page 1 to a small PNG (LibreOffice/PDFium `renderImages`, 110 dpi). The file card shows that thumbnail as soon as the file is opened — click it or 「打开完整 PDF」 for the full PDF viewer. This merges the parallel lightweight file-card redesign with the request to open Office files directly: no second click just to see content, and no large gray PDF toolbar by default. Tab switches reset the full-PDF state; failed conversions keep 「重试预览」/「宿主面板」.
- Thumbnail max height 360 px (55% of the card) so a portrait page is readable; stored in the same cache entry as the PDF.
- Verified: `名单.docx` → 107 KB first-page PNG + 42 KB PDF; clicking the thumbnail renders the full PDF iframe.

## 0.10.13 (2026-11-21)

### Added
- **Office files open in the file card, not just in the host panel.** A new host RPC `officePreview` loads the DSH-bundled `@deepseek-ai/libreoffice-kit` (native engine, no external install) and converts DOC/DOCX/XLS/XLSX/PPT/PPTX/ODT/ODS/ODP to PDF on demand. The card shows the resulting PDF in the normal PDF viewer, with the same page toolbar. Conversions are cached by path + mtime + size (12 entries), files over 60 MB / PDFs over 24 MB are refused, and a failed conversion falls back to the old binary card with a 重试 Office 预览 button.
- Verified: `名单.docx` → 1-page PDF (42 KB) rendered inside the file card; `名单.xlsx` → 1-page PDF (31 KB). The temp PDF directory is removed after reading; the source file is never modified.

## 0.10.12 (2026-11-21)

### Fixed
- **The tall white area under a conversation card was the card body scrolled upward.** The session iframe is intentionally 100/zoom (133%) tall and scaled back; when the browser focused the iframe, it could programmatically scroll `.fp-win-body` by ~356 px even though the container used `overflow:hidden`. UIA showed the embedded document at `y=-356, 1044×1062`: its visible bottom ended around 706 px and everything below was the card's empty background. `.fp-win-body` now uses `overflow:clip` (which forbids programmatic scrolling) and `resetFrameScroll()` zeroes the card/body scroll on every zoom and sweep. A card that already scrolled itself is repaired on the next sweep or reload.

## 0.10.11 (2026-11-21)

### Fixed
- **The right-bar hide marker survives host re-renders.** The host can rewrite `body.className` while resizing; `fp-hide-host-right` is now re-added on every 700 ms pass and on the drag-time `pointermove` kick, so the `!important` rightbar rule cannot silently stop applying.

## 0.10.10 (2026-11-21)

### Fixed
- **The white column in a conversation card was a leftover `margin-right`.** In `fpEmbed=pure`, the chat body carries `margin-right: 320px` for the host's push-mode right sidebar. Hiding the panel itself did not remove that margin, so the conversation stayed ~1288 px wide in a 1610 px card and the remaining strip looked like an empty pane. The pure CSS now sets `margin-right:0 / width:100% / max-width:none` on the body inside `centerCol`; measured `scrollBody` width goes from **1288 → 1608** in a 1610 px viewport, and the white column disappears.

## 0.10.9 (2026-11-21)

### Added
- **Git cards find repositories instead of stopping at `fatal: not a git repository`.** A new host `findRepo` scans the current directory and up to two levels down (600 directories, skipping `node_modules`, `.tmp*`, `dist`, `build`, …). One repo switches automatically; several are listed in a 选择仓库 dropdown. Verified from `D:\fix`: it lists `aac-public` and `packages\dsh-free-pane`, and selecting the latter shows `## main` plus the modified files. 找仓库 / 刷新 / 暂存全部 / 提交 / 初始化仓库 stay in the toolbar.

## 0.10.8 (2026-11-21)

### Fixed
- **No hard-coded `D:\\fix`.** A new host `envInfo` supplies `process.cwd()` / home; file cards with no path resolve through `listDir` and write the resolved directory back into the address bar; Git cards default to the same directory. On another machine the cards now open in that machine's working directory instead of a path that only exists here.
- **The Git card is no longer just a fatal line.** It has a path field, refresh, a commit-message field, 暂存全部 / 提交 / 初始化仓库, and uses a new host `gitRun` (`add` / `commit -m` / `init`). Verified by initialising a temporary repo from the card.
- **Usage no longer shows a tiny fragment as if it were the dashboard.** `LiveGrab` gained `minText`; the usage card falls back to the local ledger when the captured host fragment is shorter than 20 characters (it used to show just `· · · · 56%`).
- **Only cards that read a conversation show the conversation dropdown.** 看板 / 会话表 / 每日用量 / 技能榜 no longer carry a useless 选会话 select; 步骤 / 事件 / 文件活动 / 命令执行 still do. OCR no longer pretends to bind a conversation and says 本机 OCR · 不出网.
- **会话表 falls back to the host's session catalogue** when dsh-context is absent, with the source line 「宿主会话目录 · dsh-context 不在时的内嵌列表」; other ctx tables now say 「这个宿主没有安装 dsh-context（HTTP 404）」 instead of raw `not found`.
- **Context cards offer a one-click 用最近一场会话** when they have no binding; settings now appears in the add sheet and is titled 设置卡片; 抓取 shows a toast explaining how to pick a region.

## 0.10.7 (2026-11-21)

### Fixed
- **The white column inside a conversation card is gone.** The pure session embed (`fpEmbed=pure`) hid `rightbarCol`, but the host's push-mode sidebar panel (`.acoR2W_panel`, `data-sidebar-right-panel="push"`, `data-dockkit-empty="true"`, width 860) escaped the zero-width parent and painted an empty "空面板" over the right side of the card. The injected pure CSS now also hides `[data-sidebar-right-panel]`, `[data-sidebar-right-session]` and `[data-dockkit-empty="true"]`.
- **The pure CSS is injected on the first frame, not after the conversation is ready.** `ensureStyle()` used to run only from `tickBody()` after the session had loaded, so the empty panel was visible during startup and could stay if navigation never completed. It now runs immediately when the embed script starts.

## 0.10.6 (2026-11-21)

### Changed
- **The context card fills a tall slot instead of leaving a large blank lower half.** It now shows six rows (对话 / 系统 / 工具 / 缓存读取 / 输出 / 窗口), a percentage that scales with the window height (30–52.5 px), vertically centred content, and a footer with the window size and model. A 1634×540 slot no longer looks like an empty white pane; when there is no bound session the normal centred prompt still shows.

## 0.10.5 (2026-11-21)

### Changed
- **The split line is visible without hovering.** The gap between two cards used to be pure white with a transparent divider line, which could read as a thin empty pane. The 1.5 px line now sits at 45% opacity and goes primary on hover/drag.
- **Right-bar diagnostics include the shell chain and body children.** The copied JSON now also carries the canvas's six ancestor elements and body's direct children with their rectangles/classes/displays, so a leftover strip can be identified even when its class does not contain `rightbar`. Left-sidebar candidates are filtered out.

## 0.10.4 (2026-11-21)

### Added
- **More → 复制右栏诊断.** The user no longer has to find `%TEMP%\dsh-free-pane-trace.log` or open DevTools: one click packages the canvas size, every card (id/kind/title/rect), all right-bar / dock / rail / sidebar candidates with their computed display, the elements sitting at the canvas right edge, and the latest `right-hide` / `strip-audit` / `collapse-right` trace lines into the clipboard. If clipboard access is refused, an in-page read-only dialog opens with the text pre-selected; no native `prompt()` that can block Electron.

### Fixed
- **Right-bar columns collapse their track as well.** `display:none` alone could leave the host's grid/dock track as a thin blank strip; the `fp-hide-host-right` rule now also forces `width/min-width/max-width:0`, zero margin/padding/border and `flex:0 0 0` on `rightbarCol` / `rightbar-col`.

## 0.10.3 (2026-11-21)

### Fixed
- **The host right sidebar no longer comes back while a card or divider is being resized.** Hiding it used to be a one-shot inline `display:none` plus a 700 ms poll; when the host re-rendered the column, or the conversation pane was dragged past 50% so the old geometry test no longer matched, the sidebar reappeared. The canvas now adds `body.fp-hide-host-right` and an `!important` rule for every `rightbarCol` / `rightbar-col`, re-hides *all* current right-bar columns on every pass (not just the first one it found), marks them with a durable `data-fp-hidden="1"` attribute, re-checks on `ResizeObserver` (canvas + body), on every committed layout, and on `pointermove` while `body.fp-resizing` is set. Session copies keep the injected `fpEmbed=pure` right-bar CSS. New right-bar nodes created mid-drag are hidden by the stylesheet immediately, without waiting for the next poll.

## 0.10.2 (2026-11-21)

### Fixed
- **Every card keeps its drag handle.** The `@container (max-width:420px)` rule used to hide `.fp-win-grip` outright, so cards narrower than 420 px (two-column boards, 500 px windows, side sheets) looked like they had lost the drag button. The grip now shrinks to 12 px with a hover surface instead of disappearing; the header remains draggable at any width, and wider cards keep the 15 px handle.

## 0.10.1 (2026-11-21)

### Fixed
- **The 0.10.0 pressure-test list is closed item by item.** `?fpReset=1` now persists its request through the host's URL rewrite and clears the stored tree; one click on 深色 switches the whole canvas; the standard-window **预览** button applies the edited JSON; layout presets trim extra cards instead of squeezing them into 30 px strips; the add sheet exposes all four standard views; dragging a card copies the whole leaf and normalises kind-specific fields; the file panel is titled 文件面板 and falls back to a real file card with 改开文件卡 / 系统打开 after six seconds.
- **Daily usage no longer dies with dsh-context.** The 每日 tab still prefers `api/dsh-context/overview` (`part: days`), then the full overview, then embeds the same daily table from the local `dsh-bottom-info-bar` sqlite ledger; the source line says which one was used, and `ctx` cards now carry the same explicit session dropdown as usage/context cards. Non-JSON 404 bodies are turned into readable errors instead of uncaught `Unexpected token 'o'` promises.
- **Dashboard presets bridge first, replicate when the bridge cannot work.** A new host RPC `probeRoutes` checks `/anatomy`, `/anatomy/data.json` and `/taskmonitor/data`; the buttons say 未安装 when the plugin is absent, POST routes send the bound `sessionId`, and when a route is missing the card renders an **内建复刻** view built from the local ledger and session projections (anatomy vitals with daily bars, task monitor with recent sessions and the bound session's turns/context), with 重试插件 to switch back to the bridge once the plugin is installed.
- **Narrow and list layouts.** File tabs scroll horizontally without being clipped, `.fp-tblnote` wraps instead of losing its first line in a 95 px column, file rows pin a CJK font stack and minimum height, and the add sheet now mirrors the empty-card picker (dashboard presets plus every dsh-context table).
- **Copy left from the removed chain UI.** Context cards say 选会话 / 卡片标题栏的会话下拉 instead of pointing at a chain button that no longer exists.

### Verified on a real host
- `?fpReset=1` → 1 empty card, URL parameter stripped, stored tree is one empty leaf.
- 深色 once → `--md-sys-color-surface: #121317`; 浅色 → `#f8f9fc`.
- Standard table JSON title edit → 预览 → card title/table update immediately.
- 四象限 on 11 cards → 4 cards, all 427 px wide, app bar says 4 张卡片.
- `/anatomy` 404 → 内建复刻 shows 40 sessions, 151.8M tokens, ¥4.38 ledger, seven daily rows.
- 每日用量 without dsh-context → ledger table with seven days, no error, source note names the ledger.
- File panel → 文件面板 title, six-second fallback copy, 改开文件卡 opens `名单.docx` in a real file card.
- D:\fix file list → 144 rows, 22 Chinese names, no empty rows.
- Reload with `?fpTrace=1` → no console exceptions; remaining 404s are the absent dashboard plugins, handled by the card.

## 0.10.0 (2026-11-19)

### Added
- **Standard windows.** A `std` card takes one JSON contract — `{ title, subtitle, … }` — and renders it as metrics, a table, a list or progress bars (`metrics`, `table`, `list`, `progress`). Four picker entries and an add-sheet row seed sample data; the card's 示例 button restores it and JSON opens an editable textarea, so a plugin or script can feed any standard window without new UI code.
- **Material naming.** Structural elements now carry `data-m3` (`surface`, `top-app-bar`, `card`, `card-header`, `fab`, `side-sheet`, `menu`, `tabs`, `search-picker`) while the existing `.fp-*` classes stay for compatibility. `docs/material-naming.md` maps old names to the M3 vocabulary.

### Removed
- The duplicate chain toggle (header button and context-menu 断开数据源), the `chainOf` / `toggleChain` / `ownerOf` aliases, and the second `if (kind === 'files')` branch in `contentFor`. Session-scoped cards keep only the header dropdown.

## 0.9.2 (2026-11-19)

### Added
- **An opt-in skill that adapts a user's own plugin.** `skills/free-pane-plugin-adapter/SKILL.md` inspects an installed plugin read-only, classifies what it publishes (host HTML page, host JSON, right-sidebar panel, client-only widget, conversation artifact), and then offers four choices: report only (default), free-pane preset/route only, edit the plugin to add a route or panel, or write a custom card. Nothing is written before the user explicitly chooses; verification covers route status, card rendering, session dropdown binding, light/dark colours and small-window layout.

## 0.9.1 (2026-11-19)

### Fixed
- **Session-scoped cards no longer guess a conversation by position.** The geometry-based bind (nearest session above/left, then last session, then the first one) is gone: usage, context, region and OCR cards read only the conversation chosen in their own header dropdown, and a fresh session card starts empty and asks the user to pick one. The chain toggle is removed; the dropdown is the only way to connect a card.
- **The dropdown fits the card header** at the 75% metrics (height follows `--fp-head-h` minus 4px, capped at 24px) instead of overflowing a 22px title bar.

## 0.9.0 (2026-11-18)

### Added
- **Dashboard cards.** A new window kind `dash` fetches a plugin route on the host and renders it: an HTML route (agent-body's `/anatomy`) is embedded as-is with a reload timer, a JSON route (task monitor, telemetry) becomes metric tiles, list counts and a key/value table, and plain text is shown verbatim. The route is editable, auto-refresh is 5 seconds by default and can be switched to manual, and the raw JSON stays one click away. Built-in examples cover `/anatomy`, `/anatomy/data.json` and `/taskmonitor/data`.
- **`docs/dashboards.md`** records the three ways DSH dashboard plugins publish content (host HTML page, host JSON + client overlay, conversation artifact card), which GitHub projects represent each, and which free-pane card can bridge each one.

## 0.8.1 (2026-11-18)

### Fixed
- **Unsupported files point at the host.** Office documents, archives and executables now say that the DSH right Sidebar's file page previews them, and offer a button that opens the official file panel as a card; download and system-open stay beside it.
- **A session card on the host welcome page explains itself.** That sidebar lists workspaces only, so the injected navigator can never find a session row. After eight seconds the card now says why it is still there and tells the reader to pick a session on the left (or press Ctrl+K), instead of leaving a silent welcome page.

## 0.8.0 (2026-11-18)

### Added
- **File cards browse like a browser.** Every opened file becomes a tab: click a file to open it, keep several files in one card, switch between them, close one with ×, and 目录 brings the listing back. Tabs live on the card (`fileTabs` / `fileActive`), so they come back after a reload, and 新卡片 copies the current file into its own window. Dragging a file from the OS (or a file row) onto the canvas opens it in its own file card.
- **More formats render in place.** Text and code behave as before, Markdown gets a rendered preview with a 源码 toggle, images keep their viewer, and PDFs, audio and video now render inside the card. Anything that cannot be rendered (Office documents, archives, executables…) shows its name, MIME type and size with 下载副本 and 系统打开 instead of a bare "cannot read".
- **Any path can be opened from the address bar.** The path field accepts a folder or a full file path: Enter on a folder lists it, Enter on a file opens that file in a tab and moves the listing to its directory. ↑ and the folder rows still navigate, and 系统选择… picks a file through the Windows dialog and opens it directly.

### Changed
- **The canvas is scaled to 75% of its original size.** 947 px values in the stylesheet are multiplied back to 75%, and the fourteen metrics follow: app bar 36, card head 22, title 9, radius 9, gap 6, padding 6, head buttons 18, app-bar icons 24, toolbar 28, fields 24, FAB 33, sheet 240 at 15. The 紧凑 / 标准 / 宽松 presets are rescaled too, stored sets move to `metrics.v3`, and an old set is converted once instead of being applied at the wrong scale. Embedded host panels and web iframes are laid out at `width:100/0.75` and zoomed to 0.75, so they still fill the card exactly when it resizes.

## 0.7.2 (2026-11-17)

### Changed
- **Everything is one notch smaller.** All 123 `font-size` declarations in the canvas stylesheet are scaled to 92%, and the shipped metric defaults step down with them: app bar 64→56, card head 44→36, card title 14→13, radius 16→12, gap 12→8, canvas padding 12→8, head buttons 32→28, app-bar icons 40→36, in-card toolbar 48→40, fields 40→36, FAB 56→48, side sheet 368→340 wide with a 24 px radius. The 紧凑 preset is smaller again, so a dense board and a comfortable one are two clicks apart.
- **Every dimension can now be dialed from zero.** All fourteen metrics in 更多 → 开发者选项（尺寸） start at 0 — title-bar height, buttons, fields, toolbar, FAB, sheet width and radius included — so a card can be taken down to a bare frame instead of stopping at a "safe" minimum. The stored set moved to `localStorage['dsh-free-pane.metrics.v2']`, so the new defaults are what you see on the next load instead of being masked by earlier values; 标准 and 恢复默认 behave as before.
- **Content zoom reaches 50%.** The −/+ steps are now 0.5 · 0.6 · 0.7 · 0.8 · 0.9 · 1 · 1.1 · 1.25 · 1.4 · 1.6, so one window holds a lot more conversation before it needs splitting, and two − presses followed by two + presses still land exactly back on 100%.

### Fixed
- **`?fpMetrics=reset` is consumed once.** While the parameter stayed in the address bar, every render deleted the stored metric set again, so a size changed right after a reset was never saved and the next reload reset it once more. It now clears the key once, strips the parameter with `history.replaceState`, and leaves `readMetrics()` a pure read.

## 0.7.1 (2026-11-17)

### Added
- **Developer options: dial every dimension yourself.** 更多 (⋯) → 开发者选项（尺寸） opens a sheet with thirteen knobs — app bar height, card title-bar height, title size, card radius, card gap, canvas padding, card-head buttons, app-bar icon buttons, in-card toolbar height, field height, FAB height, side-sheet width and radius. Each row is a slider plus a number box (Enter or blur commits, values snap to their step and stay inside their range), the title bar can never become shorter than the buttons inside it, and 紧凑 / 标准 / 宽松 switch the whole set at once. 复制 CSS prints the current values as `.fp-canvas{--fp-head-h:44px;…}` so a good result can become the shipped default. Values persist in `localStorage['dsh-free-pane.metrics.v1']`; 恢复默认 restores the built-in set.

### Changed
- **The default card title bar is 44 px instead of 52 px**, and card heads, app bar, sheets, toolbars, fields and the FAB all read their size from `--fp-*` metrics variables instead of hard-coded numbers, so the developer options sheet (or a hand edit) can retune the interface without touching component rules.

### Fixed
- **复制 CSS now works without clipboard permission.** It tries `document.execCommand('copy')` first, and if the browser refuses it the CSS opens in a dialog with the text already selected (so `Ctrl+C` still works) while a background `navigator.clipboard.writeText` is retried; when that succeeds the dialog closes itself and a snackbar confirms the copy.

## 0.7.0 (2026-11-17)

### Changed
- **The interface was rebuilt on Material 3.** A token layer generated at runtime carries the colour roles (primary / on-primary / containers / surface and its five container steps / outline / outline-variant / error / success / warning / inverse roles), the type scale (Roboto 22/16/14/13/12/11 with the M3 line-heights), the shape scale (4 / 8 / 12 / 16 / 28), five elevation levels, state-layer opacities and the standard/emphasized easing curves. Every component consumes those tokens, so the canvas, app bar, cards, menus, sheets, dialogs, snackbars, tabs, tables, fields and chips finally share one visual language instead of each having its own radius and type size.
- **The chip strip became a Material 3 top app bar.** 自由窗格, a "N 张卡片 · 填充分格" subtitle and three 40 dp icon buttons (layout / appearance / more). 动效, 全部挂起, 清空画布 and 收起画布 moved into the overflow sheet; 排列 and 配色 moved into their own sheets with proper section headers.
- **The 16 px rail became an extended FAB.** 添加 opens a side sheet listing thirteen card kinds with icon, label and hint, and inserts the card directly; capture-any-block still enters pick mode from the same sheet.
- **Material You dynamic colour replaces the six skins.** A seed colour is expanded through OKLCH tonal ramps — with the M3 tone-to-lightness conversion, so dark surfaces land where they should instead of collapsing to black — and every colour role is derived from it. Seeds are 跟随宿主 (the host accent) plus purple / blue / teal / green / amber / red / pink / graphite; light, dark and auto are a separate setting (`dsh-free-pane.scheme`). Only this canvas is repainted; host colours are read, never written.
- **Material Symbols for all icons, Roboto for all text.** 126 official Material Symbols outlines are embedded as SVG paths and rendered through one `Icon` component (the previous emoji and text glyphs — 🔗, ⛓, ▾, −, +, ×, ✕ — are gone), and the Roboto variable font ships as a base64 `@font-face`. Both work offline; nothing is fetched at runtime.
- **The empty-card picker was rewritten** around an M3 search field: a 48 px pill with a leading search icon, live filtering that folds away empty groups, and grouped rows of 56 dp tonal icon buttons in place of the old cramped grid.
- **Cells were restyled, not rewritten.** Files, terminal, web, plugin-endpoint, OCR, browser, Git, note, usage and context cards keep their logic and markup but now use 48 px bars, 40 px outlined fields, text buttons with 8% state layers, M3 primary tab strips with a 3 px indicator, hairline data tables with sticky headers and 40–44 px list rows.
- **Dialogs, menus and toasts follow the M3 spec**: 48 dp menu rows in a surface-container-high menu, 28 px-radius dialogs over a 32% scrim with a filled confirm button, and an inverse-surface snackbar with an inverse-primary action.

### Fixed
- **A generic button reset was beating every component rule.** `.fp-canvas button` (specificity 0,1,1) overrode the positioning and background of the FAB, icon buttons and chips, so the FAB stretched across the canvas and came out transparent. The reset is now wrapped in `:where(button)`, which contributes no specificity.
- **Icons rendered as empty boxes.** The embedded icon table was generated from the wrong key of the downloaded manifest, so most symbols had an empty path list. Rebuilt from the manifest accepting either key; all 126 entries verified non-empty.
- **Dark mode surfaces were crushed to near-black.** Tones were treated as OKLab lightness instead of CIE L*; the conversion now maps M3 tones 0–100 through `Y = ((L+16)/116)³` before going to OKLCH, which restores the intended separations (surface 6, container 12, container-high 17).
- **The context card's stacked bar ignored the theme.** Its segments still pointed at the removed `--fp-accent` / host label tokens, so it painted one near-black bar; the three segments are now primary / secondary / tertiary and the bar reads as an M3 data bar. The bar also fills only the used share of the window — it used to be normalised to 100%, so 11.6% looked like a full window.
- **Card heads no longer crowd themselves out.** Zoom and link buttons are tagged and dropped by container queries below 430 px and 340 px, and titles ellipsize instead of showing 笔…/文…/终….
- **The markdown note field lost its own styling** to the global textarea reset, and inputs had no clear focus state; both are fixed (40 px fields, primary 2 px focus border, hover border on-surface).

### Removed
- The six hand-written skins (follow-host, Apple light/dark, glassmorphism, graphite, paper) and their `has-pal` / `has-bau` CSS blocks. Stored legacy palette ids are mapped onto the nearest seed, so existing users keep a sane theme.

## 0.6.0 (2026-11-17)

### Added
- **The dsh-context board, one table per window.** The context plugin (0.84.1) keeps its numbers behind `api/dsh-context/*` and only answers a browser that carries the host cookie, so the board was unreachable from a card. Windows of kind `ctx` now call it directly and render eight tables: 总览 (sessions, turns, tokens, cost, cache hit, the token composition and per-stage timing), 会话 (all 53 sessions, one row each, click to bind), 每日 (per-day tokens/cost), 技能 (which skills ran, how often), 明细 (every request: turn·step, prompt, cache read, output, ms), 事件 (context events), 文件 (file operations) and 命令 (shell commands plus the run/fail/time totals). Each window has its own tab strip so you can switch tables in place; the footer names the endpoint and the refresh interval.
- **A window can hand a session to another window.** Clicking a row in 会话 binds that session to the card and jumps to 明细 — one click from "which conversation is expensive" to "which step cost it".
- **Windows name themselves after what they hold.** A table window is called 看板卡片 · 会话表, a file window shows the file name once you open one, a terminal window is named after its directory, a browser window after the site, a note after its first line, an endpoint window after the path. Right-click → 重命名… still wins over all of it.
- **Cards survive being squeezed.** Below 300 px the tables stop pretending to be tables: each row becomes a list of 列名 / 值 pairs (the header is dropped, the values stay). Below 220 px the title bar drops its text buttons. And when you add cards faster than the canvas can hold them — seven at once, say — the canvas lays them out as an even grid instead of shrinking everything into 66 px slivers (`tidyIfTight`), with a `tidy-grid` trace line recording what it did.
- **`docs/cards-interface.md`** — how to add a card kind, where the responsive breakpoints live, the full dsh-context endpoint table, the host RPC contract, and the acceptance recipe (`fpAdd` / `fpTrace` / CDP).

### Fixed
- **The fallback bar could stick on a card that was already showing its conversation.** A window's copy may live on a *different* proxy port (one origin per window, so the host's six-connection limit cannot starve the second copy), and then the parent cannot read `iframe.contentDocument` to check progress. The copy now posts `{__fp:'ready', sid}` to its parent when it enters the conversation, and the window drops the "还没打开这场对话" bar on that message.
- **`readFitMode` had gone missing.** An earlier edit replaced it while adding the host-theme reader, so every canvas render threw `ReferenceError: readFitMode is not defined` and the plugin replaced itself with the "自由窗格渲染出错了" screen. Restored, and a function-by-function diff against the previous commit is now part of the check.

### Changed
- **The type picker is grouped and the tables are readable in any width.** The nineteen entries sit under five headings (对话 / dsh-context / 工具 / 抓取 / 面板) instead of one long list, and the active tab in a table window is underlined rather than blocked out.

## 0.5.2 (2026-11-17)

### Fixed
- **The empty strip beside the conversation.** The host's `.mP3x-q_frame` carries an inline `grid-template-columns` computed by JS (`280px minmax(0,1fr) minmax(0,0px)`). Hiding the two side columns with `display:none` leaves their tracks behind, so a window (and, in a full-window conversation, the whole page) had a ~111 px dead strip on the left of the conversation. Inline styles beat a template override, so the middle column is told to span every track instead: `html[data-fp-ok] [class*="centerCol"]{grid-column:1/-1!important;justify-self:stretch!important}`. Measured after the change: `centerCol` starts at 0 and fills the window in both a 1610 px card and a 1376 px standalone page.
- **That span rule used to make the sidebar unclickable.** It applied the moment pure mode started, while the sidebar was still there and simply covered by the middle column: a standalone window ignored forty-odd clicks on workspace rows and stayed on the welcome screen. It is now gated on `html[data-fp-ok]`, so it only spans once the conversation is really open and both side columns are gone.
- **The pure-mode stylesheet had two syntax errors.** A stray comma sat between rules, and the generator doubled a `+` (emitting `NaNNaN`), so the browser dropped those rules and the whole injected script failed to parse — there was not even an `#fp-embed-style` element on the page, which is why navigation went silent. Fixed; the injected sheet now applies in full.
- **File windows show folders, and the list has a hierarchy.** Directories come first, bold, with a `▸`; files carry an extension badge and their size on the right; the path is a clickable breadcrumb (`D: › fix › asar`) so you can jump back up a level with one click instead of only `↑`.
- **A standalone window no longer sits on the welcome screen.** The welcome screen's sidebar lists workspaces but no sessions, and the navigation fallback kept clicking the *first* workspace row, so it stayed in someone else's workspace forever and the target conversation never appeared. It now walks the workspace rows in turn (one every ~2.4 s until one of them lists the target session), and opens the session as soon as its row shows up. Verified in a maximised Edge window: title becomes the session name, eight message blocks render, sidebar `display:none`, conversation spans x=0–1476.

### Changed
- **The plugin window sorts endpoints by whether they can actually render.** Every discovered `/_dsh/...` path is probed; 404s are no longer listed. JSON and text keep the pretty-printed view, HTML responses (a plugin's own board with its own styles) are rendered in an iframe so the colours and layout survive. Plugins that only ship a host panel and no HTTP page — `context` (the context board), `talk-map`, `plugin-hub`, and eleven more — are collapsed into one line, "面板类插件 14 个：卡片里暂时嵌不进来，先不摆出来", which you can expand to see the names; no more entries that look clickable but do nothing.

## 0.5.1 (2026-11-17)

### Fixed
- **The composer was missing from session windows.** The pure-mode stylesheet forced the host's three-column frame to `display:block` so that hiding the two side columns would not leave empty grid tracks. It does not leave any — the tracks collapse on their own — and dropping the grid threw away the frame's height constraint, so the embedded client grew to its content (a 770 px viewport became 2838 px) and the composer, which belongs at the bottom, was pushed 2 500 px down the page while `html,body{overflow:hidden}` kept it out of reach. The frame now keeps `display:grid`; only a real grid template gets collapsed to a single track. Verified in Edge: composer sits at 575–770 in a 770 px viewport, clickable and typable.

## 0.5.0 (2026-11-17)

### Added
- **Files open inside their window** — a row used to be nothing but a drag source, so a file window could never show you a file. Clicking one now reads it through the host (`readFile`: text up to 512 KB, images as base64, binaries refused with a reason) and renders it in place, with 返回 / → 笔记 / 系统打开 / 复制路径; `Esc` goes back, oversized files say so and point at 系统打开. The open file is remembered on the card and comes back after a reload.
- **Plugin window syncs and links** — the same input now takes either a `/_dsh/...` route or a local file path. When the path is a route it renders the full link with ↗ 打开 (turns it into a web window on the canvas) and 复制链接; 同步 re-reads it every 2.5 s and lights a LIVE badge plus 上次 HH:MM:SS. Double-clicking an endpoint chip opens it as a window too.
- **The type picker scrolls in small windows** — the nineteen entries used to be clipped by the window body when the card was short; the picker now scrolls and still centres itself when there is room.

## 0.4.1 (2026-11-17)

### Fixed
- **会话卡片不再卡在「12 秒没出内容」的兜底卡上（压测 P0-5）** —— 副本里那段注入脚本原来按「启动次数」判断放弃：`fp.boot` 记在 sessionStorage，而画布和每张 iframe 同源，所以计数器是全画布共享的，用几次之后就必在第 4 次加载的第一次心跳（注入后 250ms，客户端连输入框都还没画出来）直接 `fpGiveUp()` 并**永久停掉导航循环**，屏幕上只剩下兜底文案。现在判据改成「跑了 18 秒还没进对话」，并且只要检测到输入框就把计数清零（自愈），放弃时也会清零并记 `nav-giveup`；正常一次仍约 3–5 秒进对话。
- **注入脚本每秒的全文档扫描** —— `sessionRow` 从 5 条 `[data-row-key*=…]` 子串选择器改成单遍 `querySelectorAll` 并用 `__fpRowEl` 缓存；`titleRow` 加 1.2 秒节流并收窄选择器；`hasComposer`/`inThread` 各加 400–600ms 结果缓存；装饰性的 `hideDecor`/`widen`/`collapseEmptyPanes`/`trimRight` 降到每 4 拍一次。新增一次性 `perf` 日志（navigation timing + 最慢 8 个资源），方便下次直接看瓶颈。
- **拖外面东西进来时看不到落点（压测 P1-4）** —— 拖拽时那张 `.fp-shield` 挡板把 `dragover` 全吃了，卡片自己的 `onDragOver` 根本不触发。现在画布根上用 `elementsFromPoint` 穿过挡板找真正的目标卡片，自己算最近的一条边并高亮；标签换成药丸样式（「左边 · 一半」），遮罩外圈加了一根虚线，回答「会落到哪里、占多少」。
- **右键什么都没有（压测 P1-5）** —— 新增 `CtxMenu`。卡片右键：重命名（自绘输入框，因为桌面版会吞 `window.prompt`）、换一场会话（列最近 5 场）、向左/右/上/下各拆一半、复制一份到右边、断开数据源、关闭这张卡；画布空白右键：新建会话/笔记/浏览器/空卡片、一键排列（按卡片数挑最合适的预设，不会清掉你的内容）、全部挂起、切换自由/填充、清空画布（要确认）。`Esc` 或点别处关掉。
- **侧栏「取消固定」误删就能撤了（压测 P1-11）** —— 监听宿主侧栏那颗 `button[aria-label="从侧边栏取消固定…"]` 的点击，点完在屏幕底部浮一条「已从侧边栏移除「自由窗格」· 撤销」；点撤销会去「更多」菜单里把那颗 `固定…` 菜单项点回来（宿主的固定状态只存在内存里，没有可直接写的接口，所以只能替用户点一次），找不到时明确提示去「更多 → 固定」。
- **会话卡片只有一种形态（压测 R3-6）** —— 卡片里的副本一律用 `fpEmbed=pure`：只剩对话正文，不再出现「左边一套侧栏 + 中间又一套导航」的双重导航。
- **右键菜单的类名不再撞车** —— 菜单原来叫 `.fp-ctx`，跟「上下文占用」卡片自己的 `.fp-ctx{flex:1}`、`.fp-ctx-head` 撞在一起，两边互相污染（菜单每项被拉成一整段、卡片正文被菜单的边框和背景盖住）。菜单侧全部改名 `.fp-menu / .fp-menu-head / .fp-menu-item / .fp-menu-hint / .fp-menu-sep`。
- **浮层不再受「动画被暂停」影响而整块看不见** —— 菜单、撤销浮条、落点高亮的入场动画原来从 `opacity:0` 开始。标签页被浏览器节流时（`animation-play-state: paused`，后台窗口、被完全遮挡的窗口都会命中），动画停在第 0 帧，于是元素虽然算出来就在屏上、却一点不显示 —— 这既解释过「右键没反应」，也解释过压测里「拖拽全程没有落点预览」。三条 keyframes 现在只动 `transform`，不碰 `opacity`。
- **缩小/放大变成对称档位** —— 原来每次按 `×(1±0.12)`，缩两下再放两下回不到 100%（0.77 → 0.86 → 0.96），看起来像「放大键少走了一格」。现在走固定档位 `0.7 / 0.8 / 0.9 / 1 / 1.1 / 1.25 / 1.4 / 1.6`，两下缩两下放必然回到 1.0。

### Changed
- **标题选择器弹层** —— 弹层从按钮里的子节点搬到卡片根节点（`.fp-win`）上，位置用按钮和卡片的 `getBoundingClientRect` 现算，宽度内联 `260px`（不再靠 `!important` 去压 flex），卡片下半截放不下时自动翻到按钮上方，点别处或按 `Esc` 关闭。列表行也补了 `flex:0 0 auto` —— 以前 29 行在 `max-height:240px` 的 flex 列里被压成 10px 高的细线，看上去像「弹层坏了」。
- **12 秒兜底改成底部窄条** —— 兜底原来是一块盖住整张卡的大面板，等于「卡没出来」；现在缩成贴底的一条「还没打开这场对话 —— 在这个窗口里点一下左侧的会话，或者点「重试」」，带「重试 / 单独窗口 / 收起」，卡片本体不再被挡。


### Added
- **Little widgets made of plugin parts** — the empty window's picker now lists ten `🧩` entries that turn a piece of the host UI (whale bubble, turn/step/token counter, composer dock, usage cards, bottom bar, conversation column, side bars) into its own window instead of embedding a whole client. Blocks that only exist inside a conversation are cloned by the embedded copy and posted back to the canvas, so they work even while the canvas owns the main pane.
- **Every widget names its source** — each widget window carries a `🔗` line showing which conversation it is attached to (set explicitly → the session window above-left → the last opened one), and a `→ 笔记` button that appends the block's text to the note window below it (or the nearest one, or a fresh one) under a `## HH:MM` stamp.
- **A local OCR window** — `OCR（本地）` calls `dsh-ocr-local` through the host (`/plugins/dsh-ocr-local/api/ocr`, sent host-side so it also works from `dsh-app://`), previews the text with timing/line/block counts, and its `识别 → 笔记` button performs the whole OCR → text → note chain in one click.
- **Plugin interface window** — reads any `/_dsh/...` path through the local proxy, groups installed plugins' discovered endpoints as one-click chips, and hands whatever it read to a note the same way.

### Changed
- **Window titles sit dead centre** — the header is now three zones: the left zone is empty for session windows, the title is absolutely centred (`left:50%` + translate), and every other control plus the close button stays in the right zone. The close button is always the right-most thing.
- **Every session window is the pure conversation** — the 纯净/完整 switch is gone: a session window always shows just the conversation column (no copy sidebar, no copy right rail, no header action buttons), because a window is one board. The embedded copy also sets its own zoom from its available width, so a narrow window no longer overflows.
- **用量 borrows the real widget** — instead of drawing our own cards, the window now mirrors whatever the host actually shows: the composer's bottom bar (cost / balance / usage / context), the whale bubble's spend figure, or the claude-style ring cards — whichever exists, cloned every 1.5 s at natural size with `position:fixed` children flattened into normal flow. When none of them exist (the canvas owns the main pane, so the composer is unmounted) it falls back to the local ledger bridge and says so.
- **Up to nine embedded clients can run at once** — copies sharing one origin starve each other (the browser allows only six connections per origin, so the second copy's boot script never runs and it stays on the welcome screen forever). The host now starts nine proxy listeners and each session window takes one by tree order, so every copy is its own origin. A cold canvas warms two windows, and 全部挂起 in the top bar fills the rest up to the limit; anything beyond it shows the queue card (running session's name + 「换到这里」). Verified with four session windows live side by side (~2.4 GB of browser memory for four). The frame sweep that hides copy chrome and drives navigation lives at module level so it survives panel remounts.

### Fixed
- **获取 no longer wrecks the canvas** — picking a block that is the canvas itself (or an ancestor containing it) used to clone the canvas into a window, and the mirrors then nested each other until the layout fell apart. Picks inside the canvas are now skipped, snapshots strip nested canvas/mirror nodes, and a captured block is laid out full-width instead of being squeezed to fit both axes.

### Added
- **单独抓一块** — the `+` menu now also lists host blocks that live in their own root (报价小鲸鱼/余额 `.dshwv-root`, 底部信息栏, 输入框, 对话列, 左侧栏, 右侧栏面板). Picking one mirrors exactly that block into a window: fixed-size widgets keep their natural size and stay centred instead of being stretched, while columns fill the width. Same live mirror as 片段 — it re-clones every 1.2 s and forwards clicks back to the real element.
- **Main-seat panels** — the panel window type now lists the sidebar's own panel entries as `main:<label>` alongside the right-bar tabs. A `main:` choice opens that panel inside the embedded client and hides its sidebar and right rail, so a plugin that only registers a main-seat panel can still be dropped into a window.
- **Layout presets** — 排列 in the top bar swaps the whole canvas for one of eight ratios borrowed from real multitasking UIs: iPad Split View 66/33, Stage Manager, Slide Over, three-column mail, Windows 11 Snap 70/30 with a stacked right side, Mission Control 2×2, three equal columns, and a DeX-style waterfall. Each presets tries to keep your current session.
- **Palette presets** — 配色 repaints only this canvas (background, window chrome, dividers, accent) with six skins: follow-host, Apple light, Apple dark, glassmorphism, graphite and paper. It never touches host or embedded colours.
- Titles for sessions now come from the projection cache (`~/.dsh/storages/session_projcache/sessions/<uuid>.json`), so the list shows real conversation names immediately instead of deep-scanning the event log.
- **Seams you can drop on** — dragging a window onto the divider between two windows inserts a third one between them (both sides give up half); dragging into a window still splits that window by the nearest edge.
- **A new window is placed by you** — the `+` button no longer opens a type menu: it drops an empty window that follows the pointer, and you click where it should land (Esc cancels). The empty window then offers the type chooser.
- **Web windows browse** — a web window has a real address bar: type a URL, or type words and it searches with the engine you pick (Bing / Edge / Google / Baidu, remembered per origin).
- **获取 (pick) is a first-class button** — it starts the same picker as Alt+D and says so in its tooltip; whatever you click becomes a window.
- **Effects are optional** — the 动效 button toggles the blur-and-settle animation new windows play when the layout changes; the choice is remembered.
- **Native file picking** — the files window has a 系统选择… button next to its own tree, so you can use the system dialog when it is available.
- **Usage bridge (数据桥)** — a new usage window reads the ledger that `dsh-bottom-info-bar` already keeps (`~/.dsh/dsh-bottom-info-bar/usage-ledger.sqlite`) through a host route, shows today's spend / tokens / this session's tokens / ledger total, and marks every number with a flat 🔗 next to its source. It refreshes itself every 30 seconds and never touches the network.
- **Region windows** — pick the "capture a piece of the UI" button (or drop something that is not a session / link / file), then click any part of the host interface: that subtree is cloned into a window and re-synced every 1.5s. Same document, so the app's own styles (including CSS-module hashes) keep working; no extra client is launched, so it costs no memory.
- Embedded copies now hide the per-message action buttons (list / more / expand) so a mirrored conversation looks clean. Turn it off with `?fpChrome=1`.

- **Capture hotkey** — Alt+D starts a capture; while you aim, the page dims and the element under the cursor lights up with its size. Configurable through `localStorage['dsh-free-pane.hotkey']`.
- **Picking is now accurate** — it resolves the element actually under the pointer (`elementsFromPoint`) and skips full-page skin overlays, instead of taking whatever the click event happened to hit.

### Fixed
- An embedded copy now really lands in the session you bound to it. The old click-the-row approach was unreliable (React ignores bare synthetic clicks, and narrow windows collapse the session list into a drawer): the script now opens that drawer on demand, dispatches the full pointer sequence, falls back to Enter on the row, and treats the copy as "arrived" once its document title equals the session title.
- Archived sessions stay out of the source picker by default (the list is read from `~/.dsh/storages/workspace.json` → `global.archivedSessionIds`); the picker shows 显示归档 (n) / 隐藏归档 (n) to bring them back, and archived rows are italic and dimmed.
- A session window no longer stops at the "What's up next" home view: the injected script used to treat "a textarea exists" as "we are inside the conversation", which is also true on the home screen. It now also requires the session row to be selected or the thread to have real messages, and it opens the sidebar once when a narrow window has collapsed the session list.

# 更新日志

## 0.10.0（2026-11-19）

- **标准窗口**：`std` 卡吃一份固定 JSON——`{ title, subtitle, … }`——按 `metrics / table / list / progress` 四种视图渲染。选择器和添加抽屉都有入口；工具栏「示例」恢复样例，「JSON」直接改数据，插件或脚本不用再写新 UI。
- **Material 命名**：结构元素加了 `data-m3`（`surface` / `top-app-bar` / `card` / `card-header` / `fab` / `side-sheet` / `menu` / `tabs` / `search-picker`），旧 `.fp-*` 类名保留兼容；新旧对照写在 `docs/material-naming.md`。
- **删重复**：头部链条按钮 + 右键「断开数据源」、`chainOf` / `toggleChain` / `ownerOf` 三个别名、`contentFor` 里第二个 `files` 分支全部删掉；会话相关卡只留下拉框。

## 0.9.2（2026-11-19）

- **可选适配技能**：`skills/free-pane-plugin-adapter/SKILL.md`。先只读检查用户自己的插件，判断它属于「宿主 HTML 页 / 宿主 JSON / 右栏面板 / 纯客户端挂件 / 会话 artifact」哪一种，然后给四个选项：只报告（默认）/ 只加 free-pane 预设或路由 / 改插件补路由或面板 / 写自定义卡片。用户没明确选之前不写任何文件；验收覆盖路由状态、卡片渲染、会话下拉绑定、明暗配色和小窗口适配。

## 0.9.1（2026-11-19）

- **修**：会话相关卡片不再按位置猜会话。用量 / 上下文 / 片段 / OCR 只读卡片头部下拉框里明确选中的那一场；新会话卡默认空着，让用户自己选。原来「左上方邻居 → lastSession → 列表第一」的吸附链全删，链条按钮也撤掉。
- **修**：下拉框高度跟 `--fp-head-h` 走（减 4px、最多 24px），75% 档 22px 卡头里不再溢出。

## 0.9.0（2026-11-18）

- **仪表卡片**：新窗口类型 `dash`。填一个插件挂在宿主上的路由，HTML 路由（agent-body 的 `/anatomy`）直接嵌入并按秒刷新；JSON 路由（任务监控、telemetry）摊成指标块 + 列表计数 + KV 表；纯文本原样显示。路由可改，默认 5 秒自动刷新、可切手动，「原始」一键看 JSON。内置 `/anatomy`、`/anatomy/data.json`、`/taskmonitor/data` 三个例子。
- **`docs/dashboards.md`**：记下 DSH 仪表插件的三种出内容方式（宿主 HTML 页 / 宿主 JSON + 客户端浮层 / 会话 artifact 卡）、各代表项目，以及 free-pane 分别用哪张卡接。

## 0.8.1（2026-11-18）

- **修**：Office、压缩包、可执行文件这类不能内嵌的，现在直接说明「DSH 右栏『文件』能正常预览」，并给「打开宿主文件面板」按钮；下载副本、系统打开照旧。
- **修**：会话卡停在宿主欢迎页时不再装死。欢迎页侧栏只列工作区、没有会话行，注入脚本永远找不到目标行；现在八秒后卡片会写明原因，并提示点左侧会话或按 Ctrl+K 搜索，而不是留一张沉默的欢迎页。

## 0.8.0（2026-11-18）

- **文件卡变成浏览器式多标签**：点一个文件就开一个标签，一个卡里可以同时开很多文件，来回切、按 × 关；「目录」标签随时回到列表。标签存在卡片的 `fileTabs` / `fileActive` 里，刷新后还在；「新卡片」把当前文件复制成一张独立文件卡；从系统里拖一个文件到画布（或拖文件行）也会直接开一张带这个文件的卡。
- **更多格式就地渲染**：文本和代码照旧，Markdown 默认渲染预览（工具栏「源码 / 预览」切换），图片保持看图；PDF、音频、视频现在都能在卡里直接放。Office 文档、压缩包、可执行文件这类不能内嵌的，会显示文件名、MIME 和体积，并给「下载副本」和「系统打开」，不再只说「读不了」。
- **地址栏能开任意路径**：路径框里粘目录就列目录，粘完整文件路径就直接在标签里打开，并把列表切到它所在目录；「↑」和文件夹行照旧能走，「系统选择…」走 Windows 文件对话框选完直接打开。
- **整体尺寸回到原值的 75%**：样式表里 947 个 px 值统一乘回 75%，十四项尺寸跟着落到顶栏 36、卡头 22、标题 9、圆角 9、间距 6、留白 6、卡头按钮 18、顶栏按钮 24、工具条 28、输入框 24、FAB 33、抽屉 240×15；三套预设一起重算，存值换到 `metrics.v3` 并把旧值一次性折算，避免按错比例生效。卡片里的宿主面板和网页 iframe 按「先按 100/0.75 排版、再整体 0.75 缩放」处理，卡片变大变小都正好铺满。

## 0.7.2（2026-11-17）

- **整体缩小一号**：画布样式表里 123 处 `font-size` 统一缩到 92%，配的那套尺寸默认值也跟着下一档——顶栏 64→56、卡片标题栏 44→36、标题字号 14→13、圆角 16→12、卡片间距 12→8、画布留白 12→8、卡头按钮 32→28、顶栏图标按钮 40→36、卡片内工具条 48→40、输入框 40→36、FAB 56→48、侧边抽屉 368/28→340/24。「紧凑」预设再小一号，想要更密就是一键的事。
- **每个尺寸都能从 0 开始调**：更多 → 开发者选项（尺寸）里那十四项全部把下限放到 0（标题栏高度、按钮、输入框、工具条、FAB、抽屉宽度和圆角都在内），一张卡可以一路调到只剩边框，不再卡在「安全最小值」上。存的键换成 `dsh-free-pane.metrics.v2`，所以新默认值下次加载就生效，不会被以前拖出来的旧数字盖住；「标准」和「恢复默认」照旧。
- **内容缩放能到 50%**：缩放档位现在是 0.5 · 0.6 · 0.7 · 0.8 · 0.9 · 1 · 1.1 · 1.25 · 1.4 · 1.6，一张卡能装下更多对话；缩两下再放两下仍然精确回到 100%。
- **修**：`?fpMetrics=reset` 只在加载时消费一次——清掉存的尺寸后把参数从地址栏移除。以前参数一直留在 URL 里，每次渲染都会再清一次，于是「重置之后再调尺寸」永远存不住，刷新还会再被重置一遍；`readMetrics()` 现在只负责读。

## 0.6.0（2026-11-17）

- **dsh-context 的看板，一窗一表**：上下文插件（0.84.1）的数字只在 `api/dsh-context/*` 后面，而且只认带宿主 cookie 的浏览器，卡片以前根本够不着。现在 `ctx` 卡片直接打这些接口，把八张表画出来：总览（会话数/轮次/Token/成本/缓存命中 + Token 组成 + 各阶段耗时）、会话（53 场，一行一场，点一下就把卡片接到那场对话）、每日（每天多少 Token、多少钱）、技能（哪些技能跑过、各多少次）、明细（每一次请求：第几轮第几步、输入、缓存读、输出、耗时）、事件（上下文事件）、文件（文件改动）、命令（执行过的命令 + 次数/失败/总用时）。每张卡片顶上自带标签页，原地切换；底部写明数据来自哪个接口、多久刷新。
- **一张卡片能把会话交给另一张卡片**：「会话」表里点一行，那张卡片就绑定到那场对话并跳到「明细」——从「哪场对话最贵」到「贵在哪一步」只差一次点击。
- **窗口按内容自己起名字**：表格卡叫「看板卡片 · 会话表」，文件卡打开文件后显示文件名，终端卡按目录名，网页卡按站点，笔记卡按第一行，接口卡按路径。右键「重命名…」的优先级永远最高。
- **卡片被挤小也不会烂**：宽度不到 300px 时表格不再硬撑表头，每行折成「列名 / 值」的列表（表头收起、值还在）；不到 220px 时标题栏收起文字按钮。一次加很多张卡（比如七张）时，画布自动摆成均匀网格（`tidyIfTight`），不会再挤成 66px 的细条，trace 里会记一条 `tidy-grid`。
- **`docs/cards-interface.md`**：怎么加一种卡片、断点在哪、dsh-context 每个接口的字段表、宿主 RPC 约定、以及 `fpAdd` / `fpTrace` / CDP 的验收套路。
- **修**：兜底条可能赖在已经打开的对话上——副本可能跑在另一个代理端口（一卡一个 origin，免得宿主的 6 条连接被吃满），父页面读不到它的 `contentDocument`。现在副本进了对话会 `postMessage({__fp:'ready', sid})`，父页面收到就撤掉「还没打开这场对话」。
- **修**：早先的编辑把 `readFitMode` 一起替换掉了，于是每次渲染都抛 `ReferenceError: readFitMode is not defined`，插件被自己的错误边界换成了「自由窗格渲染出错了」。已恢复，并把「与上一版的函数清单逐条比对」加进检查流程。
- **改**：类型选择器分五组（对话 / dsh-context / 工具 / 抓取 / 面板），表格窗口的当前标签改成下划线高亮。

## 0.5.2（2026-11-17）

### 已修
- **对话右边那条空栏** —— 宿主的 `.mP3x-q_frame` 上挂着 JS 现算的内联 `grid-template-columns`（`280px minmax(0,1fr) minmax(0,0px)`），左右两栏虽然 `display:none`，它们占的轨道还在，于是卡片里（单独窗口里则是整个页面）对话左边多出一条约 111px 的死条。内联样式压不住模板改写，所以改成让中间列跨满所有轨道：`html[data-fp-ok] [class*="centerCol"]{grid-column:1/-1!important;justify-self:stretch!important}`。实测 1610px 宽的卡片和 1376px 的单窗体里 `centerCol` 都从 0 开始、宽度满格。
- **跨满轨道那条规则以前会让侧栏点不动** —— 它一进纯净模式就生效，可那时侧栏还在、只是被中间列盖住了：单独窗口里连点四十多下工作区行都没反应，于是停在欢迎页。现在加 `html[data-fp-ok]` 限定，只有真的进了会话（左右两栏已经藏掉）才铺满。
- **纯净模式的样式表有两处语法错** —— 规则之间多了一个逗号，生成器里还有一处把 `+` 写成了两次（拼出 `NaNNaN`），浏览器把这两条规则丢掉，整段注入脚本连解析都过不去（页面上连 `#fp-embed-style` 都找不到，导航逻辑自然全哑）。已修好，注入样式现在整份生效。
- **文件窗口能看出层次了** —— 文件夹排在前面、加粗、带 `▸`；文件行右侧有后缀徽标和体积；路径变成可点的面包屑（`D: › fix › asar`），点哪一层就跳到哪一层，不用只靠 `↑`。
- **单独窗口不再停在欢迎页** —— 欢迎页的侧栏只列工作区、不列会话，而兜底逻辑一直点「第一行工作区」，于是永远待在别人的工作区里、目标会话一辈子不出现。现在按顺序轮流点工作区（每约 2.4 秒换一个，直到某个工作区列出目标会话），行一出现就点进去。最大化 Edge 窗口实测：标题变成会话名、8 个消息块渲染出来、侧栏 `display:none`、对话从 x=0 铺到 1476。

### 改动
- **插件接口窗口按「能不能真渲染」分类** —— 扫到的每个 `/_dsh/...` 路径都会真的探一次，404 的不再列出来。回 JSON / 文本的照旧美化显示，回 HTML 的（插件自己带样式的看板）改用 iframe 真渲染，颜色和布局都留得住。只提供宿主面板、没有 HTTP 页面的插件 —— `context`（上下文看板）、`talk-map`、`plugin-hub` 等 14 个 —— 收进一行「面板类插件 14 个：卡片里暂时嵌不进来，先不摆出来」，点一下可以看名字；不再摆出看着能点、点了没反应的入口。

## 0.5.1（2026-11-17）

- **会话卡片底部的输入框不见了**：纯净模式为了让藏掉左右两栏后不留空轨道，把宿主那层三栏框架压成了 `display:block`。可那两条轨道本来就会跟着 `display:none` 自己塌成 0，而丢掉 grid 等于丢掉高度约束——副本不再按视口高度排，而是按内容长高（770px 的视口长到 2838px），本该贴在底部的输入框被顶到 2500px 开外，`html,body{overflow:hidden}` 又让人滚不下去。现在框架保留 `display:grid`，只有在它确实是 grid 模板时才把模板压成一条。Edge 实测：输入框在 575–770（视口 770），点得进去、打得进字。

## 0.5.0（2026-11-17）

- **文件卡片里点文件就能看**：原来文件行只能拖走，点了没有任何反应。现在点一下走宿主 `readFile` 把内容读回来就地渲染——文本最多 512KB（超了标出来并提示用「系统打开」）、图片按 base64 显示、二进制明说读不了；顶部有「← 返回 / → 笔记 / 系统打开 / 复制路径」，`Esc` 回目录。看的是哪个文件会记在卡片上，刷新后接着看。
- **插件卡片能同步、能链接**：同一条输入框既认 `/_dsh/...` 接口，也认本机文件路径（文件走 `readFile`，接口走本机代理）。路径是接口时结果上方多一行完整链接：「↗ 打开」把它开成一张网页卡片、「复制链接」写进剪贴板；「同步」开着就每 2.5 秒自动重读，状态行亮 LIVE 并显示「上次 HH:MM:SS」。接口 chip 双击也能直接开成卡片。
- **空卡片的类型选择器在小卡里能滚了**：原来 19 项被窗口主体裁掉一半，点不到底下的「OCR / 文件 / 终端」；现在选择器可滚动，卡片够高时仍然居中。

## 0.4.1（2026-11-17）

- **会话卡片秒进对话**：副本里的导航脚本原来按「启动次数」判放弃（`fp.boot` 存在 sessionStorage，画布和每张卡同源，计数器全画布共享），用几次之后第 4 次加载必在第一次心跳就永久停掉导航，只剩兜底文案。现在按「跑了 18 秒还没进对话」判、见到输入框就清零自愈；实测每次加载 2–6 秒进对话，`inject-boot` 每次只出现一次。
- **副本导航修了三处**：侧栏在窄卡片下是抽屉（不拉开时行全是 0×0，而旧代码每 3 拍点一次开关，抽屉开→关→开反复翻）；判断「进没进对话」把欢迎语正则套在了整列文本上（真会话的输入框占位符就写着「开始新的对话」，于是永远判否）；纯净模式只藏了 `sidebarCol`，抽屉是另一份 DOM，得连 `[class*=drawer]` 一起藏（现在用 `html[data-fp-ok]` 一次性收到位）。
- **只留一种会话卡形态**：一律 `fpEmbed=pure`，卡片里再没有「一套副本侧栏 + 一套宿主侧栏」的双重导航。
- **标题选择器**：弹层挂到卡片根节点、宽度内联 260px，卡片下半截放不下就翻到按钮上方；行高修好（以前每行被压成 10px），搜索框按 Escape 关闭。
- **右键菜单**：卡片（含 iframe 内部右键转发）与画布空白都能用；卡片项有重命名、换一场会话、四向拆一半、复制一份、关闭，画布项有新建各类卡片、一键排列、全部挂起、换自由排布、清空画布。菜单类名改成 `.fp-menu`，不再跟「上下文占用」卡片的 `.fp-ctx` 撞车。
- **落点预览**：`moveHead` 里一句 `var host = …closest('[data-leaf-id]')` 把 `elementsFromPoint` 算出来的落点又覆盖回源卡片自己，于是永远 `setHover(null)`、全程没有预览；去掉重算后拖到别的卡片上会稳定出现半屏高亮带 + 药丸标签「左边 一半」。
- **侧栏「取消固定」可撤销**：点掉之后底部浮条 12 秒内可点「撤销」，会自己走「更多 → 编辑侧栏… → 勾回自由窗格 → 完成」把面板放回去（宿主的固定状态只在内存里，没有可写的接口）。顺带修了第一版勾错行的问题（把整列容器的文本都拿去匹配，结果把「搜索」钉上去了）。
- **浮层动画不再吃 `opacity`**：标签页被节流时动画停在 `opacity:0` 那一帧，菜单/浮条/落点高亮会整块看不见；现在只动 `transform`。
- **缩放改固定档位**：缩小两下再放大两下能精确回到 100%。
- **12 秒兜底改成贴底窄条**：带「重试 / 单独窗口 / 收起」，不再盖住整张卡。

- **接缝能放东西**：把窗口拖到两窗之间的分隔条上，会在中间插一个窗、两边各让一半；拖进窗口内部仍按最近的那条边劈开。
- **新窗口由你放置**：`+` 不再弹类型菜单，而是先挂出一个跟着鼠标走的空窗口，点哪儿就落在哪儿（Esc 取消），落地后再选类型。
- **网页窗口能搜能开**：带真实地址栏，输入网址就打开，输入词就用选定的搜索引擎搜（Bing / Edge / Google / 百度，按 origin 记住选择）。
- **「获取」是一等按钮**：点它即进入取点，提示里写明也可以按 Alt+D；点到哪一块，就把它变成窗口。
- **动效可关**：顶栏「动效」开关控制新窗口加入/让位时的雾化纵深动画，选择会被记住。
- **文件可走系统选择**：文件窗口除内建目录树外，还有「系统选择…」按钮（宿主支持时用系统对话框挑文件）。
- **用量数据桥**：新增「用量（数据桥）」窗口，通过宿主导由读 `dsh-bottom-info-bar` 已有的账本（`~/.dsh/dsh-bottom-info-bar/usage-ledger.sqlite`），显示今日花费 / 今日 Tokens / 本会话 Tokens / 账本累计，每个数字旁挂一个扁平 🔗 标明来源，每 30 秒自动刷新，全程不联网。
- **推翻固定格网，改成自由分割画布**：一块空白画布，拖进来的第一件东西占满，之后再拖就按「最近的那条边」四向劈开；分隔条可拖动改比例，窗口标题栏可搬到别的窗口的四条边上，关掉的窗口由邻居自动接管面积。
- 同一块画布两个落点：主区域（左栏点「自由窗格」）、官方右侧栏的 tab（+ 新标签 → 自由窗格）。
- 窗口类型：会话（网页副本 + 指定会话）、网页、笔记（Markdown 双栏实时预览）、终端、文件、Git；左上角 + 可按类型添加。
- 拖动反馈：拖动时被拖的窗口变淡，目标窗口半屏高亮并显示方向（← 左边 / 右边 → / ↑ 上边 / 下边 ↓）。
- **去掉浮层模式**：整窗覆盖的 `shell.overlay` 与右边缘那条竖排「自由窗格」标签一并删除——它有能力吞掉整屏、又只留一个边缘标签当出口，是点不动的根源。现在画布只活在主面板和右侧栏 tab 里，盖不住应用本身。
- 删掉旧格网代码（约 1800 行）与调试探针，client.js 从 120.9KB 收到 53.7KB。
- **修好了「往会话窗口上拖没反应」**：会话窗口里是一整个跨源 iframe，鼠标落在上面时 `dragover`/`drop` 会被 iframe 自己吃掉。现在拖拽进行中会在每个窗口内容上盖一层透明挡板，让事件回到父页面；并且挡板要等 `drop` 处理完才撤（capture 阶段同步撤掉会让 React 的合成事件找不到目标）。

- **会话窗真的切进目标会话**：以前靠「点一下会话行」，React 不吃这种裸合成点击、窄窗口还会把会话列表收进抽屉，所以常常停在欢迎页。现在按需拉开抽屉、补齐完整指针序列、再用回车兜底，并以「副本文档标题等于会话名」作为已进入的判据。
- **归档会话默认不出现**：来源选择器从 `~/.dsh/storages/workspace.json` 的 `global.archivedSessionIds` 读归档表，默认把这些会话藏起来，右上角有「显示归档 (n) / 隐藏归档 (n)」可切换，归档行斜体变淡并标注「已归档」。

## 0.1.0

首个可用版本。

- 浮层网格：注册到 `shell.overlay`，不接管主区域；主对话按格子矩形重排，左右栏与浮层插件保持原样。
- 八套预设：经典 3×3、四宫格、左右分屏、六格、九等分、主左栏、上主栏、三栏，附「重置」。
- 十种格子：主对话、会话、浏览器、面板、网页、笔记、终端、文件、Git、空窗格。
- 改大小：右下角拖拽 + 标题栏尺寸徽标单击循环（放大吞并空格、缩小自动补格）。
- 拖拽换位；把格子拖到网格外松手即可清空。
- 拖放自动识别：会话行 → 会话格，链接 → 浏览器格，文件 / 目录 → 文件格（`statPath` 分辨文件与目录，文件落到它所在目录），纯文字 → 笔记格。
- 「会话」格子：宿主侧反向代理 + 注入 CSS（隐藏侧栏与浮层、等比缩放、自动进入指定会话）。
- 「浏览器」格子：借官方 `sidebarRight` 开 browser tab 并 float 到格子位置。
- 「面板」格子：把任意插件注册的侧栏面板（`sidebarRight` tab 类型）float 到格子位置，下拉自动列出宿主已注册的全部面板；开完自动把右栏收回去。
- 宿主 RPC：`listSessions`、`listDir`、`statPath`、`exec`、`gitStatus`、`proxyUrl`。
- 布局持久化到 `localStorage`（按 origin）。
- 收起 / 展开：顶栏「收起」+ 右侧中部竖排标签。
