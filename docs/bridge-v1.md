# 对接协议 v1（窗口之间传数据）

自由画布里的窗口不是一块块孤立的画，中间的线是可以走数据的。协议只有一条消息、四个字段，任何一侧都能实现，不依赖框架内部类名。

## 一句话

源窗口发 `postMessage`，目标窗口（同一 origin 下的副本）收到后转成一个 `CustomEvent` 并留一份存档；面板想用就监听它。

## 消息

```js
{
  fp: 'bridge',      // 固定标记，用来区分别人的消息
  v: 1,              // 协议版本
  channel: 'session',// 语义通道，见下表
  payload: { ... }   // 该通道自己的数据
}
```

| channel | 谁发 | payload 关键字段 | 目标窗口拿它做什么 |
|---|---|---|---|
| `session` | 会话窗 | `sessionId`、`title` | 面板切到同一个会话，读它的上下文/统计 |
| `selection` | 会话窗 | `text`、`messageId` | 把选中的一段话交给笔记、抓取窗 |
| `file` | 文件窗 | `path` | 编辑器/预览打开这个文件 |
| `usage` | 用量窗 | `day`、`cost` | 只做展示，不反向驱动 |

## 目标窗口这一侧（副本里）

副本的注入脚本已经内置了接收端：

```js
window.addEventListener('message', (ev) => {
  const d = ev && ev.data
  if (!d || d.fp !== 'bridge') return
  sessionStorage.setItem('fp.bridge.last', JSON.stringify(d))
  window.dispatchEvent(new CustomEvent('fp:bridge', { detail: d }))
})
```

所以任何跑在副本里的代码（面板自己的脚本、将来加的小工具）只要：

```js
window.addEventListener('fp:bridge', (ev) => {
  const { channel, payload } = ev.detail
  if (channel === 'session') { /* 切到 payload.sessionId */ }
})

// 或者随时读最后一次
const last = JSON.parse(sessionStorage.getItem('fp.bridge.last') || 'null')
```

## 源窗口这一侧（画布）

会话窗标题栏上的 `⇄` 就是发送按钮：点一下把「这个窗口绑的会话」推给画布上所有面板/浏览器窗。

```js
// 画布内部
bridgeTo(leafId, 'session', { sessionId, title })
```

它会把消息 `postMessage` 进每个目标窗口的 iframe，并在 `%TEMP%\dsh-free-pane-trace.log` 里留下一条 `bridge-out`；目标侧留下 `bridge-in`。

## 边界（先说清楚，免得指望过头）

- **只对同一 origin 的副本有效**。外部网站是跨源的，`postMessage` 发得过去，但它那边没有我们的接收端。
- **只做数据搬运，不做能力授予**。目标窗口能拿到的是「告诉它什么」，不是「替它点按钮」；要驱动界面，得目标侧自己实现一份监听。
- **协议是给插件作者用的**：第三方插件想被对接，只要在自己的副本里加同样三行接收端，并在 `channel` 表里登记语义即可。

## 下一步

1. 面板窗创建时自动绑定「左边最近的那个会话窗」，无需手点 `⇄`。
2. 反向通道 `channel: 'panel'`：面板把「用户在这个面板里点了什么」回传给会话窗。
3. 把 `⇄` 变成窗口之间的可见连线，悬停显示当前通道与最后一次载荷摘要。
