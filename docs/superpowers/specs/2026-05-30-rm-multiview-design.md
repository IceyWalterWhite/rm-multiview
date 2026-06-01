# RoboMaster 多视角直播间 · 设计文档

- 日期：2026-05-30
- 状态：待评审
- 目标读者：实现者（后续由 writing-plans 生成实现计划）
- 来源：对 `https://www.robomaster.com/live` 的实测逆向 + 与用户的设计对话

---

## 1. 概述

重做一个 RoboMaster 赛事多视角直播间：消费 RM 官方的真实直播流与真实弹幕，在自定义的「红蓝对抗三列」界面中同时呈现多路机位视角，并复刻其带「十周年徽章 / 学校 / 身份 / 正文」的弹幕，支持匿名自填身份发送弹幕。

### 1.1 目标（In Scope）
- 同时播放 **11 路**视角：主视角（有解说）+ 红方 5 机位 + 蓝方 5 机位。
- 两档统一清晰度控制：主视角、多视角各一档（按带宽自调，默认主 1080p / 多视角 540p）。
- 主视角上叠加**飞屏弹幕**（原站样式：徽章/身份/学校/昵称/正文，红金两色）。
- 第二屏**聊天室**（弹幕列表）+ **发送**（匿名、自填身份、本地持久化）。
- 视觉沿用 RM 黑色电竞调 + 弹幕结构，多视角布局重新设计。

### 1.2 非目标（Out of Scope）
- 不接入 RM 账号登录/鉴权（发送走匿名自填身份）。
- 不复刻原站的赛程/积分/对阵/赞助商等模块（仅直播 + 弹幕）。
- 不做主视角无解说版、红/蓝机位合集这 3 路（用户明确舍弃）。
- 不做录制/回放/下载。

### 1.3 合规与伦理说明
- RM 直播为公开赛事广播；本项目为个人/学习用途的自定义观看工具。
- 视频经实测 CDN 开放跨域（`Access-Control-Allow-Origin: *`），可直接播放。
- 弹幕走 LeanCloud 实时通信，使用其**客户端公开密钥**（appId/appKey，设计上即嵌入网页客户端，区别于绝不可外泄的 masterKey）。
- 发送弹幕为用户显式触发的行为；身份字段为自填，需在 UI 提示「自填身份、文明发言」。

---

## 2. 网站解析结论（逆向参考）

### 2.1 视频推流
- 协议：**HLS**（`.m3u8` + `.ts` 分片），走大疆 CDN `rtmp.djicdn.com/robomaster/<流名>.m3u8`，底层阿里云。
- 主视角流名：`fight2026-output`。直播 playlist（`#EXT-X-MEDIA-SEQUENCE` 递增、2s 分片、无 `#EXT-X-ENDLIST`）。
- 鉴权：URL 带 `auth_key=<时间戳>-<rand>-<uid>-<md5>`（阿里云 A 型）。**playlist 的 auth_key 长期稳定**；每个 `.ts` 分片各自带签名，**由源站生成 playlist 时写入**——客户端只需一个签名好的 m3u8 URL，分片签名不用自己算。
- **CORS：实测 `Access-Control-Allow-Origin: *`、`Timing-Allow-Origin: *`** → 任意 origin 可跨域播放，无需代理。
- 播放器：原站用 video.js + videojs-contrib-hls + videojs-resolution-switcher（说明流含多档清晰度）。本项目改用 **hls.js**。
- 视角清单（14 路）与取舍：

  | 视角 | 取舍 |
  |---|---|
  | 主视角（有解说） | ✅ 保留 |
  | 主视角（无解说版） | ❌ 舍弃 |
  | 红方 英雄/工程/3号步兵/4号步兵/无人机 第一视角 | ✅ 保留（5） |
  | 红方 机器人第一视角合集 | ❌ 舍弃 |
  | 蓝方 英雄/工程/3号步兵/4号步兵/无人机 第一视角 | ✅ 保留（5） |
  | 蓝方 机器人第一视角合集 | ❌ 舍弃 |

  → 保留 11 路，舍弃 3 路。

#### 2.1.1 流目录与清晰度（实测，来源 `live_game_info.json`）
- `eventData[]` = **赛区数组**，每个赛区含：`zoneName / zoneDate / liveState / matchState / chatRoomId / zoneLiveString / fpvData[]`。
- **主视角**：`zoneLiveString[]` 给 3 档源 → `fight2026-output`(1080p) / `fight2026-output_ud`(720p) / `fight2026-output_hd`(540p)。
- **机位**：`fpvData[]` 每项 `{ role(视角名), headimg, sources:[{label,res,src}×3] }`。
- **清晰度 = 独立 URL（非 master-variant）**：`1080p=<base>.m3u8`、`720p=<base>_ud.m3u8`、`540p=<base>_hd.m3u8`。每个 m3u8 是单档媒体列表（直接 `#EXTINF` 分片）。
- **取舍按 `role` 过滤**：role 含「合集」或「无解说」→ 丢弃；其余保留。某直播赛区 13 路 fpv → 保留 10（红5+蓝5）+ 主视角 = 11 路。
- **映射按 `role`，不按流号**（顺序不规则：合集=`fight2026011/012`、主视角无解说版=`fight2026013`）。
- **签名**：signed m3u8 URL（含 `auth_key`，长效）直接嵌在该 JSON → **每次进入 fetch 一遍即得新鲜签名**，无需动态签名接口。
- **CORS**：`rm-static.djicdn.com` 实测 `Access-Control-Allow-Origin: *`（配置 JSON 可跨域 fetch）。
- 干净映射快照见 `recon/out/catalog.json`（fixture）。

### 2.2 弹幕通道（LeanCloud IM）
- WS 服务器：`wss://uqaoagyd.im.cn-n1.lncldapi.com/`（LeanCloud IM，cn-n1 节点）。
- 发现流程：`router-g0-push.leancloud.cn/v1/route`（push router 发现 WS）→ WebSocket。
- **一个赛区 = 一个 LeanCloud 瞬态会话（`transient/tr:true` 聊天室）**。例：「北部赛区」`objectId=69ff0439fa62cf0ebe01d583`。`chatroom.json` 另有一组房间 ID 池。
- 消息为 leancloud-realtime 的 **`TextMessage`**（`_lctype:-1`），自定义属性挂在 `_lcattrs`：

  ```jsonc
  {
    "_lctext": "东大秦皇岛加油",          // 弹幕正文 → message.text
    "_lcattrs": {                         // → message.getAttributes()
      "username":   "2-队员-南京航空航天大学-NUAA636", // 复合串: racingAge-position-school-nickname
      "nickname":   "NUAA636",
      "schoolName": "南京航空航天大学",
      "position":   "队员",               // 队员 / 老队员 / 校友
      "racingAge":  2,                    // 参赛年限（整数；0/空表示无）
      "badge":      "electronicTenth",    // 十周年徽章；"" 表示无
      "userId":     143020,
      "sendTime":   1780045966028
    },
    "_lctype": -1
  }
  ```
- 入会时会一次性下发**历史消息批量**（用于初始填充列表）。

### 2.3 弹幕渲染规则（实测反推）
- **DOM 结构**（原站，Vue scoped）：`.danmu-item > .item-chat > .chatContent.chatContent--{common|spcial}`，内含 `.chatContent__onlyBadge--electronicTenth`（徽章）、`.chatContent__nameBox--tag`（身份标签）、`.chatContent__nameBox--schoolName`（学校）、`.chatContent__nameBox--nickName`（昵称）、`.chatContent__text`（正文）。
- **身份标签文案**：`tag = racingAge ? ` + "`${racingAge}年${position}`" + ` : position`
  - 即 racingAge≥1 显示「N年{身份}」；racingAge=0/空 只显示「{身份}」。
  - 飞屏弹幕同逻辑：`(position && !racingAge)` 走「只显示身份」分支。
  - 边界：「裸老队员」格式上可能（老队员 racingAge=0），实测样本未出现；「校友」常为裸形式。
- **颜色规则**（由 `position` 决定，与徽章无关）：
  - `position === '老队员'` → **金色 `#FFE180`**（`chatContent--spcial`，注意原站把 special 拼成 spcial）
  - `position === '队员' | '校友'`（其余）→ **三文鱼红 `#F5B599`**（`chatContent--common`）
  - 实现以映射函数表达，预留默认兜底以兼容未来可能的其他身份（官方/解说等本轮未采到）。
- **徽章**：`badge==='electronicTenth'` 显示十周年徽标；`''`/缺失不显示。

### 2.4 发送可行性（已实测✅）
- 以**匿名客户端**（随机数字 clientId、**无 signature**）`createIMClient` 成功；`getConversation(convId)` → `join()` → `send(TextMessage)` 成功，服务器返回 messageId。
- 结论：**无需 RM 登录、无需服务端签名**即可发送，身份字段为自填 payload。

### 2.5 LeanCloud 配置（客户端公开密钥）
```
APPID:       UqaoAgYDPakCHxtDiMXVy2Sw-gzGzoHsz
APPKEY:      xYO2wtjhri9dJR7Vor8kDFl4
SERVERURLs:  https://leancloud.robomaster.com   (REGION: cn)
SDK:         leancloud-realtime 5.0.0-rc.8 (TextMessage 为核心类，无需额外插件)
```
> 这些值放入项目 env/config（如 `.env` / `src/config.ts`），不写死在多处。

---

## 3. 总体架构

**纯前端 SPA：React 18 + Vite + TypeScript。无后端。**

```
┌────────────────────────── 浏览器 ──────────────────────────┐
│  React SPA                                                  │
│   视频:  hls.js × 11  ──跨域(ACAO:*)──▶ rtmp.djicdn.com (HLS) │
│   弹幕:  leancloud-realtime ──WSS──▶ *.lncldapi.com (IM)      │
│          身份: localStorage                                  │
└─────────────────────────────────────────────────────────────┘
```
- **确认完全不需要后端/代理**：配置（`rm-static` 的 `live_game_info.json`）、视频（`rtmp.djicdn.com`）、弹幕 WS（LeanCloud）三处均实测 `ACAO:*` / 开放；发送匿名可行。

### 3.1 目录结构（建议）
```
src/
  config.ts                 # appId/appKey/server/会话、流目录、清晰度默认值
  streams/
    catalog.ts              # 11 路视角定义 + 取签名 m3u8 的逻辑
    useHlsPlayer.ts         # 单个 video 的 hls.js 生命周期 hook
  danmaku/
    leancloud.ts            # Realtime 连接、入会、收/发
    useDanmaku.ts           # 订阅 → 消息流；send()
    model.ts                # _lcattrs → Danmaku 模型；颜色/标签规则
  profile/
    useProfile.ts           # 身份 localStorage 持久化
  components/
    LiveStage.tsx           # 第一屏容器（三列）
    SideColumn.tsx          # 红/蓝列（5 个 ViewTile）
    ViewTile.tsx            # 单个机位（含放大 toggle）
    MainStage.tsx           # 主视角 + DanmakuOverlay
    VideoPlayer.tsx         # 包装 useHlsPlayer
    DanmakuOverlay.tsx      # 主视角飞屏弹幕
    QualityControls.tsx     # 主/多视角清晰度
    DanmakuComposer.tsx     # 身份chip + 输入 + 发送（第一屏快捷条 & 第二屏共用）
    ChatSection.tsx         # 第二屏容器
    ChatRoom.tsx            # 聊天室列表（靠右长条）
    MessageItem.tsx         # 单条弹幕（颜色/标签/徽章/学校/昵称/正文）
    ReservedPanel.tsx       # 第二屏左侧预留
  fixtures/                 # 离线开发用真实样本（弹幕 JSON、m3u8 样本）
  App.tsx
```

---

## 4. 视频模块

- 每路视角一个 `<video>` + `hls.js` 实例（`useHlsPlayer(ref, src, level)`）。
- **streamCatalog**：app 启动时 fetch `live_game_info.json` → 取 `liveState===1` 的赛区 → 由 `zoneLiveString`(主视角) + `fpvData[]`(按 `role` 过滤掉合集/无解说) 组装 11 路视角；每路含 3 档 `{label, src}`。**每次进入实时获取 → 签名新鲜**（不缓存、不硬编码）。
- **清晰度**：两个全局控制——主视角档位、多视角统一档位（默认 1080p / 540p）。
  - 实测为**每档独立 URL**（`<base>` / `<base>_ud` / `<base>_hd`）→ 切清晰度 = **切换 video 的 source URL**（非 hls level）。
  - 接口层用统一的 `setQuality(group, label)`：主视角组 / 多视角组分别套用，多视角组统一应用到 10 路。
- **性能策略**（11 路同时播）：
  - 侧路默认 540p；hls.js 配置小缓冲（`backBufferLength`、`maxBufferLength` 收紧）降低内存/解码压力。
  - `Page Visibility API`：标签页隐藏时暂停全部。
  - 放大某路时其余继续播放（不销毁）。
  - 不做自动降档/减路数的「性能模式」，也不做滚动到第二屏时暂停第一屏——保持 11 路持续播放，由用户用清晰度档位自行控制负载。

---

## 5. 弹幕模块

### 5.1 连接与订阅
- `new Realtime({appId, appKey, server})` → `createIMClient(随机数字clientId)`（匿名）。
- **自动选择当前直播赛区会话**并 `join()`（瞬态聊天室）：从 `live_game_info.json` 取 `liveState===1` 的赛区，**直接用其 `chatRoomId` 作为 LeanCloud 会话 objectId** 并 join（无需按名匹配）。同一赛区对象同时提供该赛区的视频源（`zoneLiveString`/`fpvData`），保证视频与弹幕同赛区。可选「手动切换赛区」作为覆盖（切到其他 `eventData` 赛区）。
- 监听 `Event.MESSAGE` → 解析 → 推入弹幕流（同时供飞屏 overlay 与聊天室列表消费）。
- 入会后用历史批量填充列表初始内容。
- 断线重连：SDK 自带；重连后重新 `join`；UI 顶部显示连接状态。

### 5.2 模型与规则（`danmaku/model.ts`）
```ts
interface Danmaku {
  id: string; text: string;
  nickname: string; schoolName: string;
  position: string;            // 队员 | 老队员 | 校友
  racingAge: number;           // 0 表示无
  badge: string;               // 'electronicTenth' | ''
  sendTime: number; userId: number;
}
// 标签：racingAge>0 ? `${racingAge}年${position}` : position
function identityTag(d: Danmaku): string {
  return d.racingAge ? `${d.racingAge}年${d.position}` : d.position;
}
// 颜色：老队员金，其余红（与徽章无关）
const COLOR_VETERAN = '#FFE180';
const COLOR_COMMON  = '#F5B599';
function danmakuColor(d: Danmaku): string {
  return d.position === '老队员' ? COLOR_VETERAN : COLOR_COMMON;
}
```
- 从 LeanCloud 消息映射：`text=message.text`，其余取 `message.getAttributes()`；`racingAge` 做 `Number(...)||0` 归一。

### 5.3 发送（`DanmakuComposer`）
- 身份来自 `useProfile()`（localStorage）：`{nickname, schoolName, position, racingAge, badge}`，首次发送前引导填写，随时可改。
- 构造：`new TextMessage(text).setAttributes({ username:`${racingAge}-${position}-${schoolName}-${nickname}`, nickname, schoolName, position, racingAge, badge, sendTime:Date.now(), userId:0 })` → `conversation.send()`。
- 瞬态会话默认不回推自己的消息 → 发送后**本地乐观插入**自己的弹幕（列表 + 飞屏）。
- 两个入口（第一屏快捷条 + 第二屏聊天室）共用同一 composer 逻辑与身份。

### 5.4 飞屏弹幕（`DanmakuOverlay`，主视角）
- 横向飘过（右→左），多轨道（多行），避免重叠；每条内联渲染 徽章/身份标签/学校/昵称/正文，按 §5.2 着色。
- 限制屏上并发条数与轨道数（性能 + 可读性）；可选密度/开关。

---

## 6. 页面与组件结构（布局 v3，已确认）

**单页纵向两屏。**

### 第一屏（100vh）· 多视角直播台
```
┌────────┬─────────────────────────┬────────┐
│ 红·英雄 │                         │ 蓝·英雄 │
│ 红·工程 │      主视角（大屏）       │ 蓝·工程 │
│ 红·3步 │   [飞屏弹幕滚动其上]      │ 蓝·3步 │
│ 红·4步 │                         │ 蓝·4步 │
│ 红·无人│                         │ 蓝·无人│
└────────┴─────────────────────────┴────────┘
[主视角 1080p▾] [多视角统一 540p▾] [身份✎ | 弹幕输入… | 发送]  点机位放大/缩回
```
- 左列红方 5 机位，中主视角，右列蓝方 5 机位，全部同时播。
- 控制栏：主清晰度、多视角统一清晰度、**弹幕发送条（身份chip + 输入 + 发送）**。
- 机位无 ⤢ 图标；点击机位**原地放大**（scale 放大 + 抬高 z-index 盖住邻居，不挤动布局），再点缩回。
- 机位/主视角同处一个区域、等高齐平；侧列宽由框高推导、主视角吃剩余宽度。
- **窄屏兜底（实装）**：当主视角宽 < 单个侧列宽（窗口太窄看不清）→ 盖 **「请在大屏幕上观看」** 遮罩遮住所有视角（不压缩机位、`overflow:hidden` 兜底不外穿）。

### 第二屏（下滚）· 内嵌工具站 + 聊天室
```
┌─────────────────────────┬────────────┐
│ [赛程▾|天梯榜] ↗打开      │  聊天室长条 │
│  内嵌站点 iframe          │  弹幕列表   │
│  (Tab 切换，常驻不重载)    │  + 发送框   │
└─────────────────────────┴────────────┘
```
- 左侧 Tab 内嵌两个社区站（`赛程`=schedule.scutbot.cn / `天梯榜`=micdz RM_LADDER），两 iframe 常驻、`display` 切换；标签旁「↗ 打开」新标签页打开当前站。右侧聊天室长条（弹幕列表 + composer）。
- **窄屏（实装，≤718px：聊天室 340px 比嵌入页还宽）**：改上下堆叠（嵌入页在上、聊天室在下），各满宽、平分页高。

---

## 7. 关键交互

| 交互 | 行为 |
|---|---|
| 主视角清晰度 | 选择档位 → 仅改主视角 hls level/源 |
| 多视角清晰度 | 选择档位 → **统一**应用到 10 路侧视角 |
| 点击机位 | 原地放大（toggle），再点缩回；**红、蓝各可同时放大一个**（实装改为双状态，spec 原「仅一路」已弃） |
| 飞屏弹幕 | 实时消息横向飘过主视角，按身份着色 |
| 发送弹幕 | 填/取身份 → 构造 TextMessage → 发送 → 本地乐观插入 |
| 滚动 | 第一屏播放台 ↕ 第二屏（内嵌站 + 聊天室） |
| 切换内嵌站 | 第二屏左侧 Tab：赛程 ↔ 天梯榜（iframe 常驻、不重载）；「↗ 打开」新标签打开当前站 |
| 窗口过窄·第一屏 | 主视角宽 < 侧列宽 → 盖「请在大屏幕上观看」遮罩 |
| 窗口过窄·第二屏 | ≤718px（聊天室比嵌入页宽）→ 嵌入站/聊天室改上下堆叠满页 |

---

## 8. 状态管理与数据流

- 轻量状态：**默认 React Context + hooks**（零额外依赖）；若后续状态明显变复杂再升级到 zustand。
- 数据流：
  - `useDanmaku()` 持有连接与消息流（环形缓冲，列表上限如 300 条，与原站一致），向 `DanmakuOverlay` 与 `ChatRoom` 广播。
  - `useStreamCatalog()` 提供视角与源；`QualityControls` 改 group 档位 → 各 `useHlsPlayer` 响应。
  - `useProfile()` 单一身份源，供两个 composer 入口。

---

## 9. 已解析（原待确认项，均已实测落实）

1. ✅ **视角→流名映射 & 签名来源**：全部来自 `live_game_info.json`（§2.1.1）。主视角=`zoneLiveString`、机位=`fpvData[].role+sources`；**按 role 映射**；签名 URL 内嵌、每次进入 fetch 即新鲜。`rm-static` 与 `rtmp` 均 `ACAO:*`。
2. ✅ **清晰度形式**：每档独立 URL（`<base>`/`_ud`/`_hd` = 1080/720/540），切清晰度=换 source（§4）。
3. ✅ **自动赛区选择**：取 `liveState===1` 的赛区，用其 `chatRoomId`(弹幕会话) + `zoneLiveString`/`fpvData`(视频)（§5.1）。

剩余仅为**运维注意**（非技术未知）：
- 发送已实测成功；客户端密钥/会话/流签名随赛季变动 → 集中放 `config` + 启动时拉 `live_game_info.json`，便于自适应。
- 跨赛季时 `liveState` 字段语义以实测为准（当前：`1`=直播中，`0`=非直播）。

---

## 10. 错误处理与降级

- 单路流失败（签名过期 403/断网）：该 tile 显示重试占位，自动重取签名 URL；hls.js 网络错误 `startLoad` 重试、媒体错误 `recoverMediaError`。
- WS 断线：SDK 自动重连 + 顶部状态提示 + 重连后重入会。
- 发送失败：捕获 LeanCloud 错误码（如权限/限频）→ Toast 提示，不静默吞掉。
- 低端设备/卡顿：提示用户手动调低多视角清晰度档位（不自动降档/减路数）。
- stream catalog 接口 CORS 受限：薄代理兜底。

---

## 11. 测试策略

> 赛事是**赛季性**的（非常态直播）。开发/测试必须能离线进行。

- **Fixtures**：保存真实样本——弹幕消息 JSON（已抓，见 `recon/out/ws_frames.json`）、一个 m3u8/分片样本、各身份/颜色/标签的样例。
- **单元**：`model.ts`（attrs→Danmaku、`identityTag`、`danmakuColor`）、profile 持久化、清晰度映射、catalog 解析。
- **组件**：`MessageItem`（红/金/徽章/裸身份等分支）、`ViewTile` 放大 toggle、`DanmakuComposer` 校验、`DanmakuOverlay` 渲染。
- **集成**：mock LeanCloud SDK（伪消息流）+ mock hls，测「收→渲染」「发→乐观插入」。
- **联机验收**：有直播时对真实数据冒烟（视频 11 路、弹幕收发）。

---

## 12. 里程碑（粗）

1. 脚手架 + config + fixtures + 弹幕 `model` 与单测。
2. 弹幕模块（连接/订阅/发送）+ 聊天室 + composer（先于视频，可独立验证）。
3. 视频模块（catalog + hls 单路 → 11 路三列布局）+ 清晰度。
4. 飞屏弹幕 overlay + 机位放大交互。
5. 错误处理/性能模式/打磨；联机验收。

---

## 13. 风险

- 11 路同时播放性能（缓解：默认 540p + hls.js 缓冲收紧 + 标签页隐藏时暂停；并由用户用清晰度档位自行控制负载。不做自动降档/减路数）。
- ~~签名 m3u8 获取方式~~ 已解析：内嵌于 `live_game_info.json`，全链路 `ACAO:*`，**确认无需任何代理**。
- 赛季性导致联机验证窗口有限（缓解：fixtures 优先）。
- LeanCloud 客户端密钥/会话可能随赛季变动（集中放 config，便于更新）。
