# 窗格种类（0.10.17）

「添加卡片」和空窗口选择器共用同一份 7 个基础种类（不依赖其它插件），底部再加一个「填空窗格」占位；旧卡仍渲染，但不再占菜单。

## 保留（7 种）

| 种类 | id | 说明 |
|---|---|---|
| 会话 | `session` | 整页嵌入一场对话；一份会话只跑一个活客户端 |
| 文件 | `files` | 目录、文件标签、内嵌预览；Office 交给宿主文件面板 |
| 浏览器 | `browser` | 多标签 + 地址栏（原「网页」合并到这里） |
| 笔记 | `note` | Markdown |
| 终端 | `terminal` | 单条命令、历史、cwd |
| Git | `git` | 仓库发现、状态、暂存/提交 |
| 设置 | `settings` | 明暗、配色、尺寸 |
| 填空窗格 | `empty` | 先摆空盒子，再选内容；默认新画布就是这一张 |

## 从添加菜单移除（旧卡仍渲染）

| 旧入口 | 去向 |
|---|---|
| `web` | 合并进 `browser`；旧 web 卡照常显示 |
| `dash:/anatomy`、`dash:/anatomy/data.json`、`dash:/taskmonitor/data` | 插件调试预设，不再占添加菜单；旧卡照常显示 |
| `api` | 插件 RPC 调试，开发者用；旧卡照常显示 |
| `ctx:sessions`、`ctx:cal`、`ctx:skills`、`ctx:steps`、`ctx:events`、`ctx:files`、`ctx:commands`、`ctx:tokens`、`ctx:timing`、`ctx:turns` | 收进 `ctx:dash` 一张卡，卡内切标签 |
| `std:table`、`std:list`、`std:progress` | 收进 `std:metrics` 数据卡，卡内切换 |

## 为什么文件卡和面板卡不算重复

- `files` 是文件工作流：目录、标签、预览、宿主动作，适合日常打开文件。
- `panel` 是「把宿主右栏原样搬进卡片」的通用壳，文件面板只是它的一种；添加菜单不直接列 `panel`，由文件卡的「在宿主文件面板打开」按需创建。

## 兼容

`contentFor()` / `normalizeLeaf()` 仍支持所有旧 id；这次只改**添加菜单**，不改旧布局的渲染。
