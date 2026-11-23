# 安装与分发

## 1. 构建可分发包

```bash
cd packages/dsh-free-pane
npm pack --pack-destination dist
```

产物：`dist/dsh-free-pane-0.10.20-alpha.1.tgz`。

包内只包含运行所需文件：`index.js`、`client.js`、`cordis.patch.yml`、`locale/`、`icon.svg`、README、CHANGELOG、LICENSE、`docs/*.md`、`skills/*/SKILL.md`。不会带 `.tmp/`、截图、测试脚本或本机配置。

## 2. 安装到 DSH

### 从 npm 按名字安装（推荐）

包已发到 npm，名字就是 `dsh-free-pane`：

```bash
dsh plugin add dsh-free-pane --profile desktop
```

或在「插件」页的安装框里直接输入 `dsh-free-pane`。

alpha 通道装了不会顶掉 latest，要指定版本就写 `dsh-free-pane@0.10.20-alpha.1`。

### 从本地包安装

1. 打开「插件」页。
2. 选「安装本地 bundle」。
3. 选解压后的 `dsh-free-pane/` 目录，或直接选 `dsh-free-pane-0.10.20-alpha.1.tgz`。
4. 确认 `dsh-free-pane` 已启用，按一次 `Ctrl+R` 重载渲染层；宿主 RPC 变更需要完全重启 DSH。

### 命令行

```bash
dsh plugin add "D:/path/to/dsh-free-pane-0.10.20-alpha.1.tgz" --profile desktop
```

`dsh plugin` 把参数转给 profile 目录里的 pnpm；也可以先解压，再 `dsh plugin add "D:/path/to/dsh-free-pane" --profile desktop`。

## 3. 第一次打开

- 左栏点「自由窗格」；或在右侧栏 `+ 新标签 → 自由窗格`。
- 第一次是空画布，点右下角「添加」选卡片。
- 拖会话、文件、链接、纯文本进画布也能直接落成卡片。

## 4. 安装桥接 skill

包内已带：

```
skills/free-pane-plugin-adapter/SKILL.md
```

直接复制到本机 skill 目录：

```powershell
Copy-Item -Recurse "D:\path\to\dsh-free-pane\skills\free-pane-plugin-adapter" "$env:USERPROFILE\.dsh\skills\"
```

或在技能市场里从本地目录安装该 `free-pane-plugin-adapter/`。装好后在会话里问「把这个插件接到自由窗格里」就会命中。

## 5. 升级 / 卸载

- 升级：重复安装同一包的新版本，重启 DSH；布局存在 `localStorage`，不会因升级丢失。
- 卸载：插件页停用/移除 `dsh-free-pane`；布局数据仍在浏览器里，重新装回可恢复。

## 6. 已知依赖

- 会话卡：宿主反向代理（插件自带）。
- 文件面板：宿主 `dsh-client-ui-sidebar-files`（DSH 自带）。
- OCR：额外安装 `dsh-ocr-local`。
- 看板/步骤/事件/文件活动/命令：额外安装 `dsh-context`；没有时卡片会给本机兜底或可读的 404。
- Office 预览：宿主自带 LibreOffice Kit；文件卡只负责把文件交给宿主文件面板。
