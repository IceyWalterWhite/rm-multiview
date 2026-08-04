# 官方「人气助威」与「观看时长弹丸（已废弃）」集成设计

日期：2026-08-02  
分支：`feat/cheer-watchtask`  
状态：人气助威与投票桥接仍启用；观看时长／弹丸 UI、心跳调度和旧的全量假直播演示自 2026-08-02 起暂停，保留必要参考代码与测试等待重设计

## 目标与边界

网站负责 UI 与官方比赛开关；旧的观看方案还曾使用主播放器状态。`public/rmlive-companion.user.js` 在用户浏览器中用 `GM.xmlHttpRequest` 调用 RoboMaster 登录写接口。Cookie 不经过本站服务器，不读取、不存储、不打印，也不提供挂机、绕过投票开关或批量写入能力。

> **废弃说明（2026-08-02）：** 当前产品只保留人气票数条与官方投票链路。观看时长／弹丸胶囊、主播放器状态上报、`heartbeat` 调度，以及 `?demo=live|offline|loading|error` 的全量假直播界面均不再挂载；`getWatchProgress` 仅作为投票所需的官方登录探测。`?demo` 现在只离线预览人气条。下文的心跳规则保留为历史设计说明，供新的交互设计复用。

首版只支持 Tampermonkey 5.2+。生产脚本只匹配 `https://rmlive.cn/*` 与 `https://www.rmlive.cn/*`，不匹配 localhost，不在 iframe 运行。

## 官方接口事实

Base：`https://saas.robomaster.com`。

| 动作 | 官方路径 | JSON Body | 登录 |
| --- | --- | --- | --- |
| 读票数 | `/registration/cheer/info` | `{matchId, redTeamId, blueTeamId}` | 否 |
| 投票 | `/registration/cheer/vote` | `{matchId, teamId, count}` | 是 |
| 读进度 | `/registration/getWatchProgress` | `{}` | 是 |
| 观看心跳 | `/registration/watchHeartbeat` | `{zoneId}` | 是 |

写接口只接受 `application/json`；`saas.robomaster.com` 的 CORS 预检仅向官方网页来源放行，因此普通 `rmlive.cn` JavaScript 不能直接调用。免登录票数由固定上游的同源 Edge Function 读取；登录写操作不能经本站代理，因为浏览器不会把 `.robomaster.com` Cookie 发给本站服务器。

Tampermonkey 后台请求不受页面 CORS 限制。5.2+ 的 `cookiePartition.topLevelSite = "https://www.robomaster.com"` 让请求使用 RoboMaster 第一方 Cookie 分区，同时 Cookie 内容对页面和本站服务端保持不可见。

## 最小权限 userscript

元数据只申请：

```text
@match   https://rmlive.cn/*
@match   https://www.rmlive.cn/*
@grant   GM.xmlHttpRequest
@connect saas.robomaster.com
@noframes
```

页面不能传 URL。脚本只接受三个固定动作：

```ts
getWatchProgress({})
vote({ matchId, teamId, count })
heartbeat({ zoneId })
```

其中 `heartbeat` 是保留的固定协议动作，当前页面不会发起它。

ID 必须是 1–12 位数字，`count` 必须是 1–100 整数。心跳最短间隔 4.5 秒；投票按 `matchId:teamId` 独立限速，使红蓝双方可在同一 5 秒窗口分别提交。请求固定 JSON、10 秒超时和 RoboMaster Cookie 分区。脚本只返回各动作需要的 `code/message/data` 白名单字段，响应中的 token、header、Cookie 或未知内部字段不会越过页面桥。

## 页面桥协议

`src/net/officialBridge.ts` 使用 `window.postMessage`，协议标识为 `rmlive:official:v1`、版本 `1`，消息含方向与随机请求 ID。双方同时检查：

- `event.source === window`
- `event.origin === window.location.origin`
- channel、version、direction、action 与 payload
- 响应 ID 是否仍在 8 秒有效等待表中

未知、重复、过期或伪造响应会被忽略。页面状态为 `probing | missing | ready | error`。探测不到脚本时，人气票数仍可只读展示；安装入口见 README 的 userscript 安装步骤。

## 人气投票

票数展示仍由 `/api/cheer` 读取。投票按钮只在以下条件全部为真时出现：

```text
bridge ready
已通过 getWatchProgress 确认登录
liveState === 1
matchState === 1
openVote === 1
cheer/info.voteEnabled === true
存在 currentMatch
```

点击后立即乐观加票；红蓝各自按 5 秒窗口聚合，再调用固定的官方 `cheer/vote`。单批最多 100。成功采用官方返回总票数；若返回不含总数则主动回读。登录、资料、网络或业务失败时移除乐观增量、回读公开真实票数，并展示经过裁剪的错误信息。门槛在等待窗口内关闭时不会提交。

## 观看心跳（已废弃，保留实现）

当前 `App` 明确传入 `heartbeatEnabled: false`，且主播放器不再向观看任务上报状态，因此不会调用 `watchHeartbeat`。以下规则是已完成、仍受测试保护的历史设计，不构成当前产品行为。

主 `<video>` 的 `play / pause / ended` 事件逐层上报给 `useWatchTask`。只有以下条件全部为真才进入心跳会话：

```text
bridge ready 且 getWatchProgress 成功
liveState === 1
matchState === 1
zoneId 有效
主播放器处于 playing
document.visibilityState === "visible"
奖励档位尚未全部完成
```

进入或恢复会话时先重读进度，再每 5 秒发送一次 `watchHeartbeat`。切后台、暂停、结束、组件卸载或官方状态关闭会清除定时器。心跳报告发奖后重读完整档位。连续三次失败只停止观看计时并显示手动重试，不调用 `location.reload()`，避免重载 11 路播放器。

旧设计在脚本缺失时仍尝试原有的 `getWatchProgress` 只读路径；若能读取则展示官网已有进度，但明确说明本站不能累计。当前页面不展示这块 UI。

## 测试与验收纪律

自动化覆盖：桥握手、请求关联、超时与伪造消息拒绝；userscript 固定域名、Cookie 分区、JSON、参数校验、限速和响应裁剪；投票严格门槛、双边聚合、乐观反馈和失败回读；以及已废弃观看心跳的播放/前台/比赛门槛、恢复补取、发奖刷新、三连败停止与重试。另有回归测试保证 `heartbeatEnabled: false` 时登录探测不会发出心跳。

本地与 CI 一律 mock `GM.xmlHttpRequest`，不得向官方 `vote` 或 `watchHeartbeat` 真实写入。当前真实验收仅在生产部署后的正式直播期间，用已登录账号提交 1 票，记录裁剪后的业务响应后立即停止；观看心跳的真实验收随新交互设计一并恢复。不得批量写入，也不得在 `openVote` 关闭时探测写接口。
