# Retire Full Demo UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the main-branch live layout and reduce `?demo` to a read-only human-popularity-bar preview, while keeping official vote functionality.

**Architecture:** The production `App` continues to own `useCheer` and injects only `CheerBar` into `MainStage`. Demo mode no longer reuses `Live`, fake catalog data, fake feeds, fake chat, or state-switching UI. The shared stage and player return to their main-branch layout except for the minimal bottom-of-main-stage structure required to host `CheerBar`; legacy demo assets remain unmounted and explicitly deprecated.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library.

## Global Constraints

- Keep `CheerBar`, `useCheer`, official bridge, and vote userscript behavior intact.
- Do not re-enable the deprecated watch-time/heartbeat flow.
- Preserve the main-branch multi-view, chat, and controls layout; do not replace it with a new design.
- `?demo` must make no network calls and must not display fake video feeds, fake chat, demo state tabs, or the old viewing-time UI.
- Keep legacy demo source files for later redesign, but do not mount or import them from the active preview.
- Do not commit, merge, or push.

---

### Task 1: Make the active demo a cheer-bar-only preview

**Files:**
- Create: `src/demo/DemoApp.test.tsx`
- Modify: `src/demo/DemoApp.tsx`
- Modify: `src/main.tsx`
- Modify: `src/demo/demo.css`
- Modify: `src/demo/demoData.ts`
- Modify: `src/demo/demoState.ts`

**Interfaces:**
- Consumes: `demoCheer` and `CheerBarProps`.
- Produces: `DemoApp` renders exactly a `group[aria-label="人气助威"]`; its previous query value remains accepted as an optional `string` prop for backward-compatible URLs and does not change the rendered preview.

- [x] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import DemoApp from './DemoApp';

it('renders only the popularity-bar preview', () => {
  const { container } = render(<DemoApp state="live" />);
  expect(screen.getByRole('group', { name: '人气助威' })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: '直播视角' })).not.toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: '演示状态切换' })).not.toBeInTheDocument();
  expect(container.querySelector('.demo-feed')).toBeNull();
  expect(container.querySelector('.chat-section')).toBeNull();
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cmd /c npm test -- src/demo/DemoApp.test.tsx`

Expected: FAIL because the current demo mounts the complete fake `Live` tree and demo state switcher.

- [x] **Step 3: Write minimal implementation**

```tsx
export default function DemoApp({ state: _state }: { state?: string }) {
  void _state; // Query values are retained only for old preview URLs.
  return (
    <CheerBar
      redVotes={demoCheer.baseRed}
      blueVotes={demoCheer.baseBlue}
      redLabel={demoCheer.redLabel}
      blueLabel={demoCheer.blueLabel}
      canVote={false}
      officialUrl={demoCheer.officialUrl}
    />
  );
}
```

Remove the `Live`, `OfflineView`, fake connection, fake title, fake video, fake chat, and state-switcher imports. Do not import `demo.css`. Add `@deprecated` comments to the unmounted fake-feed CSS, state parser, and fake-data exports. Keep the `main.tsx` query route but dynamically import only `DemoApp` and pass the original query as the compatibility prop:

```tsx
if (demoParam !== null) {
  void import('./demo/DemoApp').then(({ default: DemoApp }) => {
    root.render(<React.StrictMode><DemoApp state={demoParam} /></React.StrictMode>);
  });
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `cmd /c npm test -- src/demo/DemoApp.test.tsx src/demo/demoData.test.ts src/components/CheerBar.test.tsx`

Expected: PASS; no fake-live elements exist and the popularity bar remains visible.

### Task 2: Remove demo plumbing from shared production components

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/LiveStage.tsx`
- Modify: `src/components/MainStage.tsx`
- Modify: `src/components/MainStage.test.tsx`
- Modify: `src/components/VideoPlayer.tsx`
- Modify: `src/theme.css`

**Interfaces:**
- Consumes: live `CheerState` created inside `Live`.
- Produces: `LiveStage` accepts only `cheerSlot?: ReactNode` as the new display extension. It does not accept demo title injection or playback callbacks. `VideoPlayer` handles only real video sources.

- [x] **Step 1: Write the failing structural regression test**

Extend `src/demo/DemoApp.test.tsx` with:

```tsx
expect(container.querySelector('.demo-switcher')).toBeNull();
expect(container.querySelector('.video-wrap')).toBeNull();
```

Run: `cmd /c npm test -- src/demo/DemoApp.test.tsx`

Expected: FAIL before Task 1's implementation because the fake live stage includes both elements.

- [x] **Step 2: Restore the main-branch component surface**

```tsx
// App.tsx: keep cheer logic internal; do not export Live for the demo.
function Live(props: LiveProps) {
  // …useCheer and create cheerSlot…
  return <LiveStage {...stageProps} cheerSlot={cheerSlot} />;
}

// LiveStage.tsx: no titleFetcher, no onMainPlaybackStateChange, no toolbar ref.
const matchTitle = useMatchTitle(p.catalog.zoneName);
<MainStage {...mainProps} cheerSlot={p.cheerSlot} />;
```

Delete the `demo:` source parsing/render branch from `VideoPlayer`; remove playback-state propagation now that heartbeat is deprecated and delete the associated playback-event assertion from `MainStage.test.tsx`. Restore normal-flow controls and side-column sizing from `main` with these rules:

```css
.live-stage { height:100vh; height:100dvh; padding:10px; display:flex; flex-direction:column; gap:10px; }
.stage-row { position:relative; display:flex; gap:8px; flex:1; min-height:0; overflow:hidden; }
.side-column { position:relative; z-index:1; width:var(--side-col-w); flex:none; display:flex; flex-direction:column; gap:6px; }
.controls { display:flex; gap:10px; align-items:center; flex:none; flex-wrap:wrap; }
```

Keep only the compact `main-stage` flex/video wrapper rules that give `CheerBar` a real bottom slot; remove floating-toolbar, `--stage-reserve`, toolbar-height measurement, and demo-driven responsive visual changes. Retain `.sr-only` and the `.cheer*` styles because they are required by the active vote bar.

- [x] **Step 3: Mark the retired shared paths**

Add a short `@deprecated` comment to `src/demo/demo.css` and legacy fake fixture exports. Do not leave an active import or call path from `src/main.tsx`, `DemoApp`, `App`, `LiveStage`, `MainStage`, or `VideoPlayer` to those assets.

- [x] **Step 4: Run focused checks**

Run:

```text
cmd /c npm test -- src/demo/DemoApp.test.tsx src/App.test.tsx src/components/MainStage.test.tsx
cmd /c npm run lint
```

Expected: PASS. Search confirms no active `demo:` source parsing, `demo-switcher`, `titleFetcher`, or playback heartbeat wiring outside legacy demo files/tests.

### Task 3: Document the narrowed preview and run the complete gate

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-01-cheer-and-watchtask-design.md`

**Interfaces:**
- Consumes: active vote bridge and deprecated full-demo/watch-task source.
- Produces: documentation that identifies `?demo` as a cheer-bar-only preview and calls the full fake-live interface deprecated.

- [x] **Step 1: Update documentation**

State that the old `?demo=live|offline|loading|error` full fake-live experience is no longer mounted. `?demo` now exists only to inspect the human-popularity bar; production `main` layout remains the baseline. Keep the existing official-vote privacy and permission statements.

- [x] **Step 2: Verify quality gates**

Run:

```text
cmd /c npm test
cmd /c npm run build
cmd /c npm run lint
```

Expected: all tests pass, build succeeds, lint has no errors.

- [x] **Step 3: Visually verify the local demo**

Open `http://127.0.0.1:4179/?demo=live` and verify one `.cheer` element is present, while `.demo-feed`, `.demo-switcher`, `.watch-capsule`, and `.chat-section` are absent.
