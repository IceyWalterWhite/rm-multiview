# RoboMaster 多视角直播间 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 纯前端 React 应用，消费 RoboMaster 真实直播流（11 路多视角，红蓝三列同时播）与真实 LeanCloud 弹幕（含徽章/学校/身份/正文，红金两色），并支持匿名自填身份发送弹幕。

**Architecture:** 单页 SPA，无后端。视频用 hls.js 跨域直拉 `rtmp.djicdn.com`；流目录与"当前直播赛区"从 `live_game_info.json` 解析（`liveState===1`）；弹幕用 `leancloud-realtime` 匿名连接，按赛区 `chatRoomId` 入会、收发 `TextMessage`。数据层（解析/模型/身份）为纯函数，先于 UI 实现并以真实 fixtures 单测。

**Tech Stack:** React 18 + Vite + TypeScript；Vitest + @testing-library/react（jsdom）；hls.js；leancloud-realtime 5.0.0-rc.8。

**参考：** 设计文档 `docs/superpowers/specs/2026-05-30-rm-multiview-design.md`；逆向 fixtures `recon/out/{catalog.json, danmaku_samples.json, live_streams.json}`。

---

## 文件结构

```
src/
  config.ts                      # 常量：LeanCloud 密钥、URL、清晰度、颜色、过滤词
  types.ts                       # 共享类型：Danmaku / Profile / StreamView / ZoneCatalog
  data/
    danmaku.ts                   # messageToDanmaku / identityTag / danmakuColor （纯函数）
    catalog.ts                   # parseLiveGameInfo / fetchCatalog （纯解析 + fetch）
  hooks/
    useProfile.ts                # 身份 localStorage 持久化
    useDanmaku.ts                # LeanCloud 连接、消息流、send、乐观插入
    useHlsPlayer.ts              # 单个 video 的 hls.js 生命周期 + 换源
  net/
    leancloud.ts                 # Realtime 连接/入会/收/发 的薄封装（可注入便于测试）
  components/
    MessageItem.tsx              # 单条弹幕（颜色/标签/徽章/学校/昵称/正文）
    ChatRoom.tsx                 # 第二屏聊天室列表 + composer
    DanmakuComposer.tsx          # 身份chip + 输入 + 发送（两入口共用）
    IdentityEditor.tsx           # 身份表单（弹窗）
    VideoPlayer.tsx              # 包装 useHlsPlayer 的 <video>
    ViewTile.tsx                 # 单个机位（点击放大 toggle）
    SideColumn.tsx               # 红/蓝列（5 个 ViewTile）
    DanmakuOverlay.tsx           # 主视角飞屏弹幕
    QualityControls.tsx          # 主/多视角清晰度选择
    MainStage.tsx                # 主视角 VideoPlayer + DanmakuOverlay
    LiveStage.tsx                # 第一屏容器（三列 + 控制栏）
    ReservedPanel.tsx            # 第二屏左侧预留
    ChatSection.tsx              # 第二屏容器
  fixtures/
    danmaku-samples.json         # 真实弹幕样本（测试用）
    live-game-info.sample.json   # 真实 live_game_info 片段（catalog 测试用）
  theme.css                      # RM 黑色电竞调 + 弹幕颜色变量
  App.tsx
  main.tsx
```

> 这是**单一计划**（视频与弹幕共享 `live_game_info.json` 与布局，不是独立子系统）。按 Phase 顺序实现：数据层 → 弹幕 → 视频 → 布局组装。

---

## Phase 0 · 脚手架与配置

### Task 0.1: Vite + React + TS + Vitest 脚手架

**Files:**
- Create: `package.json`, `vite.config.ts`, `vitest.setup.ts`, `tsconfig.json`（由脚手架生成后调整）

- [ ] **Step 1: 在项目根脚手架（当前目录已存在 .remember 等，用当前目录）**

Run:
```bash
npm create vite@latest . -- --template react-ts
npm install
npm install hls.js leancloud-realtime@5.0.0-rc.8
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```
若提示目录非空，选择忽略/合并（保留 `.remember`、`docs`、`recon`）。

- [ ] **Step 2: 配置 Vitest（`vite.config.ts`）**

```ts
/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
  },
});
```

- [ ] **Step 3: 创建 `vitest.setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 4: 在 `package.json` 的 scripts 加入 test**

```jsonc
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 5: 冒烟验证**

Run: `npm run test`
Expected: "No test files found" 或 0 失败（环境就绪）。

- [ ] **Step 6: Commit**
```bash
git init && git add -A && git commit -m "chore: scaffold vite+react+ts with vitest"
```
> 用户已表示暂不提交远端；本地 `git init` 仅用于计划要求的频繁提交，可按用户意愿跳过 commit 步骤。

---

### Task 0.2: 配置常量 `src/config.ts`

**Files:**
- Create: `src/config.ts`

- [ ] **Step 1: 写入配置（实测值）**

```ts
// LeanCloud 客户端公开密钥（实测，来源 robomasters bundle）
export const LEANCLOUD = {
  appId: 'UqaoAgYDPakCHxtDiMXVy2Sw-gzGzoHsz',
  appKey: 'xYO2wtjhri9dJR7Vor8kDFl4',
  server: 'https://leancloud.robomaster.com',
} as const;

export const LIVE_GAME_INFO_URL =
  'https://rm-static.djicdn.com/live_json/live_game_info.json';

export const QUALITY_LABELS = ['1080p', '720p', '540p'] as const;
export type QualityLabel = (typeof QUALITY_LABELS)[number];
export const DEFAULT_MAIN_QUALITY: QualityLabel = '1080p';
export const DEFAULT_MULTI_QUALITY: QualityLabel = '540p';

// role 含这些词的视角丢弃（无解说版 / 红蓝机器人合集）
export const DISCARD_ROLE_KEYWORDS = ['合集', '无解说'] as const;

// 弹幕渲染规则（实测）
export const VETERAN_POSITION = '老队员';
export const COLOR_VETERAN = '#FFE180'; // 老队员=金
export const COLOR_COMMON = '#F5B599';  // 队员/校友=红
export const ANNIVERSARY_BADGE = 'electronicTenth';

export const CHAT_BUFFER_LIMIT = 300; // 与原站一致
```

- [ ] **Step 2: Commit**
```bash
git add src/config.ts && git commit -m "feat: add config constants"
```

---

### Task 0.3: 引入真实 fixtures

**Files:**
- Create: `src/fixtures/danmaku-samples.json`（从 `recon/out/danmaku_samples.json` 复制）
- Create: `src/fixtures/live-game-info.sample.json`（从 `recon/out/live_streams.json` 或裁剪后的真实 live_game_info 制作）

- [ ] **Step 1: 复制弹幕样本**
```bash
mkdir -p src/fixtures
cp recon/out/danmaku_samples.json src/fixtures/danmaku-samples.json
```

- [ ] **Step 2: 制作 catalog 测试用 live_game_info 片段**

写一个最小但结构真实的 `src/fixtures/live-game-info.sample.json`（含 2 个赛区：一个 `liveState:1` 一个 `liveState:0`；live 赛区含 `chatRoomId`、`zoneLiveString` 3 档、`fpvData` 至少含 1 个保留视角 + 1 个"合集" + 1 个"无解说"用于测过滤）：

```json
{
  "eventData": [
    {
      "zoneName": "南部赛区", "liveState": 0, "matchState": -1,
      "chatRoomId": "old000000000000000000000",
      "zoneLiveString": [],
      "fpvData": []
    },
    {
      "zoneName": "北部赛区", "liveState": 1, "matchState": 1,
      "chatRoomId": "69ff0439fa62cf0ebe01d583",
      "zoneLiveString": [
        {"label":"1080p","type":"application/vnd.apple.mpegurl","src":"https://rtmp.djicdn.com/robomaster/fight2026-output.m3u8?auth_key=X","res":"high"},
        {"label":"720p","type":"application/vnd.apple.mpegurl","src":"https://rtmp.djicdn.com/robomaster/fight2026-output_ud.m3u8?auth_key=X","res":"middle"},
        {"label":"540p","type":"application/vnd.apple.mpegurl","src":"https://rtmp.djicdn.com/robomaster/fight2026-output_hd.m3u8?auth_key=X","res":"low"}
      ],
      "fpvData": [
        {"role":"主视角（无解说版）","headimg":"h","sources":[{"label":"1080p","src":"https://rtmp.djicdn.com/robomaster/fight2026013.m3u8?auth_key=X","res":"high"}]},
        {"role":"红方英雄第一视角","headimg":"h","sources":[
          {"label":"1080p","src":"https://rtmp.djicdn.com/robomaster/fight2026001.m3u8?auth_key=X","res":"high"},
          {"label":"720p","src":"https://rtmp.djicdn.com/robomaster/fight2026001_ud.m3u8?auth_key=X","res":"middle"},
          {"label":"540p","src":"https://rtmp.djicdn.com/robomaster/fight2026001_hd.m3u8?auth_key=X","res":"low"}
        ]},
        {"role":"红方机器人第一视角合集","headimg":"h","sources":[{"label":"1080p","src":"https://rtmp.djicdn.com/robomaster/fight2026011.m3u8?auth_key=X","res":"high"}]},
        {"role":"蓝方英雄第一视角","headimg":"h","sources":[
          {"label":"1080p","src":"https://rtmp.djicdn.com/robomaster/fight2026006.m3u8?auth_key=X","res":"high"},
          {"label":"540p","src":"https://rtmp.djicdn.com/robomaster/fight2026006_hd.m3u8?auth_key=X","res":"low"}
        ]}
      ]
    }
  ]
}
```

- [ ] **Step 3: Commit**
```bash
git add src/fixtures && git commit -m "test: add real danmaku + live_game_info fixtures"
```

---

## Phase 1 · 弹幕数据模型（纯函数，TDD）

### Task 1.1: 共享类型 + 弹幕解析/标签/颜色

**Files:**
- Create: `src/types.ts`
- Create: `src/data/danmaku.ts`
- Test: `src/data/danmaku.test.ts`

- [ ] **Step 1: 写失败测试 `src/data/danmaku.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { messageToDanmaku, identityTag, danmakuColor } from './danmaku';
import samples from '../fixtures/danmaku-samples.json';
import { COLOR_VETERAN, COLOR_COMMON } from '../config';

describe('messageToDanmaku', () => {
  it('maps LeanCloud attrs to Danmaku model', () => {
    const s = samples[0];
    const d = messageToDanmaku('id1', s.text, s.attributes);
    expect(d.id).toBe('id1');
    expect(d.text).toBe(s.text);
    expect(d.nickname).toBe(s.attributes.nickname);
    expect(d.schoolName).toBe(s.attributes.schoolName);
    expect(d.position).toBe(s.attributes.position);
    expect(typeof d.racingAge).toBe('number');
  });

  it('coerces missing/zero racingAge to 0', () => {
    const d = messageToDanmaku('id2', 'hi', { nickname: 'n', schoolName: 's', position: '校友' });
    expect(d.racingAge).toBe(0);
  });
});

describe('identityTag', () => {
  it('shows "N年{position}" when racingAge>0', () => {
    expect(identityTag({ racingAge: 2, position: '老队员' } as any)).toBe('2年老队员');
  });
  it('shows only position when racingAge is 0', () => {
    expect(identityTag({ racingAge: 0, position: '校友' } as any)).toBe('校友');
  });
});

describe('danmakuColor', () => {
  it('veteran (老队员) is gold', () => {
    expect(danmakuColor({ position: '老队员' } as any)).toBe(COLOR_VETERAN);
  });
  it('队员/校友 are common red', () => {
    expect(danmakuColor({ position: '队员' } as any)).toBe(COLOR_COMMON);
    expect(danmakuColor({ position: '校友' } as any)).toBe(COLOR_COMMON);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/data/danmaku.test.ts`
Expected: FAIL（`messageToDanmaku` 未定义）。

- [ ] **Step 3: 写类型 `src/types.ts`**

```ts
export interface Danmaku {
  id: string;
  text: string;
  nickname: string;
  schoolName: string;
  position: string;   // 队员 | 老队员 | 校友 | ...
  racingAge: number;  // 0 表示无年限
  badge: string;      // 'electronicTenth' | ''
  sendTime: number;
  userId: number;
}

export interface Profile {
  nickname: string;
  schoolName: string;
  position: string;
  racingAge: number;
  badge: string;      // 'electronicTenth' | ''
}
```

- [ ] **Step 4: 实现 `src/data/danmaku.ts`**

```ts
import type { Danmaku } from '../types';
import { VETERAN_POSITION, COLOR_VETERAN, COLOR_COMMON } from '../config';

type Attrs = Record<string, unknown>;

export function messageToDanmaku(id: string, text: string, attrs: Attrs): Danmaku {
  return {
    id,
    text: text ?? '',
    nickname: String(attrs.nickname ?? ''),
    schoolName: String(attrs.schoolName ?? ''),
    position: String(attrs.position ?? ''),
    racingAge: Number(attrs.racingAge) || 0,
    badge: String(attrs.badge ?? ''),
    sendTime: Number(attrs.sendTime) || 0,
    userId: Number(attrs.userId) || 0,
  };
}

// 实测规则：racingAge>0 → "{N}年{position}"，否则只显示 position
export function identityTag(d: Pick<Danmaku, 'racingAge' | 'position'>): string {
  return d.racingAge ? `${d.racingAge}年${d.position}` : d.position;
}

// 实测规则：老队员=金，其余(队员/校友)=红；与徽章无关
export function danmakuColor(d: Pick<Danmaku, 'position'>): string {
  return d.position === VETERAN_POSITION ? COLOR_VETERAN : COLOR_COMMON;
}
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run src/data/danmaku.test.ts`
Expected: PASS（全部用例）。

- [ ] **Step 6: Commit**
```bash
git add src/types.ts src/data/danmaku.ts src/data/danmaku.test.ts
git commit -m "feat: danmaku model + identity tag + color rules (TDD)"
```

---

## Phase 2 · 流目录解析（纯解析 + fetch，TDD）

### Task 2.1: `parseLiveGameInfo` + `fetchCatalog`

**Files:**
- Create: `src/data/catalog.ts`
- Test: `src/data/catalog.test.ts`
- Modify: `src/types.ts`（追加 StreamView / ZoneCatalog）

- [ ] **Step 1: 追加类型到 `src/types.ts`**

```ts
export type Side = 'main' | 'red' | 'blue';

export interface QualitySource {
  label: string;  // '1080p' | '720p' | '540p'
  src: string;    // 含 auth_key 的 m3u8 URL
  res: string;
}
export interface StreamView {
  id: string;          // 流名，如 fight2026001
  role: string;        // 视角名
  side: Side;
  sources: QualitySource[];
}
export interface ZoneCatalog {
  zoneName: string;
  chatRoomId: string;
  main: StreamView;          // 主视角（zoneLiveString）
  redViews: StreamView[];
  blueViews: StreamView[];
}
```

- [ ] **Step 2: 写失败测试 `src/data/catalog.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { parseLiveGameInfo } from './catalog';
import sample from '../fixtures/live-game-info.sample.json';

describe('parseLiveGameInfo', () => {
  const cat = parseLiveGameInfo(sample);

  it('selects the liveState===1 zone', () => {
    expect(cat.zoneName).toBe('北部赛区');
    expect(cat.chatRoomId).toBe('69ff0439fa62cf0ebe01d583');
  });

  it('main view comes from zoneLiveString with 3 qualities', () => {
    expect(cat.main.side).toBe('main');
    expect(cat.main.id).toBe('fight2026-output');
    expect(cat.main.sources.map(s => s.label)).toEqual(['1080p', '720p', '540p']);
  });

  it('drops 合集 and 无解说 views by role', () => {
    const roles = [...cat.redViews, ...cat.blueViews].map(v => v.role);
    expect(roles).not.toContain('主视角（无解说版）');
    expect(roles).not.toContain('红方机器人第一视角合集');
  });

  it('splits views into red/blue by role', () => {
    expect(cat.redViews.map(v => v.role)).toContain('红方英雄第一视角');
    expect(cat.blueViews.map(v => v.role)).toContain('蓝方英雄第一视角');
  });

  it('throws when no live zone', () => {
    expect(() => parseLiveGameInfo({ eventData: [{ liveState: 0 }] })).toThrow();
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `npx vitest run src/data/catalog.test.ts`
Expected: FAIL（`parseLiveGameInfo` 未定义）。

- [ ] **Step 4: 实现 `src/data/catalog.ts`**

```ts
import type { ZoneCatalog, StreamView, QualitySource, Side } from '../types';
import { DISCARD_ROLE_KEYWORDS, LIVE_GAME_INFO_URL } from '../config';

function streamId(src: string): string {
  const m = /\/robomaster\/([^/?.]+)/.exec(src ?? '');
  return m ? m[1] : '';
}
function toSources(raw: any[]): QualitySource[] {
  return (raw ?? []).map((s) => ({ label: String(s.label), src: String(s.src), res: String(s.res ?? '') }));
}
function sideOf(role: string): Side {
  if (role.includes('红')) return 'red';
  if (role.includes('蓝')) return 'blue';
  return 'main';
}
function isDiscarded(role: string): boolean {
  return DISCARD_ROLE_KEYWORDS.some((k) => role.includes(k));
}

export function parseLiveGameInfo(json: any): ZoneCatalog {
  const zones: any[] = json?.eventData ?? [];
  const zone = zones.find((z) => z?.liveState === 1);
  if (!zone) throw new Error('no live zone (liveState===1) found');

  const mainSources = toSources(zone.zoneLiveString);
  const main: StreamView = {
    id: streamId(mainSources[0]?.src ?? ''),
    role: '主视角',
    side: 'main',
    sources: mainSources,
  };

  const redViews: StreamView[] = [];
  const blueViews: StreamView[] = [];
  for (const f of zone.fpvData ?? []) {
    const role = String(f.role ?? '');
    if (isDiscarded(role)) continue;
    const sources = toSources(f.sources);
    const view: StreamView = { id: streamId(sources[0]?.src ?? ''), role, side: sideOf(role), sources };
    if (view.side === 'red') redViews.push(view);
    else if (view.side === 'blue') blueViews.push(view);
  }

  return { zoneName: String(zone.zoneName ?? ''), chatRoomId: String(zone.chatRoomId ?? ''), main, redViews, blueViews };
}

export async function fetchCatalog(url: string = LIVE_GAME_INFO_URL): Promise<ZoneCatalog> {
  const res = await fetch(url, { cache: 'no-store' }); // 每次进入实时获取 → 新鲜签名
  if (!res.ok) throw new Error(`live_game_info fetch failed: ${res.status}`);
  return parseLiveGameInfo(await res.json());
}
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run src/data/catalog.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**
```bash
git add src/data/catalog.ts src/data/catalog.test.ts src/types.ts
git commit -m "feat: parse live_game_info into zone catalog (TDD)"
```

---

## Phase 3 · 身份持久化（TDD）

### Task 3.1: `useProfile`

**Files:**
- Create: `src/hooks/useProfile.ts`
- Test: `src/hooks/useProfile.test.ts`

- [ ] **Step 1: 写失败测试 `src/hooks/useProfile.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProfile, DEFAULT_PROFILE } from './useProfile';

beforeEach(() => localStorage.clear());

describe('useProfile', () => {
  it('returns default when empty', () => {
    const { result } = renderHook(() => useProfile());
    expect(result.current.profile).toEqual(DEFAULT_PROFILE);
  });

  it('persists updates to localStorage', () => {
    const { result } = renderHook(() => useProfile());
    act(() => result.current.setProfile({ ...DEFAULT_PROFILE, nickname: '强强', schoolName: '清华大学', position: '校友' }));
    expect(result.current.profile.nickname).toBe('强强');
    const { result: r2 } = renderHook(() => useProfile());
    expect(r2.current.profile.schoolName).toBe('清华大学');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/hooks/useProfile.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 `src/hooks/useProfile.ts`**

```ts
import { useCallback, useState } from 'react';
import type { Profile } from '../types';

const KEY = 'rm-multiview.profile';
export const DEFAULT_PROFILE: Profile = {
  nickname: '', schoolName: '', position: '校友', racingAge: 0, badge: '',
};

function load(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PROFILE;
    return { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function useProfile() {
  const [profile, setProfileState] = useState<Profile>(load);
  const setProfile = useCallback((p: Profile) => {
    setProfileState(p);
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore quota */ }
  }, []);
  const isComplete = profile.nickname.trim() !== '' && profile.schoolName.trim() !== '';
  return { profile, setProfile, isComplete };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/hooks/useProfile.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**
```bash
git add src/hooks/useProfile.ts src/hooks/useProfile.test.ts
git commit -m "feat: useProfile localStorage persistence (TDD)"
```

---

## Phase 4 · 弹幕连接（LeanCloud）

### Task 4.1: LeanCloud 薄封装 `src/net/leancloud.ts`

**Files:**
- Create: `src/net/leancloud.ts`

> 说明：发送/接收的**消息属性结构**已在 Phase 1 单测覆盖（`messageToDanmaku`）。本封装是与 SDK 的 IO 边界，不做单元测试，用 Phase 7 联机冒烟验证。封装暴露窄接口便于在 `useDanmaku` 测试中 mock。

- [ ] **Step 1: 实现连接封装**

```ts
import { Realtime, TextMessage, Event } from 'leancloud-realtime';
import type { Conversation, IMClient } from 'leancloud-realtime';
import { LEANCLOUD } from '../config';
import type { Profile } from '../types';

export interface RawMessage { id: string; text: string; attrs: Record<string, unknown>; }
export interface DanmakuConnection {
  onMessage: (cb: (m: RawMessage) => void) => void;
  send: (text: string, profile: Profile) => Promise<RawMessage>;
  close: () => Promise<void>;
}

function randomClientId(): string {
  // 匿名数字 clientId（无签名），形如原站 17 位数字
  let s = '';
  for (let i = 0; i < 17; i++) s += Math.floor(Math.random() * 10);
  return s.replace(/^0/, '1');
}

export async function connectDanmaku(chatRoomId: string): Promise<DanmakuConnection> {
  const realtime = new Realtime({ appId: LEANCLOUD.appId, appKey: LEANCLOUD.appKey, server: LEANCLOUD.server });
  const client: IMClient = await realtime.createIMClient(randomClientId());
  const conv: Conversation = await client.getConversation(chatRoomId);
  if (conv.transient) { try { await conv.join(); } catch { /* transient join may noop */ } }

  let handler: ((m: RawMessage) => void) | null = null;
  client.on(Event.MESSAGE, (message: any) => {
    const attrs = (message.getAttributes && message.getAttributes()) || {};
    const text = message.text !== undefined ? message.text : (message.getText?.() ?? '');
    handler?.({ id: String(message.id ?? ''), text, attrs });
  });

  return {
    onMessage(cb) { handler = cb; },
    async send(text, profile) {
      const attrs = {
        username: `${profile.racingAge}-${profile.position}-${profile.schoolName}-${profile.nickname}`,
        nickname: profile.nickname,
        schoolName: profile.schoolName,
        position: profile.position,
        racingAge: profile.racingAge,
        badge: profile.badge,
        sendTime: Date.now(),
        userId: 0,
      };
      const msg = new TextMessage(text);
      msg.setAttributes(attrs);
      const sent: any = await conv.send(msg);
      return { id: String(sent.id ?? ''), text, attrs };
    },
    async close() { try { await client.close(); } catch { /* ignore */ } },
  };
}
```

- [ ] **Step 2: 类型检查通过**

Run: `npx tsc --noEmit`
Expected: 无错误（若 SDK 类型缺失，按需 `// @ts-expect-error` 或安装 @types；leancloud-realtime 自带类型）。

- [ ] **Step 3: Commit**
```bash
git add src/net/leancloud.ts && git commit -m "feat: leancloud danmaku connection wrapper"
```

---

### Task 4.2: `useDanmaku` hook（消息流 + 乐观插入 + 上限）

**Files:**
- Create: `src/hooks/useDanmaku.ts`
- Test: `src/hooks/useDanmaku.test.ts`

- [ ] **Step 1: 写失败测试（用可注入的假连接）`src/hooks/useDanmaku.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDanmaku } from './useDanmaku';
import type { DanmakuConnection, RawMessage } from '../net/leancloud';
import { CHAT_BUFFER_LIMIT } from '../config';

function fakeConn() {
  let cb: ((m: RawMessage) => void) | null = null;
  const conn: DanmakuConnection = {
    onMessage: (f) => { cb = f; },
    send: async (text, p) => ({ id: 'local-' + text, text, attrs: { nickname: p.nickname, schoolName: p.schoolName, position: p.position, racingAge: p.racingAge, badge: p.badge } }),
    close: async () => {},
  };
  return { conn, emit: (m: RawMessage) => cb?.(m) };
}

describe('useDanmaku', () => {
  it('appends incoming messages as Danmaku', async () => {
    const { conn, emit } = fakeConn();
    const { result } = renderHook(() => useDanmaku(async () => conn));
    await waitFor(() => expect(result.current.connected).toBe(true));
    act(() => emit({ id: 'm1', text: 'hi', attrs: { nickname: 'n', schoolName: 's', position: '队员', racingAge: 1 } }));
    expect(result.current.messages.at(-1)?.text).toBe('hi');
  });

  it('caps buffer at CHAT_BUFFER_LIMIT', async () => {
    const { conn, emit } = fakeConn();
    const { result } = renderHook(() => useDanmaku(async () => conn));
    await waitFor(() => expect(result.current.connected).toBe(true));
    act(() => { for (let i = 0; i < CHAT_BUFFER_LIMIT + 50; i++) emit({ id: 'm' + i, text: 't' + i, attrs: { position: '队员' } }); });
    expect(result.current.messages.length).toBe(CHAT_BUFFER_LIMIT);
  });

  it('optimistically inserts sent message', async () => {
    const { conn } = fakeConn();
    const { result } = renderHook(() => useDanmaku(async () => conn));
    await waitFor(() => expect(result.current.connected).toBe(true));
    await act(async () => { await result.current.send('我发的', { nickname: '强强', schoolName: '清华大学', position: '校友', racingAge: 0, badge: '' }); });
    expect(result.current.messages.at(-1)?.text).toBe('我发的');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/hooks/useDanmaku.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 `src/hooks/useDanmaku.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Danmaku, Profile } from '../types';
import { messageToDanmaku } from '../data/danmaku';
import { CHAT_BUFFER_LIMIT } from '../config';
import { connectDanmaku, type DanmakuConnection } from '../net/leancloud';

type ConnFactory = () => Promise<DanmakuConnection>;

export function useDanmaku(connect: ConnFactory) {
  const [messages, setMessages] = useState<Danmaku[]>([]);
  const [connected, setConnected] = useState(false);
  const connRef = useRef<DanmakuConnection | null>(null);

  const push = useCallback((d: Danmaku) => {
    setMessages((prev) => {
      const next = prev.length >= CHAT_BUFFER_LIMIT ? prev.slice(prev.length - CHAT_BUFFER_LIMIT + 1) : prev.slice();
      next.push(d);
      return next;
    });
  }, []);

  useEffect(() => {
    let alive = true;
    connect().then((conn) => {
      if (!alive) { conn.close(); return; }
      connRef.current = conn;
      conn.onMessage((m) => push(messageToDanmaku(m.id, m.text, m.attrs)));
      setConnected(true);
    }).catch(() => setConnected(false));
    return () => { alive = false; connRef.current?.close(); };
  }, [connect, push]);

  const send = useCallback(async (text: string, profile: Profile) => {
    const conn = connRef.current;
    if (!conn) throw new Error('not connected');
    const raw = await conn.send(text, profile);
    push(messageToDanmaku(raw.id || 'local-' + Date.now(), raw.text, raw.attrs)); // 乐观插入（瞬态不回推自己）
  }, [push]);

  return { messages, connected, send };
}

// 生产用工厂：按当前直播赛区 chatRoomId 连接
export function makeLiveConnFactory(chatRoomId: string): ConnFactory {
  return () => connectDanmaku(chatRoomId);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/hooks/useDanmaku.test.ts`
Expected: PASS（3 用例）。

- [ ] **Step 5: Commit**
```bash
git add src/hooks/useDanmaku.ts src/hooks/useDanmaku.test.ts
git commit -m "feat: useDanmaku stream with buffer cap + optimistic send (TDD)"
```

---

## Phase 5 · 视频播放

### Task 5.1: `useHlsPlayer` hook

**Files:**
- Create: `src/hooks/useHlsPlayer.ts`

> 说明：hls.js 需真实媒体环境，jsdom 无法播放，故不做单元测试；行为在 Phase 7 真机/联机验证。接口设计为：传入 `videoRef` 与当前 `src`，hook 负责 attach、换源、清理与低缓冲配置。

- [ ] **Step 1: 实现 `src/hooks/useHlsPlayer.ts`**

```ts
import { useEffect } from 'react';
import Hls from 'hls.js';

// 11 路同播：收紧缓冲，降低内存/解码压力
const HLS_CONFIG = {
  lowLatencyMode: false,
  backBufferLength: 10,
  maxBufferLength: 8,
  maxMaxBufferLength: 20,
  liveSyncDurationCount: 3,
};

export function useHlsPlayer(videoRef: React.RefObject<HTMLVideoElement>, src: string | undefined) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    // Safari 原生支持 HLS
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      video.play().catch(() => {});
      return () => { video.removeAttribute('src'); video.load(); };
    }

    if (!Hls.isSupported()) return;
    const hls = new Hls(HLS_CONFIG);
    hls.loadSource(src);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
      else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
    });
    return () => hls.destroy();
  }, [videoRef, src]); // src 变化（换清晰度）→ 重建
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: Commit**
```bash
git add src/hooks/useHlsPlayer.ts && git commit -m "feat: useHlsPlayer hls.js hook with buffer tuning"
```

---

### Task 5.2: `VideoPlayer` 组件

**Files:**
- Create: `src/components/VideoPlayer.tsx`

- [ ] **Step 1: 实现**

```tsx
import { useRef } from 'react';
import { useHlsPlayer } from '../hooks/useHlsPlayer';

interface Props { src?: string; muted?: boolean; className?: string; }

export function VideoPlayer({ src, muted = true, className }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  useHlsPlayer(ref, src);
  return <video ref={ref} className={className} muted={muted} playsInline autoPlay />;
}
```

- [ ] **Step 2: Commit**
```bash
git add src/components/VideoPlayer.tsx && git commit -m "feat: VideoPlayer component"
```

---

### Task 5.3: `usePauseOnHidden`（标签页隐藏时暂停全部，spec §4）

**Files:**
- Create: `src/hooks/usePauseOnHidden.ts`

> 标签页隐藏 → 暂停所有 `<video>`（省资源，浏览器本就节流）；恢复可见 → 重新播放。不做"滚动到第二屏暂停"、不做自动降档（已按用户要求剔除）。

- [ ] **Step 1: 实现**

```ts
import { useEffect } from 'react';

export function usePauseOnHidden() {
  useEffect(() => {
    const onChange = () => {
      const hidden = document.hidden;
      document.querySelectorAll('video').forEach((v) => {
        if (hidden) v.pause();
        else v.play().catch(() => {});
      });
    };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
}
```

- [ ] **Step 2: 类型检查 + 提交**

Run: `npx tsc --noEmit`
Expected: 无错误。
```bash
git add src/hooks/usePauseOnHidden.ts && git commit -m "feat: pause all videos when tab hidden"
```

> 在 Task 7.1 的 `Live` 组件内调用 `usePauseOnHidden()`。

---

## Phase 6 · UI 组件

### Task 6.1: `MessageItem`（弹幕条：颜色/标签/徽章）

**Files:**
- Create: `src/components/MessageItem.tsx`
- Test: `src/components/MessageItem.test.tsx`

- [ ] **Step 1: 写失败测试 `src/components/MessageItem.test.tsx`**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageItem } from './MessageItem';
import type { Danmaku } from '../types';
import { COLOR_VETERAN, COLOR_COMMON } from '../config';

const base: Danmaku = { id: '1', text: '加油', nickname: '强强', schoolName: '清华大学', position: '校友', racingAge: 0, badge: 'electronicTenth', sendTime: 0, userId: 0 };

describe('MessageItem', () => {
  it('renders text, nickname, school and tag', () => {
    render(<MessageItem d={base} />);
    expect(screen.getByText('加油')).toBeInTheDocument();
    expect(screen.getByText('强强')).toBeInTheDocument();
    expect(screen.getByText('清华大学')).toBeInTheDocument();
    expect(screen.getByText('校友')).toBeInTheDocument(); // racingAge 0 → 裸身份
  });

  it('uses gold color for 老队员', () => {
    render(<MessageItem d={{ ...base, position: '老队员', racingAge: 2 }} />);
    const tag = screen.getByText('2年老队员');
    expect(tag).toHaveStyle({ color: COLOR_VETERAN });
  });

  it('uses common color for 队员', () => {
    render(<MessageItem d={{ ...base, position: '队员', racingAge: 1 }} />);
    expect(screen.getByText('1年队员')).toHaveStyle({ color: COLOR_COMMON });
  });

  it('shows badge node only when badge present', () => {
    const { rerender } = render(<MessageItem d={base} />);
    expect(screen.getByTestId('badge')).toBeInTheDocument();
    rerender(<MessageItem d={{ ...base, badge: '' }} />);
    expect(screen.queryByTestId('badge')).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/components/MessageItem.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现 `src/components/MessageItem.tsx`**

```tsx
import type { Danmaku } from '../types';
import { identityTag, danmakuColor } from '../data/danmaku';
import { ANNIVERSARY_BADGE } from '../config';

export function MessageItem({ d }: { d: Danmaku }) {
  const color = danmakuColor(d);
  return (
    <div className="msg-item">
      <span className="msg-name" style={{ color }}>
        {d.badge === ANNIVERSARY_BADGE && <i className="msg-badge" data-testid="badge" title="十周年徽章" />}
        <span className="msg-tag" style={{ color }}>{identityTag(d)}</span>
        <span className="msg-school">{d.schoolName}</span>
        <span className="msg-nick">{d.nickname}</span>
      </span>
      <span className="msg-text">{d.text}</span>
    </div>
  );
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/components/MessageItem.test.tsx`
Expected: PASS（4 用例）。

- [ ] **Step 5: Commit**
```bash
git add src/components/MessageItem.tsx src/components/MessageItem.test.tsx
git commit -m "feat: MessageItem with color/tag/badge rules (TDD)"
```

---

### Task 6.2: `IdentityEditor`（身份表单）

**Files:**
- Create: `src/components/IdentityEditor.tsx`

- [ ] **Step 1: 实现**

```tsx
import { useState } from 'react';
import type { Profile } from '../types';
import { ANNIVERSARY_BADGE } from '../config';

const POSITIONS = ['队员', '老队员', '校友'];

export function IdentityEditor({ value, onSave, onClose }: { value: Profile; onSave: (p: Profile) => void; onClose: () => void; }) {
  const [p, setP] = useState<Profile>(value);
  return (
    <div className="id-editor-backdrop" onClick={onClose}>
      <div className="id-editor" onClick={(e) => e.stopPropagation()}>
        <h3>设置发送身份</h3>
        <label>昵称<input value={p.nickname} onChange={(e) => setP({ ...p, nickname: e.target.value })} /></label>
        <label>学校<input value={p.schoolName} onChange={(e) => setP({ ...p, schoolName: e.target.value })} /></label>
        <label>身份
          <select value={p.position} onChange={(e) => setP({ ...p, position: e.target.value })}>
            {POSITIONS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label>参赛年限<input type="number" min={0} value={p.racingAge} onChange={(e) => setP({ ...p, racingAge: Number(e.target.value) || 0 })} /></label>
        <label><input type="checkbox" checked={p.badge === ANNIVERSARY_BADGE} onChange={(e) => setP({ ...p, badge: e.target.checked ? ANNIVERSARY_BADGE : '' })} /> 十周年徽章</label>
        <div className="id-editor-actions">
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={!p.nickname || !p.schoolName} onClick={() => { onSave(p); onClose(); }}>保存</button>
        </div>
        <p className="id-hint">身份为自填，请文明发言。</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**
```bash
git add src/components/IdentityEditor.tsx && git commit -m "feat: IdentityEditor form"
```

---

### Task 6.3: `DanmakuComposer`（身份chip + 输入 + 发送，两入口共用）

**Files:**
- Create: `src/components/DanmakuComposer.tsx`
- Test: `src/components/DanmakuComposer.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DanmakuComposer } from './DanmakuComposer';
import { DEFAULT_PROFILE } from '../hooks/useProfile';

describe('DanmakuComposer', () => {
  it('calls onSend with typed text and clears input', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const profile = { ...DEFAULT_PROFILE, nickname: '强强', schoolName: '清华大学', position: '校友' };
    render(<DanmakuComposer profile={profile} isComplete onSend={onSend} onEditIdentity={() => {}} />);
    const input = screen.getByPlaceholderText(/发条弹幕/);
    await userEvent.type(input, '！！');
    await userEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(onSend).toHaveBeenCalledWith('！！');
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('prompts identity edit when incomplete', async () => {
    const onEditIdentity = vi.fn();
    render(<DanmakuComposer profile={DEFAULT_PROFILE} isComplete={false} onSend={vi.fn()} onEditIdentity={onEditIdentity} />);
    await userEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(onEditIdentity).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/components/DanmakuComposer.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现 `src/components/DanmakuComposer.tsx`**

```tsx
import { useState } from 'react';
import type { Profile } from '../types';
import { ANNIVERSARY_BADGE } from '../config';
import { identityTag } from '../data/danmaku';

interface Props {
  profile: Profile;
  isComplete: boolean;
  onSend: (text: string) => Promise<void> | void;
  onEditIdentity: () => void;
}

export function DanmakuComposer({ profile, isComplete, onSend, onEditIdentity }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!isComplete) { onEditIdentity(); return; }
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try { await onSend(t); setText(''); } finally { setBusy(false); }
  }

  const chip = isComplete
    ? `${profile.schoolName}·${identityTag(profile)}·${profile.nickname}`
    : '设置身份';

  return (
    <div className="composer">
      <button className="id-chip" onClick={onEditIdentity} title="编辑身份">
        {profile.badge === ANNIVERSARY_BADGE && <i className="chip-badge" />}
        {chip} ✎
      </button>
      <input
        className="composer-input"
        placeholder="发条弹幕飘到主视角上…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
      />
      <button className="send-btn" onClick={submit} disabled={busy}>发送</button>
    </div>
  );
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/components/DanmakuComposer.test.tsx`
Expected: PASS。

- [ ] **Step 5: Commit**
```bash
git add src/components/DanmakuComposer.tsx src/components/DanmakuComposer.test.tsx
git commit -m "feat: DanmakuComposer with identity chip (TDD)"
```

---

### Task 6.4: `ChatRoom`（第二屏聊天室列表 + composer）

**Files:**
- Create: `src/components/ChatRoom.tsx`

- [ ] **Step 1: 实现**

```tsx
import { useEffect, useRef } from 'react';
import type { Danmaku, Profile } from '../types';
import { MessageItem } from './MessageItem';
import { DanmakuComposer } from './DanmakuComposer';

interface Props {
  zoneName: string;
  messages: Danmaku[];
  profile: Profile;
  isComplete: boolean;
  onSend: (text: string) => Promise<void> | void;
  onEditIdentity: () => void;
}

export function ChatRoom({ zoneName, messages, profile, isComplete, onSend, onEditIdentity }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight; // 自动滚到底
  }, [messages]);

  return (
    <div className="chatroom">
      <div className="chatroom-title">聊天室 · {zoneName}</div>
      <div className="chatroom-list" ref={listRef}>
        {messages.map((m) => <MessageItem key={m.id} d={m} />)}
      </div>
      <DanmakuComposer profile={profile} isComplete={isComplete} onSend={onSend} onEditIdentity={onEditIdentity} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**
```bash
git add src/components/ChatRoom.tsx && git commit -m "feat: ChatRoom list + composer"
```

---

### Task 6.5: `ViewTile` + `SideColumn`（机位 + 点击放大 toggle）

**Files:**
- Create: `src/components/ViewTile.tsx`
- Create: `src/components/SideColumn.tsx`
- Test: `src/components/ViewTile.test.tsx`

- [ ] **Step 1: 写失败测试（放大 toggle 行为）`src/components/ViewTile.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ViewTile } from './ViewTile';
import type { StreamView } from '../types';

const view: StreamView = { id: 'fight2026001', role: '红方英雄第一视角', side: 'red',
  sources: [{ label: '540p', src: 'https://x/fight2026001_hd.m3u8', res: 'low' }] };

describe('ViewTile', () => {
  it('toggles enlarged class and calls onToggle', async () => {
    const onToggle = vi.fn();
    render(<ViewTile view={view} quality="540p" enlarged={false} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('button', { name: /红方英雄/ }));
    expect(onToggle).toHaveBeenCalledWith('fight2026001');
  });

  it('applies enlarged class when enlarged', () => {
    render(<ViewTile view={view} quality="540p" enlarged onToggle={() => {}} />);
    expect(screen.getByRole('button', { name: /红方英雄/ })).toHaveClass('enlarged');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/components/ViewTile.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现 `src/components/ViewTile.tsx`**

```tsx
import type { StreamView } from '../types';
import type { QualityLabel } from '../config';
import { VideoPlayer } from './VideoPlayer';

interface Props {
  view: StreamView;
  quality: QualityLabel;
  enlarged: boolean;
  onToggle: (id: string) => void;
}

function srcFor(view: StreamView, quality: QualityLabel): string | undefined {
  return (view.sources.find((s) => s.label === quality) ?? view.sources[0])?.src;
}

export function ViewTile({ view, quality, enlarged, onToggle }: Props) {
  return (
    <button
      className={`view-tile ${view.side} ${enlarged ? 'enlarged' : ''}`}
      onClick={() => onToggle(view.id)}
      title={view.role}
    >
      <VideoPlayer src={srcFor(view, quality)} className="view-tile-video" />
      <span className="view-tile-label">{view.role}</span>
    </button>
  );
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/components/ViewTile.test.tsx`
Expected: PASS。

- [ ] **Step 5: 实现 `src/components/SideColumn.tsx`**

```tsx
import type { StreamView } from '../types';
import type { QualityLabel } from '../config';
import { ViewTile } from './ViewTile';

interface Props {
  side: 'red' | 'blue';
  views: StreamView[];
  quality: QualityLabel;
  enlargedId: string | null;
  onToggle: (id: string) => void;
}

export function SideColumn({ side, views, quality, enlargedId, onToggle }: Props) {
  return (
    <div className={`side-column ${side}`}>
      {views.map((v) => (
        <ViewTile key={v.id} view={v} quality={quality} enlarged={enlargedId === v.id} onToggle={onToggle} />
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Commit**
```bash
git add src/components/ViewTile.tsx src/components/ViewTile.test.tsx src/components/SideColumn.tsx
git commit -m "feat: ViewTile enlarge toggle + SideColumn (TDD)"
```

---

### Task 6.6: `DanmakuOverlay`（主视角飞屏弹幕）

**Files:**
- Create: `src/components/DanmakuOverlay.tsx`
- Create: `src/components/DanmakuOverlay.css`

> 行为：把新到达的弹幕分配到若干轨道，横向从右飘到左（CSS animation），结束后移除。每条用 MessageItem 着色风格内联渲染。

- [ ] **Step 1: 实现 `src/components/DanmakuOverlay.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import type { Danmaku } from '../types';
import { identityTag, danmakuColor } from '../data/danmaku';
import { ANNIVERSARY_BADGE } from '../config';
import './DanmakuOverlay.css';

const TRACKS = 5;
const DURATION_MS = 9000;

interface Flying { key: string; d: Danmaku; track: number; }

export function DanmakuOverlay({ messages }: { messages: Danmaku[] }) {
  const [flying, setFlying] = useState<Flying[]>([]);
  const lastId = useRef<string | null>(null);
  const trackRR = useRef(0);

  useEffect(() => {
    const latest = messages.at(-1);
    if (!latest || latest.id === lastId.current) return;
    lastId.current = latest.id;
    const track = trackRR.current % TRACKS;
    trackRR.current += 1;
    const key = `${latest.id}-${trackRR.current}`;
    setFlying((f) => [...f, { key, d: latest, track }]);
    const t = setTimeout(() => setFlying((f) => f.filter((x) => x.key !== key)), DURATION_MS);
    return () => clearTimeout(t);
  }, [messages]);

  return (
    <div className="dm-overlay">
      {flying.map(({ key, d, track }) => (
        <div key={key} className="dm-fly" style={{ top: `${8 + track * 16}%`, animationDuration: `${DURATION_MS}ms` }}>
          {d.badge === ANNIVERSARY_BADGE && <i className="dm-badge" />}
          <span className="dm-tag" style={{ color: danmakuColor(d) }}>{identityTag(d)}</span>
          <span className="dm-school">{d.schoolName}</span>
          <span className="dm-nick" style={{ color: danmakuColor(d) }}>{d.nickname}</span>
          <span className="dm-text">{d.text}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: 实现 `src/components/DanmakuOverlay.css`**

```css
.dm-overlay { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.dm-fly {
  position: absolute; left: 100%; white-space: nowrap;
  font-size: 15px; text-shadow: 0 1px 3px rgba(0,0,0,.9);
  animation-name: dm-move; animation-timing-function: linear; animation-fill-mode: forwards;
  display: inline-flex; align-items: center; gap: 6px;
}
@keyframes dm-move { from { transform: translateX(0); } to { transform: translateX(-220vw); } }
.dm-badge { width: 16px; height: 16px; border-radius: 4px; background: linear-gradient(135deg,#ffd54a,#ff8a00); display: inline-block; }
.dm-school { color: #9cc3ff; }
.dm-text { color: #fff; }
```

- [ ] **Step 3: 类型检查 + 提交**

Run: `npx tsc --noEmit`
Expected: 无错误。
```bash
git add src/components/DanmakuOverlay.tsx src/components/DanmakuOverlay.css
git commit -m "feat: flying danmaku overlay"
```

---

### Task 6.7: `QualityControls`

**Files:**
- Create: `src/components/QualityControls.tsx`

- [ ] **Step 1: 实现**

```tsx
import { QUALITY_LABELS, type QualityLabel } from '../config';

interface Props {
  mainQuality: QualityLabel;
  multiQuality: QualityLabel;
  onMain: (q: QualityLabel) => void;
  onMulti: (q: QualityLabel) => void;
}

function Select({ value, onChange }: { value: QualityLabel; onChange: (q: QualityLabel) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as QualityLabel)}>
      {QUALITY_LABELS.map((q) => <option key={q} value={q}>{q}</option>)}
    </select>
  );
}

export function QualityControls({ mainQuality, multiQuality, onMain, onMulti }: Props) {
  return (
    <>
      <span className="pill">主视角 <Select value={mainQuality} onChange={onMain} /></span>
      <span className="pill">多视角统一 <Select value={multiQuality} onChange={onMulti} /></span>
    </>
  );
}
```

- [ ] **Step 2: Commit**
```bash
git add src/components/QualityControls.tsx && git commit -m "feat: QualityControls"
```

---

### Task 6.8: `MainStage`（主视角 + overlay）

**Files:**
- Create: `src/components/MainStage.tsx`

- [ ] **Step 1: 实现**

```tsx
import type { Danmaku, StreamView } from '../types';
import type { QualityLabel } from '../config';
import { VideoPlayer } from './VideoPlayer';
import { DanmakuOverlay } from './DanmakuOverlay';

function srcFor(view: StreamView, q: QualityLabel) {
  return (view.sources.find((s) => s.label === q) ?? view.sources[0])?.src;
}

export function MainStage({ main, quality, messages }: { main: StreamView; quality: QualityLabel; messages: Danmaku[] }) {
  return (
    <div className="main-stage">
      <span className="main-res">主视角 {quality}</span>
      <VideoPlayer src={srcFor(main, quality)} muted={false} className="main-video" />
      <DanmakuOverlay messages={messages} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**
```bash
git add src/components/MainStage.tsx && git commit -m "feat: MainStage with danmaku overlay"
```

---

### Task 6.9: `LiveStage`（第一屏：三列 + 控制栏）

**Files:**
- Create: `src/components/LiveStage.tsx`

- [ ] **Step 1: 实现**

```tsx
import { useState } from 'react';
import type { Danmaku, Profile, ZoneCatalog } from '../types';
import type { QualityLabel } from '../config';
import { SideColumn } from './SideColumn';
import { MainStage } from './MainStage';
import { QualityControls } from './QualityControls';
import { DanmakuComposer } from './DanmakuComposer';

interface Props {
  catalog: ZoneCatalog;
  messages: Danmaku[];
  mainQuality: QualityLabel;
  multiQuality: QualityLabel;
  setMainQuality: (q: QualityLabel) => void;
  setMultiQuality: (q: QualityLabel) => void;
  profile: Profile;
  isComplete: boolean;
  onSend: (text: string) => Promise<void> | void;
  onEditIdentity: () => void;
}

export function LiveStage(p: Props) {
  const [enlargedId, setEnlargedId] = useState<string | null>(null);
  const toggle = (id: string) => setEnlargedId((cur) => (cur === id ? null : id));

  return (
    <section className="live-stage">
      <div className="stage-row">
        <SideColumn side="red" views={p.catalog.redViews} quality={p.multiQuality} enlargedId={enlargedId} onToggle={toggle} />
        <MainStage main={p.catalog.main} quality={p.mainQuality} messages={p.messages} />
        <SideColumn side="blue" views={p.catalog.blueViews} quality={p.multiQuality} enlargedId={enlargedId} onToggle={toggle} />
      </div>
      <div className="controls">
        <QualityControls mainQuality={p.mainQuality} multiQuality={p.multiQuality} onMain={p.setMainQuality} onMulti={p.setMultiQuality} />
        <DanmakuComposer profile={p.profile} isComplete={p.isComplete} onSend={p.onSend} onEditIdentity={p.onEditIdentity} />
        <span className="hint">点机位放大，再点缩回</span>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**
```bash
git add src/components/LiveStage.tsx && git commit -m "feat: LiveStage three-column layout + control bar"
```

---

### Task 6.10: `ReservedPanel` + `ChatSection`（第二屏）

**Files:**
- Create: `src/components/ReservedPanel.tsx`
- Create: `src/components/ChatSection.tsx`

- [ ] **Step 1: 实现 `ReservedPanel.tsx`**

```tsx
export function ReservedPanel() {
  return <div className="reserved-panel">左侧预留区（之后放点东西在这）</div>;
}
```

- [ ] **Step 2: 实现 `ChatSection.tsx`**

```tsx
import type { Danmaku, Profile } from '../types';
import { ReservedPanel } from './ReservedPanel';
import { ChatRoom } from './ChatRoom';

interface Props {
  zoneName: string; messages: Danmaku[]; profile: Profile; isComplete: boolean;
  onSend: (t: string) => Promise<void> | void; onEditIdentity: () => void;
}

export function ChatSection(p: Props) {
  return (
    <section className="chat-section">
      <ReservedPanel />
      <ChatRoom zoneName={p.zoneName} messages={p.messages} profile={p.profile} isComplete={p.isComplete} onSend={p.onSend} onEditIdentity={p.onEditIdentity} />
    </section>
  );
}
```

- [ ] **Step 3: Commit**
```bash
git add src/components/ReservedPanel.tsx src/components/ChatSection.tsx
git commit -m "feat: ChatSection (reserved + chatroom)"
```

---

## Phase 7 · 组装、主题、联机

### Task 7.1: `App` 组装 + 状态编排

**Files:**
- Create: `src/App.tsx`
- Modify: `src/main.tsx`（确保渲染 App + 引入 theme.css）

- [ ] **Step 1: 实现 `src/App.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react';
import type { ZoneCatalog } from './types';
import { fetchCatalog } from './data/catalog';
import { useProfile } from './hooks/useProfile';
import { useDanmaku, makeLiveConnFactory } from './hooks/useDanmaku';
import { usePauseOnHidden } from './hooks/usePauseOnHidden';
import { DEFAULT_MAIN_QUALITY, DEFAULT_MULTI_QUALITY, type QualityLabel } from './config';
import { LiveStage } from './components/LiveStage';
import { ChatSection } from './components/ChatSection';
import { IdentityEditor } from './components/IdentityEditor';

export default function App() {
  const [catalog, setCatalog] = useState<ZoneCatalog | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mainQuality, setMainQuality] = useState<QualityLabel>(DEFAULT_MAIN_QUALITY);
  const [multiQuality, setMultiQuality] = useState<QualityLabel>(DEFAULT_MULTI_QUALITY);
  const [editing, setEditing] = useState(false);
  const { profile, setProfile, isComplete } = useProfile();

  useEffect(() => { fetchCatalog().then(setCatalog).catch((e) => setErr(String(e))); }, []);

  const connFactory = useMemo(
    () => (catalog ? makeLiveConnFactory(catalog.chatRoomId) : null),
    [catalog],
  );

  if (err) return <div className="fatal">加载失败：{err}</div>;
  if (!catalog || !connFactory) return <div className="loading">连接当前直播赛区…</div>;
  return <Live catalog={catalog} connFactory={connFactory}
    mainQuality={mainQuality} multiQuality={multiQuality}
    setMainQuality={setMainQuality} setMultiQuality={setMultiQuality}
    profile={profile} setProfile={setProfile} isComplete={isComplete}
    editing={editing} setEditing={setEditing} />;
}

function Live(props: any) {
  const { catalog, connFactory } = props;
  const { messages, connected, send } = useDanmaku(connFactory);
  usePauseOnHidden();
  const onSend = (text: string) => send(text, props.profile);
  return (
    <div className="app">
      {!connected && <div className="conn-status">弹幕连接中…</div>}
      <LiveStage catalog={catalog} messages={messages}
        mainQuality={props.mainQuality} multiQuality={props.multiQuality}
        setMainQuality={props.setMainQuality} setMultiQuality={props.setMultiQuality}
        profile={props.profile} isComplete={props.isComplete}
        onSend={onSend} onEditIdentity={() => props.setEditing(true)} />
      <ChatSection zoneName={catalog.zoneName} messages={messages}
        profile={props.profile} isComplete={props.isComplete}
        onSend={onSend} onEditIdentity={() => props.setEditing(true)} />
      {props.editing && (
        <IdentityEditor value={props.profile} onSave={props.setProfile} onClose={() => props.setEditing(false)} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: 更新 `src/main.tsx`**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './theme.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
);
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: Commit**
```bash
git add src/App.tsx src/main.tsx && git commit -m "feat: App orchestration (catalog + danmaku + layout)"
```

---

### Task 7.2: 主题样式 `src/theme.css`

**Files:**
- Create: `src/theme.css`

- [ ] **Step 1: 写 RM 黑色电竞调 + 布局（三列 + 第二屏）**

```css
:root { --bg:#0f1217; --panel:#1c2026; --line:#3a3f47; --red:#ff3b4e; --blue:#3b82f6; --accent:#ffd54a; --ink:#e8eaed; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font-family: system-ui, "Microsoft YaHei", sans-serif; }
.app { display:flex; flex-direction:column; }

/* 第一屏 */
.live-stage { min-height:100vh; padding:10px; }
.stage-row { display:flex; gap:8px; height:78vh; }
.side-column { width:160px; display:flex; flex-direction:column; gap:6px; }
.view-tile { position:relative; flex:1; padding:0; border:1px solid var(--line); border-radius:6px; overflow:hidden; background:#000; cursor:pointer; transition:transform .15s; }
.view-tile.red { border-left:3px solid var(--red); }
.view-tile.blue { border-right:3px solid var(--blue); }
.view-tile.enlarged { transform:scale(1.8); z-index:20; }
.view-tile-video { width:100%; height:100%; object-fit:cover; display:block; }
.view-tile-label { position:absolute; left:4px; bottom:3px; font-size:11px; background:rgba(0,0,0,.55); padding:1px 5px; border-radius:3px; }
.main-stage { flex:1; position:relative; border:1px solid var(--line); border-radius:8px; overflow:hidden; background:#000; }
.main-video { width:100%; height:100%; object-fit:contain; background:#000; }
.main-res { position:absolute; top:6px; left:8px; z-index:5; font-size:12px; color:var(--accent); background:rgba(0,0,0,.5); padding:1px 8px; border-radius:4px; }

/* 控制栏 */
.controls { display:flex; gap:10px; align-items:center; margin-top:10px; flex-wrap:wrap; }
.pill { background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:4px 9px; font-size:13px; }
.pill select { background:transparent; color:var(--accent); border:none; font-weight:700; }
.composer { display:flex; align-items:center; gap:6px; flex:1; min-width:320px; background:#0f141c; border:1px solid var(--accent); border-radius:8px; padding:3px 4px 3px 8px; }
.id-chip { background:#16202e; border:1px solid var(--line); border-radius:5px; color:#cfe3ff; font-size:12px; padding:3px 8px; cursor:pointer; display:flex; align-items:center; gap:4px; }
.chip-badge,.msg-badge { width:12px; height:12px; border-radius:3px; background:linear-gradient(135deg,#ffd54a,#ff8a00); display:inline-block; }
.composer-input { flex:1; background:transparent; border:none; color:var(--ink); font-size:14px; outline:none; }
.send-btn { background:var(--accent); color:#1a1a1a; font-weight:700; border:none; border-radius:5px; padding:5px 14px; cursor:pointer; }
.hint { color:#9aa0a6; font-size:12px; }

/* 第二屏 */
.chat-section { min-height:100vh; display:flex; gap:10px; padding:14px; }
.reserved-panel { flex:1; border:1.5px dashed var(--line); border-radius:8px; display:flex; align-items:center; justify-content:center; color:#9aa0a6; }
.chatroom { width:340px; display:flex; flex-direction:column; background:#15181e; border:1px solid var(--line); border-radius:8px; padding:10px; }
.chatroom-title { font-size:13px; color:#9aa0a6; border-bottom:1px solid var(--line); padding-bottom:6px; margin-bottom:6px; }
.chatroom-list { flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:5px; }
.chatroom .composer { margin-top:8px; }

/* 弹幕条 */
.msg-item { font-size:13px; line-height:1.5; }
.msg-name { display:inline-flex; align-items:center; gap:4px; margin-right:6px; font-weight:600; }
.msg-tag { font-size:11px; border:1px solid currentColor; border-radius:4px; padding:0 4px; opacity:.9; }
.msg-school { color:#9cc3ff; font-size:12px; }
.msg-text { color:var(--ink); }

/* 身份编辑器 */
.id-editor-backdrop { position:fixed; inset:0; background:rgba(0,0,0,.6); display:flex; align-items:center; justify-content:center; z-index:50; }
.id-editor { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:18px; width:300px; display:flex; flex-direction:column; gap:10px; }
.id-editor label { display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:13px; }
.id-editor input,.id-editor select { background:#0f141c; border:1px solid var(--line); color:var(--ink); border-radius:5px; padding:4px 6px; }
.id-editor-actions { display:flex; justify-content:flex-end; gap:8px; }
.id-editor .primary { background:var(--accent); color:#1a1a1a; font-weight:700; border:none; border-radius:5px; padding:5px 12px; }
.loading,.fatal { padding:40px; text-align:center; color:#9aa0a6; }
```

- [ ] **Step 2: Commit**
```bash
git add src/theme.css && git commit -m "style: RM dark esports theme + layout"
```

---

### Task 7.3: 全量测试 + 类型 + 构建

- [ ] **Step 1: 跑全部单测**

Run: `npm run test`
Expected: 全绿（danmaku / catalog / useProfile / useDanmaku / MessageItem / DanmakuComposer / ViewTile）。

- [ ] **Step 2: 类型检查 + 构建**

Run: `npx tsc --noEmit && npm run build`
Expected: 构建成功，无类型错误。

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "test: green suite + production build"
```

---

### Task 7.4: 联机冒烟（有直播时）

> 无法自动化（赛季性 + 需真实媒体）。人工执行。

- [ ] **Step 1: 启动 dev**

Run: `npm run dev`，浏览器打开 `http://localhost:5173`。

- [ ] **Step 2: 验收清单**
  - [ ] 自动连到 `liveState===1` 赛区，顶部显示赛区名。
  - [ ] 主视角播放（含解说音），左右各 5 路机位同时播放。
  - [ ] 切主视角清晰度（1080/720/540）→ 主视角换源；切多视角清晰度 → 10 路统一换源。
  - [ ] 点机位 → 放大；再点 → 缩回。
  - [ ] 主视角上飞屏弹幕滚动，老队员金色 / 队员·校友红色，徽章/学校/身份/正文正确。
  - [ ] 下滚到第二屏：聊天室列表实时更新，自动滚到底。
  - [ ] 首次点发送 → 弹身份编辑器；填昵称/学校/身份/年限/徽章 → 保存（刷新后仍在）。
  - [ ] 发送一条 → 本地立即出现在列表与飞屏（乐观插入）。
  - [ ] 断网/恢复 → 不崩；视频 tile 错误能恢复（hls 自恢复）。

- [ ] **Step 3: 记录问题，按需回到对应 Task 修复。**

---

### Task 7.5: 发送失败提示 + 连接状态样式（spec §10）

**Files:**
- Modify: `src/components/DanmakuComposer.tsx`（发送失败时内联提示，不静默吞掉）
- Modify: `src/theme.css`（追加 `.conn-status` / `.composer-error`）

- [ ] **Step 1: 在 `DanmakuComposer` 的 `submit` 增加错误捕获与提示**

将 `submit` 改为：

```tsx
const [err, setErr] = useState<string | null>(null);

async function submit() {
  if (!isComplete) { onEditIdentity(); return; }
  const t = text.trim();
  if (!t || busy) return;
  setBusy(true); setErr(null);
  try { await onSend(t); setText(''); }
  catch (e) { setErr('发送失败：' + (e instanceof Error ? e.message : String(e))); }
  finally { setBusy(false); }
}
```

并在返回的 JSX 末尾（`</div>` 前）加上：

```tsx
{err && <span className="composer-error" role="alert">{err}</span>}
```

- [ ] **Step 2: 追加样式到 `src/theme.css`**

```css
.conn-status { background:#3a2a00; color:var(--accent); text-align:center; padding:4px; font-size:12px; }
.composer-error { color:#ff8a8a; font-size:11px; margin-left:6px; }
```

- [ ] **Step 3: 跑相关测试 + 类型检查**

Run: `npx vitest run src/components/DanmakuComposer.test.tsx && npx tsc --noEmit`
Expected: PASS（既有用例不受影响）、无类型错误。

- [ ] **Step 4: Commit**
```bash
git add src/components/DanmakuComposer.tsx src/theme.css
git commit -m "feat: surface send errors + connection status"
```

---

## 备注

- **赛季性**：非直播期 `liveState===1` 可能不存在，`fetchCatalog` 会抛错 → App 显示"加载失败"。可加一个"无正在直播的赛区"友好态（YAGNI，按需）。
- **客户端密钥/会话**集中在 `src/config.ts` 与 `live_game_info.json`，随赛季更新只改一处。
- **手动切赛区**（覆盖自动）为可选增强：将 `parseLiveGameInfo` 扩展为返回全部赛区 + 让用户选，未列入本计划（按需再开任务）。
