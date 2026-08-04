# rm-multiview · RoboMaster 多视角直播间

RoboMaster 赛事多视角直播间：同时播 **11 路**官方真实直播流（主视角 + 红蓝各 5 机位），复刻其 **LeanCloud 弹幕**，支持人气助威和官方观看时长／弹丸同步；第二屏内嵌社区工具站。站点没有账号系统，也不接收 RoboMaster Cookie；公开票数由无凭证 Edge Function 读取，登录写操作仅由用户本机的直播助手发起。

体验地址1: http://8.134.153.137

体验地址2: https://rm-multiview.vercel.app/

体验地址3（主站）: https://www.rmlive.cn （301 归一到 https://rmlive.cn）

![](image.png)

> ⚠️ 赛事是赛季性的：仅在**有直播时段**（`live_game_info.json` 存在 `liveState===1` 的赛区）能正常加载，否则第一屏显示「当前没有直播」（第二屏社区工具照常可用）。开发/测试靠 `src/fixtures/` 离线进行。

## 运行

```bash
npm install
npm run dev      # http://localhost:5173 —— 自动连接当前直播赛区
npm run test     # 全量单测（Vitest）
npm run build    # 生产构建（tsc -b && vite build → dist/）
npm run lint     # ESLint
```

打开后：主视角右上「🔇」解锁解说音；点机位原地放大、再点缩回或按 Esc（红蓝可各放大一个）；控制栏右侧「下滑查看社区工具👇」或直接下滚到第二屏，填好身份即可发弹幕。窗口太窄时第一屏会提示「请在大屏幕上观看」，第二屏会改为上下堆叠。

`?demo` 目前只预览人气助威条，不会加载假机位、假弹幕、状态切换或观看时长 UI。旧的全量假直播演示已废弃，正式页面其余布局以 `main` 为基线。

## 官方人气投票与观看时长

官方投票写接口只接受 JSON，并仅向 `robomaster.com` 网页放行 CORS。本站通过一个可选的 Tampermonkey 直播助手在**用户本机浏览器**中调用官方投票接口；RoboMaster 登录 Cookie 由浏览器和 Tampermonkey 管理，不会进入本站服务器、日志或本地存储。

观看时长／弹丸均以官方返回值为准。只有直播助手已就绪、官方已登录、正式直播和比赛进行中、主视角正在播放、页面保持前台且奖励未全部完成时，页面才会每 5 秒发送一次官方观看心跳；暂停、切后台、比赛结束或奖励领完会立即停止。

安装方式：

1. 安装 Tampermonkey 5.2 或更新版本，并在 RoboMaster 官网完成登录。
2. 打开 [`https://rmlive.cn/rmlive-companion.user.js`](https://rmlive.cn/rmlive-companion.user.js)，确认安装。
3. 刷新 `https://rmlive.cn`。控制栏会显示直播助手安装/登录/观看进度入口；在正式直播且官方开票时，已登录并检测到脚本后，人气票数条会出现「助威」按钮。

直播助手的权限刻意收窄：

- 只匹配 `https://rmlive.cn/*` 与 `https://www.rmlive.cn/*`，不在 iframe 或 localhost 运行。
- 只申请 `GM.xmlHttpRequest`，`@connect` 只允许 `saas.robomaster.com`；不申请 `GM_cookie`。
- 页面协议只允许 `getWatchProgress`、`vote`、`heartbeat` 三个固定动作，不能传入目标 URL。
- 投票严格服从官方 `liveState`、`matchState`、`openVote` 与 `voteEnabled` 开关；观看心跳同样严格服从直播、比赛、主视角播放、前台和奖励状态门槛。

本地开发不会匹配生产 userscript；相关测试全部 mock `GM.xmlHttpRequest`，不会写入官方系统。

## 技术栈与架构

React 19 + Vite + TypeScript；Vitest + Testing Library；hls.js；leancloud-realtime：

- **视频**：`hls.js × 11` 跨域直拉 `rtmp.djicdn.com`。流目录 + 当前直播赛区 + 三档清晰度签名源，全来自 `rm-static.djicdn.com/.../live_game_info.json`（取 `liveState===1` 赛区，按 `role` 过滤掉合集/无解说）。每次进入实时 fetch → 签名新鲜；签名过期(403) → 重取换源。
- **弹幕**：`leancloud-realtime` 匿名连接，用赛区 `chatRoomId` 入瞬态聊天室，收发 `TextMessage`；入会回填历史，断线重连后重入会。
- **身份**：`localStorage` 持久化，自填（UI 提示「文明发言」）。
- **人气值**：无登录的 `/registration/cheer/info` 由 `/api/cheer` 同源只读代理转发；投票写入只通过本地直播助手完成。
- **观看任务**：控制栏显示安装、登录与官方累计时长／弹丸；写入只通过本机直播助手，在严格播放门槛下每 5 秒同步一次官方心跳。
- **演示页（已收窄）**：`?demo` 只提供人气助威条的离线视觉预览；原先的假直播、假机位、假弹幕与状态切换代码均不再挂载，等待重设计。

```
src/
  config.ts                # LeanCloud 公钥、URL、清晰度、颜色、过滤词
  types.ts
  data/    danmaku|catalog|streams.ts   # 纯函数：弹幕模型/颜色/标签、目录解析、选源、签名分类
  hooks/   useProfile|useDanmaku|useCatalog|useHlsPlayer|useCheer|useWatchTask.ts
  net/     leancloud.ts     # 连接(单例缓存)/收发/历史/重连
           officialBridge.ts # 页面与直播助手的版本化 postMessage 协议
  singleFlight.ts           # 并发去重（N 路同时 403 只重取一次）
  a11y.ts                   # prefers-reduced-motion 探测（smooth 滚动等运动降级）
  components/               # LiveStage/SideColumn/ViewTile/MainStage/DanmakuOverlay/
                            #   ChatRoom/MessageItem/DanmakuComposer/ReservedPanel(内嵌Tab)/…
  fixtures/                 # 真实抓包样本，供离线单测
recon/                      # 逆向抓包脚本与产物（Playwright + 被动监听探针）
public/rmlive-companion.user.js # Tampermonkey 5.2+ 直播助手
functions/api/cheer.js      # 无凭证、固定上游的票数只读代理
docs/                       # 设计文档(specs) / 实现计划(plans) / 会话纪要
```
