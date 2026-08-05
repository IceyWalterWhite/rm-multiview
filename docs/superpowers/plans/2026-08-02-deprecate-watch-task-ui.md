# Deprecate Watch-Task Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the viewing-time/pellet presentation and active heartbeat from the current product while preserving the voting bridge and enough login probing for vote gating.

**Architecture:** `Live` will keep `useWatchTask` only as a hidden official-login probe, explicitly disable its heartbeat behavior, and pass its `loggedIn` result to `useCheer`. The WatchTaskCapsule and demo fixture will remain in the repository but will be marked deprecated and no longer mounted. Documentation will distinguish active popularity voting from the paused watch-task design.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library.

## Global Constraints

- Preserve `CheerBar`, `useCheer`, `officialBridge`, and the `vote` userscript action.
- Do not send a `heartbeat` from `App` while the watch-task design is deprecated.
- Preserve current login detection through `getWatchProgress`; `canVote` must still require logged-in state.
- Do not delete watch-task implementation or tests; mark it as deprecated for redesign.
- Do not commit, merge, or push this work unless separately requested.

---

### Task 1: Disable heartbeat while retaining vote login probing

**Files:**
- Modify: `src/hooks/useWatchTask.ts`
- Modify: `src/hooks/useWatchTask.test.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `WatchTaskDeps.bridge`, `WatchTaskDeps.catalog`, `WatchTaskDeps.mainPlaying`.
- Produces: `WatchTaskDeps.heartbeatEnabled?: boolean`; `false` means progress may load but `bridge.request('heartbeat', ...)` must never run.

- [x] **Step 1: Write the failing test**

```ts
it('keeps the official login probe but sends no heartbeat when heartbeatEnabled is false', async () => {
  const request = vi.fn(async () => ({ accumulatedSeconds: 900, tiers: RAW_TIERS }))
    as unknown as OfficialBridgeApi['request'];
  const { result } = renderHook(() => useWatchTask(deps({
    bridge: bridge(request),
    catalog: catalog(),
    mainPlaying: true,
    heartbeatEnabled: false,
    heartbeatMs: 5_000,
  })));
  await settle();
  await advance(30_000);
  expect(result.current.loggedIn).toBe(true);
  expect((request as ReturnType<typeof vi.fn>).mock.calls.some(([action]) => action === 'heartbeat')).toBe(false);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cmd /c npm test -- src/hooks/useWatchTask.test.ts`

Expected: the test fails because `heartbeatEnabled` is not honored and a heartbeat is sent.

- [x] **Step 3: Write minimal implementation**

```ts
export interface WatchTaskDeps {
  // existing fields
  heartbeatEnabled?: boolean;
}

const { heartbeatEnabled = true } = deps;
const heartbeatEligible = Boolean(
  heartbeatEnabled
  && enabled
  // existing official gates
);
```

Update `Live` to call `useWatchTask({ enabled: !injected, bridge, heartbeatEnabled: false })` and continue to pass only `watch.loggedIn` into `useCheer`.

- [x] **Step 4: Run test to verify it passes**

Run: `cmd /c npm test -- src/hooks/useWatchTask.test.ts src/hooks/useCheer.test.ts`

Expected: all selected tests pass and no test observes a heartbeat with `heartbeatEnabled: false`.

### Task 2: Disconnect and label the presentation

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/LiveStage.tsx`
- Modify: `src/demo/DemoApp.tsx`
- Modify: `src/components/WatchTaskCapsule.tsx`
- Modify: `src/hooks/useWatchTask.ts`
- Modify: `public/rmlive-companion.user.js`

**Interfaces:**
- Consumes: `LiveProps.cheerSlot`.
- Produces: no production or demo render path for `WatchTaskCapsule` or `watchTaskSlot`; retained components/functions carry explicit `@deprecated` comments.

- [x] **Step 1: Write the failing test**

```ts
it('does not render the deprecated viewing-time capsule in the live app', () => {
  mockState.current = { status: 'live', catalog: liveCatalog };
  render(<App />);
  expect(screen.queryByText(/观看时长 · 弹丸/)).not.toBeInTheDocument();
  expect(screen.queryByText(/登录领弹丸/)).not.toBeInTheDocument();
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cmd /c npm test -- src/App.test.tsx`

Expected: it fails because `Live` currently mounts `WatchTaskCapsule` into `LiveStage`.

- [x] **Step 3: Write minimal implementation**

```tsx
// App.tsx
const loginProbe = useWatchTask({ enabled: !injected, bridge, heartbeatEnabled: false });
const cheer = useCheer(catalog, { enabled: !injected, bridge, loggedIn: loginProbe.loggedIn });

// Do not create a WatchTaskCapsule or pass watchTaskSlot to LiveStage.
```

Remove the `watchTaskSlot` prop from `LiveProps` and `LiveStage`, remove its demo fixture, and add `@deprecated` documentation to the retained capsule, heartbeat code, and script heartbeat branch.

- [x] **Step 4: Run test to verify it passes**

Run: `cmd /c npm test -- src/App.test.tsx src/demo/DemoApp.test.tsx src/components/WatchTaskCapsule.test.tsx`

Expected: all existing and new presentation tests pass; the demo has no pellet capsule.

### Task 3: Mark product documentation and validate the reduced preview

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-01-cheer-and-watchtask-design.md`

**Interfaces:**
- Consumes: active `vote` bridge and paused watch-task implementation.
- Produces: docs that call popularity voting active and viewing-time UI/heartbeat deprecated pending redesign.

- [x] **Step 1: Update documentation**

State that the companion script remains for official voting, while the viewing-time/pellet presentation and heartbeat dispatch are disabled pending a new UX design. Keep the privacy and fixed-domain permission explanation intact.

- [x] **Step 2: Verify quality gates**

Run:

```text
cmd /c npm test
cmd /c npm run build
cmd /c npm run lint
```

Expected: all tests pass, TypeScript build succeeds, and ESLint reports no errors.
