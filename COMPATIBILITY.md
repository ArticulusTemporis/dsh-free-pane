# 兼容性

## 结论

`dsh-free-pane` 依赖 DSH 宿主的 **Cordis 服务 + 内置客户端**，不是一个纯前端小部件。这个包声明并验证的兼容范围是：

| 项目 | 值 |
|---|---|
| DSH | `>=0.2.2-rc.5 <0.3.0` |
| 验证版本 | **0.2.2-rc.5**（Windows 11 桌面版） |
| 渲染层 | Chromium / Edge（当前桌面版） |
| Node | DSH 自带运行时（Node 22.19+） |
| 平台 | Windows x64（宿主 RPC、LibreOffice、PowerShell 路径） |

`engines.dsh` 已写进 `package.json`：不满足这个范围的 profile 会在安装/激活时被 DSH 拦下，而不是装完才发现白屏。

## 用到的宿主契约

| 能力 | 用法 | 失效时的表现 |
|---|---|---|
| `webServer` | `/_dsh/dsh-free-pane/*` 本地 RPC | 卡片给可读错误，不崩 |
| 反向代理 | 每个会话卡一个本地 origin | 会话卡显示“代理还没准备好” |
| `sessions` | 标题/会话树/下拉 | 列表为空时给空态 |
| `dsh-client-ui-sidebar-files` | 整份文件面板嵌入 | 面板卡给“加载/改开文件卡”兜底 |
| LibreOffice Kit | 宿主文件面板的 Office 预览 | 文件卡只负责交给宿主，不自己转 |
| 宿主 CSS 类名 | 只用 `[class*=centerCol]` 这类**后缀**匹配 | 前缀哈希变化不影响；结构大改会退化 |
| 宿主 `data-*` | `data-row-key`、`data-sidebar-right-*`、`data-dockkit-*` | 缺失时走空态/兜底 |

明确**不保证**：

- 跨 DSH 大版本（0.3+）的 DOM 结构、侧栏 API、面板 tab 注册方式。
- 非 Windows 桌面版的路径/终端/Office 行为。
- 目标网页的 `X-Frame-Options` / CSP（浏览器限制，不是插件 bug）。
- 没有安装 `dsh-context` / `dsh-ocr-local` 的插件能力（卡片会显示缺依赖，不会假装有）。

## 最小验证

```bash
npm run preflight
npm pack --pack-destination dist
```

`preflight` 会检查：

- `index.js` / `client.js` 语法；
- 必备文件、`dsh.bundle.patch`、`engines.dsh`；
- 包内没有本机路径、固定端口、测试会话 id、`fptest` 字样；
- `cordis.patch.yml` 确实插入 `dsh-free-pane`。

安装验证（干净 profile，已执行）：

```bash
dsh plugin --profile compat add "dist/dsh-free-pane-0.10.20-alpha.1.tgz"
```

已确认 tarball 能被 pnpm 解析、安装为 `dsh-free-pane 0.10.20-alpha.1`，且 `dsh.bundle.patch` / `engines.dsh` 都在包里。

运行时验收（本版本在 0.2.2-rc.5 的源码 checkout 上完成）：会话卡、右栏隐藏、宿主文件面板、会话下拉、明暗配色、900×600 与 500×600 窗口。**没有**在其他 DSH 版本或非 Windows 平台上做过运行时验收，因此这些组合不在保证范围内。

## 单版本 harness

```bash
npm run compat
```

只跑**当前最新版**（`compat/versions.json` 固定为 `0.2.2-rc.5`）：隔离 `DSH_HOME`、安装 tarball、启动 `dsh --profile compat --no-open --port 0`、用无头 Edge 打开页面，检查画布、添加笔记卡、宿主 RPC、页面异常，并留下 `screen.png` / `report.json`。不覆盖其他版本或桌面专属功能；详见 `compat/README.md`。

## 升级 DSH 时

1. 改 `engines.dsh` 之前先在新版本上跑一遍安装验证。
2. 重点回归：会话卡宽度、右栏隐藏、宿主文件面板、面板 tab、会话下拉。
3. 宿主 CSS 类名前缀变更通常安全（用后缀匹配）；结构/属性变更需要更新 `docs/` 和本表。
4. 没跑过的版本不要写进 `engines.dsh` 的已验证范围；保持“已知可用 + 其余不保证”。
