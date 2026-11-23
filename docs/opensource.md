# 开源与发布

这个插件以 MIT 许可开源（见根目录 `LICENSE`）。本页说明如何把它变成一个可公开访问的仓库、怎么打 tag / 发布产物，以及内测（alpha）通道怎么走。

## 仓库内容

公开仓库只包含源码与文档：

- `index.js` / `client.js` — 宿主与渲染层入口
- `cordis.patch.yml` / `locale/` / `icon.svg` — DSH 插件清单资源
- `docs/` — 设计、兼容性、安装、会话契约、卡种说明
- `skills/free-pane-plugin-adapter/` — 桥接方法 skill
- `compat/` — 单版本兼容性 harness
- `scripts/preflight.mjs` — 打包前检查

`.tmp/`、`dist/`、`release/`、截图和本机日志都不进仓库。

## 发布一个开源版本

1. 在 GitHub（或其他平台）建一个空仓库，例如 `dsh-free-pane`。
2. 关联远端并推送：

```bash
git remote add origin git@github.com:<you>/dsh-free-pane.git
git push -u origin main
```

3. 打版本 tag 并推送：

```bash
git tag v0.10.20-alpha.1
git push origin v0.10.20-alpha.1
```

4. 在 GitHub 上创建 Release：
   - Tag：`v0.10.20-alpha.1`
   - 标题：`dsh-free-pane 0.10.20-alpha.1（内测）`
   - 说明：直接引用 `CHANGELOG.md` 顶部一段
   - 附件：
     - `dsh-free-pane-0.10.20-alpha.1.tgz`（插件安装包）
     - `dsh-free-pane-0.10.20-alpha.1-source.tar.gz`（源码存档）
     - `SHA256SUMS.txt`
5. 如果要发 npm，用 alpha 通道，不要覆盖 `latest`：

```bash
npm publish --tag alpha
```

`package.json` 已设 `publishConfig.tag = "alpha"`；显式加 `--tag alpha` 更保险。

## 本机装载

- **装载打包版**：

```bash
dsh plugin --profile desktop add "dist/dsh-free-pane-0.10.20-alpha.1.tgz"
```

- **装载开发版**（源码目录 junction）：

```powershell
New-Item -ItemType Junction -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-free-pane" -Target "D:\path\to\dsh-free-pane"
```

装载后需要完全重启 DSH；`Ctrl+R` 只重载渲染层，不会重新读宿主包。

## 内测约定

- 内测版本号：`0.10.x-alpha.N`；候选版用 `-rc.N`。
- npm 通道：`alpha`，不覆盖 `latest`。
- 安装时写精确版本（`dsh-free-pane@0.10.20-alpha.1`）或直接用 tarball，避免被稳定通道顶掉。
- `engines.dsh` 对内测包同样生效；未验证的 DSH 版本装不上。

## 开源前检查

- `npm run preflight` 通过（无本机路径、固定端口、测试会话 id）。
- `git status` 干净；`.tmp/`、`dist/`、`release/` 不在仓库里。
- `LICENSE`、`README.md`、`COMPATIBILITY.md`、`docs/install.md` 都在。
- 不提交任何 token / key / 日志；`dsh-free-pane-trace.log` 只存在于本机 `%TEMP%`。
- 历史里如果曾提交过敏感信息，先清理历史再公开仓库。
