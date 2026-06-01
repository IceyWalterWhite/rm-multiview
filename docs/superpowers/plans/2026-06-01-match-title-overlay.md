# 主视角赛事标题滚动条 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把主视角左上角的「主视角 {清晰度}」换成当前比赛的赛事标题（`超级对抗赛 {赛区} 第{N}场 {红校} {红队} vs {蓝校} {蓝队}`），溢出主视角宽度时滚动展示。

**Architecture:** 新增只读拉取官方 `current_and_next_matches.json`（CORS `*`，与 `live_game_info` 同域）。纯函数 `src/data/match.ts` 负责按赛区匹配 + current→next 兜底 + 拼接；`useMatchTitle` hook 负责 ~20s 轮询并保留上次好值；`MatchTitleBar` 组件照搬官方 `handleTextScroll` 的"滑到底→停→归零→循环"滚动（~25px/s，仅溢出才滚）。在 `LiveStage` 就近取数传给 `MainStage`。

**Tech Stack:** React 19 + TypeScript + Vite；Vitest + @testing-library/react；现有 `fetch`/`ResizeObserver` 模式。

参考 spec：`docs/superpowers/specs/2026-06-01-match-title-overlay-design.md`

---

## File Structure

| 文件 | 责任 |
|---|---|
| `src/config.ts` (改) | 新增 `CURRENT_MATCHES_URL` 常量 |
| `src/types.ts` (改) | 新增 `MatchTitle` 接口 |
| `src/fixtures/current-and-next-matches.sample.json` (新) | 真实裁剪样本（全 null / 仅 next / 有 current 三态）|
| `src/data/match.ts` (新) | 纯函数 + fetch 包装：`shortenEventName`/`formatMatchTitle`/`parseCurrentMatch`/`fetchMatchTitle` |
| `src/data/match.test.ts` (新) | 纯函数单测 |
| `src/hooks/useMatchTitle.ts` (新) | 拉取 + ~20s 轮询 + 保留上次好值 |
| `src/hooks/useMatchTitle.test.ts` (新) | hook 单测（注入 fetcher，短轮询间隔）|
| `src/components/MatchTitleBar.tsx` (新) | 滚动标题条（溢出才滚）|
| `src/components/MainStage.tsx` (改) | 用 `<MatchTitleBar>` 取代 `.main-res` span |
| `src/components/LiveStage.tsx` (改) | 调 `useMatchTitle`，传 props |
| `src/theme.css` (改) | `.main-res` → `.match-title` + `.match-title__text` |

---

## Task 1: 基础常量、类型与测试样本

**Files:**
- Modify: `src/config.ts`
- Modify: `src/types.ts`
- Create: `src/fixtures/current-and-next-matches.sample.json`

- [ ] **Step 1: 在 `src/config.ts` 的 `LIVE_GAME_INFO_URL` 之后新增端点常量**

在 `src/config.ts` 第 9 行（`LIVE_GAME_INFO_URL` 定义结尾）之后插入：

```ts
export const CURRENT_MATCHES_URL =
  'https://rm-static.djicdn.com/live_json/current_and_next_matches.json';
```

- [ ] **Step 2: 在 `src/types.ts` 末尾新增 `MatchTitle` 接口**

在 `src/types.ts` 文件末尾追加：

```ts
export interface MatchTitle {
  text: string;     // 拼好的标题，如 "超级对抗赛 北部赛区 第68场 东北大学 TDT vs 山东理工大学 齐奇"
  isNext: boolean;  // true = 用的是 nextMatch（下一场预告），由组件加「下一场 」前缀
}
```

- [ ] **Step 3: 创建测试样本 `src/fixtures/current-and-next-matches.sample.json`**

写入以下内容（来自实测、按字段裁剪；三态：全 null / 仅 next-warmup-缺队 / 有 current+next）：

```json
[
  { "currentMatch": null, "nextMatch": null },
  {
    "currentMatch": null,
    "nextMatch": {
      "id": "31217", "orderNumber": 0, "matchType": "WARMUP", "status": "WAITING",
      "redSide": { "player": null },
      "blueSide": { "player": null },
      "zone": { "name": "东部赛区", "event": { "title": "RMUC 2026超级对抗赛" } }
    }
  },
  {
    "currentMatch": {
      "id": "31160", "orderNumber": 68, "matchType": "KNOCKOUT", "status": "STARTED",
      "redSide": { "player": { "team": { "collegeName": "东北大学", "name": "TDT" } } },
      "blueSide": { "player": { "team": { "collegeName": "山东理工大学", "name": "齐奇" } } },
      "zone": { "name": "北部赛区", "event": { "title": "RMUC 2026超级对抗赛" } }
    },
    "nextMatch": {
      "id": "31161", "orderNumber": 69, "matchType": "KNOCKOUT", "status": "WAITING",
      "redSide": { "player": { "team": { "collegeName": "长安大学", "name": "VGD" } } },
      "blueSide": { "player": { "team": { "collegeName": "北京理工大学", "name": "追梦" } } },
      "zone": { "name": "北部赛区", "event": { "title": "RMUC 2026超级对抗赛" } }
    }
  }
]
```

- [ ] **Step 4: 类型检查通过**

Run: `npx tsc -b`
Expected: 无错误退出（exit 0）。新常量/类型不影响现有编译。

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/types.ts src/fixtures/current-and-next-matches.sample.json
git commit -m "feat(match): add CURRENT_MATCHES_URL, MatchTitle type, test fixture"
```

---

## Task 2: `match.ts` 纯函数（TDD）

**Files:**
- Create: `src/data/match.test.ts`
- Create: `src/data/match.ts`

- [ ] **Step 1: 写失败测试 `src/data/match.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { parseCurrentMatch, formatMatchTitle, shortenEventName } from './match';
import sample from '../fixtures/current-and-next-matches.sample.json';

describe('shortenEventName', () => {
  it('strips leading non-CJK prefix', () => {
    expect(shortenEventName('RMUC 2026超级对抗赛')).toBe('超级对抗赛');
  });
  it('falls back to original when there is no CJK', () => {
    expect(shortenEventName('RoboMaster')).toBe('RoboMaster');
  });
});

describe('formatMatchTitle', () => {
  it('formats a full current match: event zone 第N场 red vs blue', () => {
    const m = (sample as any[])[2].currentMatch;
    expect(formatMatchTitle(m)).toBe('超级对抗赛 北部赛区 第68场 东北大学 TDT vs 山东理工大学 齐奇');
  });
  it('omits the vs and 第0场 when teams are missing (warmup)', () => {
    const m = (sample as any[])[1].nextMatch;
    expect(formatMatchTitle(m)).toBe('超级对抗赛 东部赛区');
  });
});

describe('parseCurrentMatch', () => {
  it('uses currentMatch for the matching zone', () => {
    expect(parseCurrentMatch(sample, '北部赛区')).toEqual({
      text: '超级对抗赛 北部赛区 第68场 东北大学 TDT vs 山东理工大学 齐奇',
      isNext: false,
    });
  });
  it('falls back to nextMatch when that zone has no currentMatch', () => {
    expect(parseCurrentMatch(sample, '东部赛区')).toEqual({
      text: '超级对抗赛 东部赛区',
      isNext: true,
    });
  });
  it('returns null when the zone is not present', () => {
    expect(parseCurrentMatch(sample, '南部赛区')).toBeNull();
  });
  it('returns null for null / non-array input', () => {
    expect(parseCurrentMatch(null, '北部赛区')).toBeNull();
    expect(parseCurrentMatch([{ currentMatch: null, nextMatch: null }], '北部赛区')).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/data/match.test.ts`
Expected: FAIL —— 模块 `./match` 不存在 / 导出未定义。

- [ ] **Step 3: 写实现 `src/data/match.ts`**

```ts
import type { MatchTitle } from '../types';
import { CURRENT_MATCHES_URL } from '../config';

// 剥掉赛事名前导的非中文（"RMUC 2026超级对抗赛" → "超级对抗赛"）；剥成空则回退原值
export function shortenEventName(title: string): string {
  const s = (title ?? '').replace(/^[^一-鿿]+/, '').trim();
  return s || (title ?? '').trim();
}

function college(side: any): string {
  return String(side?.player?.team?.collegeName ?? '');
}
function team(side: any): string {
  return String(side?.player?.team?.name ?? '');
}

// 照搬官方 pages/live/index 拼接：事件名 赛区 第N场 红校 红队 vs 蓝校 蓝队；缺一方则省略 vs
export function formatMatchTitle(match: any): string {
  const event = shortenEventName(String(match?.zone?.event?.title ?? ''));
  const zone = String(match?.zone?.name ?? '');
  const order = match?.orderNumber ? `第${match.orderNumber}场` : '';
  const red = [college(match?.redSide), team(match?.redSide)].filter(Boolean).join(' ');
  const blue = [college(match?.blueSide), team(match?.blueSide)].filter(Boolean).join(' ');
  const head = [event, zone, order].filter(Boolean).join(' ');
  if (red && blue) return [head, `${red} vs ${blue}`].filter(Boolean).join(' ');
  return [head, red, blue].filter(Boolean).join(' ');
}

// current_and_next_matches.json 是数组，每元素对应一个赛区。
// 按 zone.name === zoneName 定位该赛区元素，优先 currentMatch，无则退回 nextMatch，再无返回 null。
export function parseCurrentMatch(json: any, zoneName: string): MatchTitle | null {
  const arr: any[] = Array.isArray(json) ? json : [];
  const el = arr.find((e) => {
    const z = e?.currentMatch?.zone?.name ?? e?.nextMatch?.zone?.name;
    return z === zoneName;
  });
  if (!el) return null;
  if (el.currentMatch) return { text: formatMatchTitle(el.currentMatch), isNext: false };
  if (el.nextMatch) return { text: formatMatchTitle(el.nextMatch), isNext: true };
  return null;
}

export async function fetchMatchTitle(
  zoneName: string,
  url: string = CURRENT_MATCHES_URL,
): Promise<MatchTitle | null> {
  const res = await fetch(url, { cache: 'no-store' }); // 实时拉取，与 live_game_info 一致
  if (!res.ok) throw new Error(`current_and_next_matches fetch failed: ${res.status}`);
  return parseCurrentMatch(await res.json(), zoneName);
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/data/match.test.ts`
Expected: PASS —— 3 个 describe、共 8 个用例全绿。

- [ ] **Step 5: Commit**

```bash
git add src/data/match.ts src/data/match.test.ts
git commit -m "feat(match): parse + format current/next match title (pure, TDD)"
```

---

## Task 3: `useMatchTitle` 轮询 hook（TDD）

**Files:**
- Create: `src/hooks/useMatchTitle.test.ts`
- Create: `src/hooks/useMatchTitle.ts`

- [ ] **Step 1: 写失败测试 `src/hooks/useMatchTitle.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useMatchTitle } from './useMatchTitle';
import type { MatchTitle } from '../types';

const T = (text: string, isNext = false): MatchTitle => ({ text, isNext });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('useMatchTitle', () => {
  it('fetches the title on mount', async () => {
    const fetcher = async () => T('超级对抗赛 北部赛区 第68场 东北大学 TDT vs 山东理工大学 齐奇');
    const { result } = renderHook(() => useMatchTitle('北部赛区', fetcher, 20000));
    await waitFor(() => expect(result.current?.text).toContain('第68场'));
    expect(result.current?.isNext).toBe(false);
  });

  it('keeps the last good value when a later poll throws', async () => {
    let n = 0;
    const fetcher = async () => { if (++n === 1) return T('A'); throw new Error('net'); };
    const { result } = renderHook(() => useMatchTitle('z', fetcher, 10));
    await waitFor(() => expect(result.current?.text).toBe('A'));
    await sleep(60); // 多次轮询都抛错
    expect(result.current?.text).toBe('A');
  });

  it('exposes null when the fetch resolves null (no match → fallback)', async () => {
    const fetcher = async () => null;
    const { result } = renderHook(() => useMatchTitle('z', fetcher, 10000));
    await sleep(20);
    expect(result.current).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/hooks/useMatchTitle.test.ts`
Expected: FAIL —— 模块 `./useMatchTitle` 不存在。

- [ ] **Step 3: 写实现 `src/hooks/useMatchTitle.ts`**

```ts
import { useEffect, useRef, useState } from 'react';
import type { MatchTitle } from '../types';
import { fetchMatchTitle } from '../data/match';

const POLL_MS = 20000;

type Fetcher = (zoneName: string) => Promise<MatchTitle | null>;

// 拉取并轮询当前赛区赛事标题。成功（含 null=无比赛）即更新；
// 网络出错则保留上次好值，避免比赛间隙闪烁。切赛区时先清空。
export function useMatchTitle(
  zoneName: string,
  fetcher: Fetcher = fetchMatchTitle,
  pollMs: number = POLL_MS,
): MatchTitle | null {
  const [title, setTitle] = useState<MatchTitle | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher; // 始终用最新 fetcher，但不进 effect 依赖

  useEffect(() => {
    let alive = true;
    setTitle(null); // 切赛区先清空，避免串味（稳态下本 effect 只在挂载时跑一次）
    const tick = async () => {
      try {
        const t = await fetcherRef.current(zoneName);
        if (alive) setTitle(t); // 成功：有值则用，null 则回兜底
      } catch {
        /* 网络错误：保留上次好值 */
      }
    };
    tick();
    const id = setInterval(tick, pollMs);
    return () => { alive = false; clearInterval(id); };
  }, [zoneName, pollMs]);

  return title;
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/hooks/useMatchTitle.test.ts`
Expected: PASS —— 3 个用例全绿。

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useMatchTitle.ts src/hooks/useMatchTitle.test.ts
git commit -m "feat(match): useMatchTitle polling hook with keep-last-good (TDD)"
```

---

## Task 4: `MatchTitleBar` 滚动组件

**Files:**
- Create: `src/components/MatchTitleBar.tsx`

> 滚动依赖真实布局（`scrollWidth`/`clientWidth`），jsdom 无布局引擎、无法单测；组件保持极薄，靠 Task 6 的浏览器冒烟验证。本任务只做实现 + 类型检查。

- [ ] **Step 1: 创建 `src/components/MatchTitleBar.tsx`**

```tsx
import { useLayoutEffect, useRef } from 'react';

const SPEED_PX_PER_S = 25; // 照搬官方滚动速度
const PAUSE_MS = 1500;     // 滑到底 / 归零后的停顿

interface Props {
  text?: string | null;
  isNext?: boolean;
  fallback: string; // 无赛事数据时的兜底文案，如 "北部赛区 · 主视角"
}

// 照搬官方 handleTextScroll：测溢出量，仅溢出才滚；滑到底→停→瞬时归零→循环。
export function MatchTitleBar({ text, isNext, fallback }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const display = text ? (isNext ? '下一场 ' : '') + text : fallback;

  useLayoutEffect(() => {
    const container = containerRef.current;
    const el = textRef.current;
    if (!container || !el) return;

    const timers: ReturnType<typeof setTimeout>[] = [];
    let cancelled = false;

    const reset = () => {
      el.style.transitionDuration = '0s';
      el.style.transform = 'translateX(0)';
    };

    const run = () => {
      if (cancelled) return;
      reset();
      const overflow = el.scrollWidth - container.clientWidth;
      if (overflow <= 0) return; // 不溢出不滚
      const durMs = (overflow / SPEED_PX_PER_S) * 1000;
      timers.push(setTimeout(() => {
        if (cancelled) return;
        el.style.transitionDuration = `${durMs}ms`;
        el.style.transform = `translateX(-${overflow}px)`; // 滑到露出末尾
        timers.push(setTimeout(() => {
          if (cancelled) return;
          reset();                                   // 瞬时弹回开头
          timers.push(setTimeout(run, PAUSE_MS));    // 停顿后再循环
        }, durMs + PAUSE_MS));
      }, PAUSE_MS));
    };

    const restart = () => { timers.forEach(clearTimeout); timers.length = 0; run(); };
    run();

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(restart) : null;
    ro?.observe(container);

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      ro?.disconnect();
      reset(); // 等价官方 clearScrollState
    };
  }, [display]);

  return (
    <div className="match-title" ref={containerRef}>
      <span className="match-title__text" ref={textRef}>{display}</span>
    </div>
  );
}
```

- [ ] **Step 2: 类型检查通过**

Run: `npx tsc -b`
Expected: exit 0，无类型错误。

- [ ] **Step 3: Commit**

```bash
git add src/components/MatchTitleBar.tsx
git commit -m "feat(match): MatchTitleBar marquee component (overflow-only scroll)"
```

---

## Task 5: 接线（MainStage / LiveStage / 样式）

**Files:**
- Modify: `src/components/MainStage.tsx`
- Modify: `src/components/LiveStage.tsx`
- Modify: `src/theme.css`

- [ ] **Step 1: 改写 `src/components/MainStage.tsx`**

整文件替换为：

```tsx
import { useState } from 'react';
import type { Danmaku, MatchTitle, StreamView } from '../types';
import type { QualityLabel } from '../config';
import { VideoPlayer } from './VideoPlayer';
import { DanmakuOverlay } from './DanmakuOverlay';
import { MatchTitleBar } from './MatchTitleBar';
import { srcForQuality } from '../data/streams';

export function MainStage({ main, quality, zoneName, matchTitle, messages, onSignatureExpired }: {
  main: StreamView;
  quality: QualityLabel;
  zoneName: string;
  matchTitle: MatchTitle | null;
  messages: Danmaku[];
  onSignatureExpired?: () => void;
}) {
  const [muted, setMuted] = useState(true); // 静音起播以满足浏览器自动播放策略；用户点击后解锁音频
  return (
    <div className="main-stage">
      <MatchTitleBar text={matchTitle?.text} isNext={matchTitle?.isNext} fallback={`${zoneName} · 主视角`} />
      <button className="mute-btn" onClick={() => setMuted((m) => !m)}>{muted ? '🔇 点击开启声音' : '🔊 静音'}</button>
      <VideoPlayer src={srcForQuality(main, quality)} muted={muted} className="main-video" onSignatureExpired={onSignatureExpired} />
      <DanmakuOverlay messages={messages} />
    </div>
  );
}
```

- [ ] **Step 2: 改 `src/components/LiveStage.tsx` —— 引入 hook 并传 props**

在 import 区（第 7 行 `import { DanmakuComposer }...` 之后）加：

```tsx
import { useMatchTitle } from '../hooks/useMatchTitle';
```

在 `export function LiveStage(p: Props) {` 内、`const toggleBlue = ...` 之后加一行：

```tsx
  const matchTitle = useMatchTitle(p.catalog.zoneName);
```

把原本的 `<MainStage .../>`（第 51 行）替换为：

```tsx
        <MainStage main={p.catalog.main} quality={p.mainQuality} zoneName={p.catalog.zoneName} matchTitle={matchTitle} messages={p.messages} onSignatureExpired={p.onSignatureExpired} />
```

- [ ] **Step 3: 改 `src/theme.css` —— `.main-res` 换成 `.match-title`**

把第 33 行的 `.main-res { ... }` 整条规则替换为：

```css
.match-title { position:absolute; top:6px; left:8px; z-index:5; max-width:calc(100% - 130px); overflow:hidden; white-space:nowrap; box-sizing:border-box; font-size:12px; color:var(--accent); background:rgba(0,0,0,.5); padding:1px 8px; border-radius:4px; }
.match-title__text { display:inline-block; transition: transform 0s linear; will-change:transform; }
```

（`max-width:calc(100% - 130px)` 给右上角静音键「🔇 点击开启声音」留位；容器 `overflow:hidden` 裁剪，内层 `inline-block` 文本可超出并被 translate 滚动。）

- [ ] **Step 4: 全量回归 + 类型检查 + 构建 + lint**

Run: `npm test`
Expected: 之前 43 + 新增 11（match 8 + hook 3）= **54 个用例全绿**，0 失败。

Run: `npm run build`
Expected: `tsc -b && vite build` 成功，产出 `dist/`，无类型错误。

Run: `npm run lint`
Expected: 0 error（如有既存 warning 维持原状即可）。

- [ ] **Step 5: Commit**

```bash
git add src/components/MainStage.tsx src/components/LiveStage.tsx src/theme.css
git commit -m "feat(match): wire match title into main stage, replace quality label"
```

---

## Task 6: 浏览器冒烟验证（真实滚动 / 不溢出不滚）

**Files:** 无（仅验证）

> 验证 jsdom 测不了的部分：实际溢出滚动与短标题不滚。

- [ ] **Step 1: 起开发服务器**

Run: `npm run dev`
Expected: Vite 在 `http://localhost:5173` 起起来（赛季有直播时会自动连上当前直播赛区）。

- [ ] **Step 2: 看主视角左上角**

打开页面，确认主视角左上角显示赛事标题（形如「超级对抗赛 北部赛区 第68场 东北大学 TDT vs 山东理工大学 齐奇」），不再是「主视角 1080p」。截图存档。

- [ ] **Step 3: 验证溢出滚动**

把浏览器窗口收窄，使标题宽度超过主视角宽度：确认标题平滑左移、露出末尾、停顿后弹回开头、循环；窗口拉宽到标题完整可见时，确认停止滚动（不溢出不滚）。各截一张图。

- [ ] **Step 4: 验证兜底**

若当前无直播（`currentMatch`/`nextMatch` 皆无）或接口失败，确认左上角显示 `{赛区} · 主视角` 兜底文案而非空白/报错。

- [ ] **Step 5: 收尾**

停掉 dev server。若发现问题，回到对应 Task 修复并重测；全部通过则本计划完成，进入 finishing-a-development-branch 决定合并方式。

---

## 备注

- 不新增依赖。`fetch`/`ResizeObserver`/`useLayoutEffect` 均为现有运行环境已用能力。
- `current_and_next_matches.json` 与 `live_game_info.json` 同域同 CORS 策略，零代理直拉。
- 轮询独立于 `useCatalog` 的签名重取，互不干扰。
