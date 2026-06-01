# 主视角左上角 · 赛事标题滚动条 · 设计文档

- 日期：2026-06-01
- 状态：待评审
- 目标读者：实现者（后续由 writing-plans 生成实现计划）
- 来源：对 `https://www.robomaster.com/zh-CN/live` 的实测逆向（`pages/live/index` chunk）+ 与用户的设计对话
- 分支 / 工作树：`match-title-overlay` @ `.worktrees/match-title-overlay`

---

## 1. 概述

把主视角左上角原本的「主视角 {清晰度}」纯展示标识，替换为**当前直播比赛的赛事标题**，并照搬官方直播间播放器下方那条标题的展示与滚动逻辑：

> `超级对抗赛 {赛区} 第{N}场 {红方学校} {红方战队} vs {蓝方学校} {蓝方战队}`

例（当前实测正在直播的一场）：

> **超级对抗赛 北部赛区 第68场 东北大学 TDT vs 山东理工大学 齐奇**

标题长度超过主视角宽度时滚动展示（照搬官方"滑到底→停顿→归零→循环"，约 25px/s）。

### 1.1 目标（In Scope）
- 主视角左上角显示当前比赛的赛事标题（格式见上）。
- 数据照搬官方：新增拉取 `current_and_next_matches.json`，按已选直播赛区匹配，优先 `currentMatch`，无则退回 `nextMatch`。
- 标题超出主视角宽度时滚动（溢出才滚，照搬官方滚动逻辑）。
- 标题随比赛进程自动刷新（约每 20s 轮询，换场时跟新）。

### 1.2 非目标（Out of Scope）
- 不在左上角保留清晰度标识（控制栏 `QualityControls` 已有「主视角 1080p ▾」可视+可调，左上角的纯展示标识冗余，移除）。
- 不做小场次序号换算（官方 `orderNumber` 是全局场次号，直接用，不试图换算为"本赛区第几场"）。
- 不复刻官方的比分/胜场/队徽等额外信息，只做这一行标题文本。
- 不接入官方账号/鉴权。

### 1.3 合规说明
- `current_and_next_matches.json` 与现有 `live_game_info.json` 同域（`rm-static.djicdn.com`），实测 `Access-Control-Allow-Origin: *`，沿用项目"零代理纯前端 + 只读拉取"原则。本特性纯读取公开 JSON，不涉及任何发送。

---

## 2. 逆向结论（官方真实逻辑）

### 2.1 数据来源
- 端点：`https://rm-static.djicdn.com/live_json/current_and_next_matches.json`（GET，CORS `*`）。
- 结构：**数组**，每元素对应一个赛区，形如：
  ```jsonc
  [
    { "currentMatch": null, "nextMatch": null },                 // 该赛区无直播
    { "currentMatch": null, "nextMatch": { ...warmup... } },     // 仅有下一场
    { "currentMatch": { ...STARTED... }, "nextMatch": { ... } }  // 正在直播
  ]
  ```
- `match` 关键字段：
  | 字段 | 含义 | 实测值（北部赛区 currentMatch）|
  |---|---|---|
  | `zone.event.title` | 赛事名 | `"RMUC 2026超级对抗赛"` |
  | `zone.name` | 赛区名 | `"北部赛区"` |
  | `orderNumber` | 全局场次序号 | `68` |
  | `matchType` | `KNOCKOUT`/`GROUP`/`WARMUP` | `"KNOCKOUT"` |
  | `status` | `STARTED`/`WAITING`/… | `"STARTED"` |
  | `redSide.player.team.collegeName` | 红方学校 | `"东北大学"` |
  | `redSide.player.team.name` | 红方战队 | `"TDT"` |
  | `blueSide.player.team.collegeName` | 蓝方学校 | `"山东理工大学"` |
  | `blueSide.player.team.name` | 蓝方战队 | `"齐奇"` |

  注：`player`/`team` 在赛前（WARMUP/未填充）可能为 `null`，需空安全。

### 2.2 官方标题拼接（`pages/live/index` chunk 实抠）
```js
// 任一方学校+战队都为空 → 不加分隔符，否则 " VS "
var sep = ("" == redTeamCollegeName && "" == redTeamName)
       || ("" == blueTeamCollegeName && "" == blueTeamName) ? "" : " VS ";
title = (eventName  || "") + " "
      + (zoneName   || "") + " "
      + (orderNumber|| "") + " "          // orderNumber 这里已被赋成 "第{N}场"
      + (redTeamCollegeName  || "") + " " + (redTeamName  || "")
      + sep
      + (blueTeamCollegeName || "") + " " + (blueTeamName || "");

// 字段赋值处：
orderNumber       = m.orderNumber ? ("第" + m.orderNumber + "场") : "";
redTeamName       = getTeamName(m.redSide);     // = team.name
redTeamCollegeName= getCollegeName(m.redSide);  // = team.collegeName
// getCollegeName 兜底：无 team 时回退 player.name
```

### 2.3 官方滚动逻辑（`handleTextScroll` / `clearScrollState` 实抠）
```js
// 对标题元素 i、容器 n：
var a = i.scrollWidth - n.clientWidth;   // 溢出量
if (a > 0) {                              // 仅溢出才滚
  var dur = a / 25;                       // 秒；速度恒 25px/s
  i.style.transitionDuration = dur + "s";
  i.classList.add("scrolling");
  i.style.transform = "translateX(-" + a + "px)";   // 滑到底（露出末尾）
  // 停顿后：transitionDuration=0s 瞬时归零 translateX(0)，再循环
}
// clearScrollState：清空所有计时器并把 transform 复位（卸载/换标题时调用）
```
要点：**不是无缝跑马灯**，是"滑到露出末尾→停→瞬时弹回开头→再滑"的往复。官方另有一套 `@keyframes RightToLeft_*` 是**弹幕**用的，与标题滚动是两套独立机制，勿混。

---

## 3. 本应用的设计

### 3.1 数据流
```
useCatalog → catalog.zoneName ──┐
                                ▼
LiveStage  ── useMatchTitle(zoneName) ──→ { text, isNext } | null
                                ▼ (prop)
MainStage  ── <MatchTitleBar text isNext fallback={`${zoneName} · 主视角`} />
```
- 在 `LiveStage` 就近调用 `useMatchTitle`（它已持有 `catalog.zoneName`），避免把 title 一路 prop-drill 穿过 `App→Live→LiveStage→MainStage`。

### 3.2 三级优雅退化
1. `currentMatch` 存在 → 用它（`isNext=false`）。
2. `currentMatch` 为 `null` 但 `nextMatch` 存在 → 用 `nextMatch`（`isNext=true`，文案前缀「下一场 」）。
3. 接口失败 / 该赛区两者皆 `null` → `useMatchTitle` 返回 `null`，`MatchTitleBar` 显示兜底 `{zoneName} · 主视角`。
- 轮询出错时**保留上次好值**，避免比赛间隙标题闪烁/消失。

### 3.3 赛事名精简
`event.title` = `"RMUC 2026超级对抗赛"` → 取「超级对抗赛」。
实现：剥掉前导非中文 `title.replace(/^[^一-鿿]+/, '')`；结果为空则回退原 `title`。通用、稳健。

### 3.4 文件清单
| 文件 | 类型 | 作用 |
|---|---|---|
| `src/config.ts` | 改 | 新增 `CURRENT_MATCHES_URL` |
| `src/types.ts` | 改 | 新增 `MatchTitle { text: string; isNext: boolean }`（或就近定义） |
| `src/data/match.ts` | **新** | 纯函数：`shortenEventName` / `formatMatchTitle(match)` / `parseCurrentMatch(json, zoneName) → MatchTitle\|null`（含 current→next 兜底）/ `fetchMatchTitle(zoneName, url?)` |
| `src/data/match.test.ts` | **新** | TDD 单测：解析、next 兜底、赛事名精简、缺队省略 vs、player/team 为 null 的空安全、无匹配赛区返回 null |
| `src/fixtures/current-and-next-matches.sample.json` | **新** | 真实裁剪样本（current / next-only / 全 null 三态） |
| `src/hooks/useMatchTitle.ts` | **新** | 入参 zoneName；初次 fetch + 每 ~20s 轮询；错误保留上次好值；卸载清理定时器；返回 `MatchTitle\|null` |
| `src/components/MatchTitleBar.tsx` | **新** | 滚动标题条：渲染文本 + `useEffect` 测溢出滚动（照搬 2.3）；`ResizeObserver` 重测；无文本时渲染 fallback |
| `src/components/MainStage.tsx` | 改 | 删 `<span className="main-res">主视角 {quality}</span>`，换 `<MatchTitleBar … />`；新增 `matchTitle`/`zoneName` props |
| `src/components/LiveStage.tsx` | 改 | 调 `useMatchTitle(catalog.zoneName)`，把结果与 `zoneName` 传给 `MainStage` |
| `src/theme.css` | 改 | `.main-res` → `.match-title`（容器：左上定位、`max-width` 留出右上静音键空间、`overflow:hidden`、`white-space:nowrap`）+ `.match-title__text`（`display:inline-block`，承载 transform）+ `.match-title__text.scrolling`（`transition: transform`） |

### 3.5 `MatchTitleBar` 行为细化
- props：`text?: string | null`、`isNext?: boolean`、`fallback: string`。
- 渲染：`text` 有值显示 `(isNext ? '下一场 ' : '') + text`，否则显示 `fallback`。
- 滚动：`useLayoutEffect` 在文本变化后测 `textEl.scrollWidth - containerEl.clientWidth`；>0 才启动 2.3 的往复滚动；用一组 `setTimeout` 串起"滑→停→归零→再滑"，组件卸载或文本变化时全部 `clearTimeout` 并复位（等价 `clearScrollState`）。`ResizeObserver` 监听容器尺寸变化重测（窗口变窄/机位放大时）。

---

## 4. 测试策略（与既有约定一致）
- **纯函数全覆盖单测**：`src/data/match.test.ts` 覆盖 §3.2 / §3.3 全部分支（current、next 兜底、null、缺队省略 vs、空安全、赛事名精简）。
- **DOM 滚动靠实测冒烟**：`MatchTitleBar` 的滚动依赖真实布局（`scrollWidth`/`clientWidth`），jsdom 无布局引擎、测不准，组件保持极薄；用 `npm run dev` + 浏览器截图验证溢出滚动与不溢出不滚两态（项目既有"纯函数单测 + DOM 冒烟实测"策略）。
- **回归**：现有 43 单测须保持全绿；`tsc -b`、`vite build`、`eslint` 须通过。

---

## 5. 风险与缓解
- **`current_and_next_matches.json` 赛区与 `live_game_info` 赛区不同序**：不靠数组下标，用 `zone.name === catalog.zoneName` 匹配；匹配不到则返回 null 走兜底。
- **赛前 player/team 为 null**：全程 `?.` + 默认空串；缺队时省略 " vs "（照搬官方）。
- **轮询与签名重取无关**：`useMatchTitle` 独立于 `useCatalog`，自带 ~20s 定时器与卸载清理，不干扰视频/弹幕。
- **滚动定时器泄漏**：卸载/换标题时务必清理（`clearScrollState` 等价物），否则会叠加多条往复动画。
