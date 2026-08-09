# 沙盘网格拖拽换位修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让沙盘网格中的多路直播瓦片以“跨越格中心才换位”的规则流畅、可逆且可取消地重排，并保持经典布局不受影响。

**Architecture:** 保留 `StageGrid` 为唯一的专用拖拽实现，不引入 overlay 或第三方 DnD 库。一次 pointer 手势使用 ref 持有当前顺序和最新坐标，以 rAF 限制视觉更新；排序提交前后通过 DOM FLIP 使非拖动瓦片连续让位。React 仍是顺序的唯一权威来源，拖拽 ref 仅消除事件闭包过期。

**Tech Stack:** React 19、TypeScript、CSS Grid/CSS transforms、Vitest、Testing Library、Vite。

## Global Constraints

- 不引入 dnd-kit 或其他第三方拖拽依赖。
- 不复制、portal 或 overlay `VideoPlayer`；视频 keyed DOM 节点必须复用。
- `wings` 布局不得新增监听器、运行时行为或首屏依赖。
- 换位阈值为被拖动瓦片中心沿目标方向走过两格中心距离的 **60%**；换位后反向同样走过 60%，形成 20% 格距的稳定滞回区，而不是指针刚进入目标格或拖到目标中心。
- 拖动瓦片只写 `translate3d`，且拖动中不带 transition。
- 非拖动瓦片的 FLIP 只动画 `transform`，使用 `180ms cubic-bezier(0.77, 0, 0.175, 1)`。
- `prefers-reduced-motion` 下跳过自动 FLIP 位移，保留直接拖动与顺序改变。
- 不 commit/push，除非用户之后明确要求。

---

## 文件结构

- 修改 `src/components/StageGrid.tsx`
  - 建立拖拽会话 ref、中心阈值命中、rAF 合帧、Pointer Capture/cancel 清理。
  - 为已渲染瓦片维护稳定 DOM ref，并在顺序变更时安排 FLIP。
- 修改 `src/components/StageGrid.test.tsx`
  - 创建可控 `order` 的测试宿主和确定尺寸的 DOMRect mock，验证交互语义与取消路径。
- 修改 `src/theme.css`
  - 将默认瓦片 transform transition 调整为 FLIP 专用曲线和时长；保留 reduced-motion 规则。

## Task 1: 中心阈值、可逆顺序与指针生命周期

**Files:**
- Modify: `src/components/StageGrid.tsx:39-50, 176-217, 281-325`
- Modify: `src/components/StageGrid.test.tsx:1-32`

**Interfaces:**
- Consumes: `move<T>(order: readonly T[], from: number, to: number): T[]` from `src/stage/viewOrder.ts`.
- Produces: `StageGrid` 在 `onReorder(next: string[])` 中按最新拖拽会话顺序发出插入式重排；原有 props 形状不变。

- [ ] **Step 1: 写入失败的中心阈值和回退回归测试**

在 `StageGrid.test.tsx` 添加一个 stateful `GridHarness`，为 3 路测试 view 传入 `order`，其 `onReorder` 调用自身 `setOrder`。mock `.sg-tiles` 为 `left=0, top=0, width=326, height=180`，三个 tile 的 rect 分别为 `0..100`、`106..206`、`212..312`，对应一行三格、6px gap、100px 宽高。

使用 `fireEvent.pointerDown(tileA, { pointerId: 1, button: 0, clientX: 50, clientY: 50 })`；随后发送原生 `window.dispatchEvent(new PointerEvent('pointermove', ...))`，并 stub `requestAnimationFrame` 为立即回调。

添加如下测试：

```tsx
it('waits until the dragged tile center crosses a target center', () => {
  // A 的抓取点为中心，clientX=150 时 A 的视觉中心仍为 150，
  // 未跨 B 的中心 156；不应重排。
  movePointer(150, 50);
  expect(orderText()).toBe('a,b,c');

  // clientX=157 时视觉中心跨 B 的中心；应插入到 B 后。
  movePointer(157, 50);
  expect(orderText()).toBe('b,a,c');
});

it('restores the original order when one drag crosses forward then backward', () => {
  beginDragA();
  movePointer(157, 50);
  expect(orderText()).toBe('b,a,c');
  movePointer(49, 50);
  expect(orderText()).toBe('a,b,c');
});
```

- [ ] **Step 2: 运行测试确认红灯**

Run:

```powershell
npx vitest run src/components/StageGrid.test.tsx --maxWorkers=1
```

Expected: 新增“目标中心前不换位”或“向回拖仍保持 b,a,c”断言失败；现有实现按进入格立即换位，并读取 pointerdown 时的旧 `order`。

- [ ] **Step 3: 建立拖拽会话并实现 rAF 驱动的中心命中**

在 `StageGrid.tsx` 将当前 `DragState` 分成：供渲染使用的 `drag` state，和供事件路径使用的 `dragSession` ref。定义并使用如下形状：

```ts
interface TileDragSession {
  id: string;
  pointerId: number;
  tile: HTMLElement;
  startX: number;
  startY: number;
  grabX: number;
  grabY: number;
  originX: number;
  originY: number;
  width: number;
  height: number;
  currentOrder: string[];
  x: number;
  y: number;
  moved: boolean;
  frame: number | null;
}
```

在 `onPointerDown` 中以当时的 `order` 初始化 `currentOrder`。`pointermove` 只更新 `x/y` 并在 `frame === null` 时请求一个 rAF。rAF 回调：

1. 用 Manhattan 位移比较 `DRAG_THRESHOLD`；首次越过阈值时调用 `tile.setPointerCapture(pointerId)`，并标记 `moved=true`。
2. 计算拖动瓦片视觉中心：

```ts
const centerX = session.x - session.grabX + session.width / 2;
const centerY = session.y - session.grabY + session.height / 2;
```

3. 沿「当前格中心 → 候选格中心」计算拖动中心的投影；投影达到中心距的 **60%** 才重排。换位后当前中心随顺序更新，反向同样要求 60%，两次门槛之间形成 20% 格距的稳定滞回区。
4. 以 `from = session.currentOrder.indexOf(session.id)` 计算新顺序，随后**先**写 `session.currentOrder = next`，再调用 `onReorder(next)`。
5. 以最新 pointer 坐标更新 `setDrag(...)`，由既有内联 transform 绘制拖动瓦片。

保留未超过阈值时 `pointerup` 的点击选择逻辑。计算命中时，使用每个 tile 的实际 `DOMRect` 中点优先匹配；如果目标不在可见 tile map 中，不重排。这样不会被 `justify-content:center` 的横向留白误导。

- [ ] **Step 4: 增加 Pointer Capture/cancel 失败测试**

在同一测试文件扩展 DOM API mock：

```tsx
Object.defineProperty(tileA, 'setPointerCapture', { value: setCapture });
Object.defineProperty(tileA, 'releasePointerCapture', { value: releaseCapture });
Object.defineProperty(tileA, 'hasPointerCapture', { value: () => true });
```

添加：

```tsx
it('captures after crossing the drag threshold and clears state on pointercancel', () => {
  beginDragA();
  movePointer(61, 50); // 距起点 11px，开始拖动
  expect(setCapture).toHaveBeenCalledWith(1);
  expect(tileA).toHaveClass('dragging');

  fireEvent.pointerCancel(tileA, { pointerId: 1 });
  expect(releaseCapture).toHaveBeenCalledWith(1);
  expect(tileA).not.toHaveClass('dragging');
});
```

- [ ] **Step 5: 为所有终止路径接入统一 cleanup**

在 `StageGrid.tsx` 定义 `finishTileDrag(cancelled: boolean)`，它：

```ts
if (session.frame !== null) cancelAnimationFrame(session.frame);
if (session.tile.hasPointerCapture?.(session.pointerId)) {
  session.tile.releasePointerCapture(session.pointerId);
}
dragSession.current = null;
setDrag(null);
```

`pointerup` 先判断 `moved`：未移动才调用 `onSelect`，然后 cleanup；`pointercancel` 不调用 `onSelect`，直接 cleanup。将事件监听改为 `pointermove`、`pointerup` 和 `pointercancel` 均绑定在 window，避免 capture 实现差异造成漏收尾；组件卸载 effect 也调用同一 cleanup。

- [ ] **Step 6: 运行针对性测试确认绿灯**

Run:

```powershell
npx vitest run src/components/StageGrid.test.tsx --maxWorkers=1
```

Expected: 全部 `StageGrid` 测试通过，特别是中心阈值、`A → B → A` 和 pointer cancel 场景。

## Task 2: FLIP 让位动画与减弱动效

**Files:**
- Modify: `src/components/StageGrid.tsx:1, 81-100, 176-217, 281-325`
- Modify: `src/theme.css:93-100, 137-140`
- Modify: `src/components/StageGrid.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 `dragSession.currentOrder` 与现有 `drag` render state。
- Produces: 非拖动 `.sg-tile` 在 `order` 改变后以 inline FLIP transform 让位；`prefersReducedMotion()` 为 true 时不设置该动画。

- [ ] **Step 1: 写入失败的 FLIP 测试**

通过测试 helper 为 `data-view-id="b"` 返回不同 rect：初始 `{ left: 106, top: 0 }`，更新 order 后 `{ left: 0, top: 0 }`。让 rAF mock 变为可控队列，分别 flush React 提交前后所需帧。

加入：

```tsx
it('inverts a displaced non-dragged tile before playing its FLIP transition', async () => {
  beginDragA();
  movePointer(157, 50);
  const tileB = screen.getByRole('button', { name: viewB.role });

  // React 提交后的 layout effect 先把 B 拉回旧位置。
  expect(tileB.style.transform).toBe('translate3d(106px, 0px, 0)');
  expect(tileB.style.transition).toContain('180ms');

  flushAnimationFrame();
  expect(tileB.style.transform).toBe('');
});
```

- [ ] **Step 2: 运行测试确认红灯**

Run:

```powershell
npx vitest run src/components/StageGrid.test.tsx --maxWorkers=1
```

Expected: `tileB.style.transform` 为空；现有 CSS Grid 重排没有 FLIP 反向位移。

- [ ] **Step 3: 实现瓦片 ref 与 FLIP 生命周期**

在组件中添加：

```ts
const tileNodes = useRef(new Map<string, HTMLDivElement>());
const flipFrom = useRef(new Map<string, DOMRect>());
const flipFrame = useRef<number | null>(null);
```

为每个 tile 使用 callback ref：节点存在时写 `tileNodes.current.set(id, node)`，卸载时删除。

在 rAF 确认需要重排前，读取所有 `tileNodes.current` 中非 `session.id` 的 `getBoundingClientRect()` 到 `flipFrom`。使用 `useLayoutEffect`（从 React import）观察 `order` 与 `drag?.id`：

1. 若 `flipFrom` 为空，直接返回；
2. 对每个原 rect 找到同 id 的新节点和 `nextRect`；求 `dx = old.left - next.left`、`dy = old.top - next.top`；跳过 `dx === 0 && dy === 0`；
3. 写 `node.style.transition = 'none'`、`node.style.transform = \`translate3d(${dx}px, ${dy}px, 0)\``；
4. 强制一次 `node.getBoundingClientRect()` 使反向起点提交；
5. 在唯一 `requestAnimationFrame` 中对这些节点写 `node.style.transition = 'transform 180ms cubic-bezier(0.77, 0, 0.175, 1)'`，`node.style.transform = ''`；
6. 清空 `flipFrom`。在 effect cleanup/组件卸载时取消未执行的 `flipFrame`，并只清理由该 FLIP 写入的 inline transform/transition。

在调用 `onReorder(next)` 前必须先捕获 `flipFrom`，保证 React render 前的 rect 真实存在。永远不对拖动 id 捕获或写 FLIP transform。

- [ ] **Step 4: 接入 reduced motion 并更新 CSS 基线**

若 `prefersReducedMotion()` 为 true，不捕获 rect，也不运行 FLIP effect。更新 `.sg-tile` 的默认 transition，移除其 `transform` 项，只保留：

```css
transition: box-shadow .15s ease, border-color .15s ease;
```

这是必要的职责划分：静态 CSS 只负责状态色彩，动态的排序位移只由 JS FLIP 以精确时长/曲线负责。保留：

```css
@media (prefers-reduced-motion: reduce) {
  .sg-tile { transition:none; }
}
```

- [ ] **Step 5: 运行 FLIP 与回归测试确认绿灯**

Run:

```powershell
npx vitest run src/components/StageGrid.test.tsx src/stage/viewOrder.test.ts --maxWorkers=1
```

Expected: StageGrid 中心阈值、调头、取消、FLIP、无障碍名称，以及 viewOrder 工具测试全部通过。

## Task 3: 完整静态检查、构建与真实浏览器验收

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes: Task 1–2 的完成实现。
- Produces: 可交互 Vite 预览和命令输出证据。

- [ ] **Step 1: 运行类型检查与 lint**

Run:

```powershell
npx tsc -b
npx eslint src/components/StageGrid.tsx src/components/StageGrid.test.tsx
```

Expected: 两条命令 exit 0。

- [ ] **Step 2: 运行全量测试与生产构建**

Run:

```powershell
npm test -- --maxWorkers=1
npm run build
```

Expected: 所有测试通过、build exit 0；如有既存 Vite chunk-size warning，记录但不把它当成失败。

- [ ] **Step 3: 启动 Vite 并在浏览器手动验收**

Run:

```powershell
npm run dev -- --host 127.0.0.1
```

在浏览器打开启动输出中的 localhost 地址，切换到“沙盘布局”，检查：

1. 拖动某瓦片未越过相邻格中心时，其他瓦片不动；
2. 越过中心后，其他瓦片以约 180ms 连续让位；
3. 反向越回中心后顺序立即恢复；
4. 瓦片从边缘抓起仍维持抓取点而非跳到指针中心；
5. 取消触摸/指针后没有残留 grabbing 样式；
6. 切回“经典布局”后无网格节点且直播主界面正常。

- [ ] **Step 4: 截取预览证据并报告**

使用浏览器截图保存为 worktree 根目录下 `preview-grid-drag-reorder.png`。向用户报告截图路径、可访问预览 URL、通过的测试命令与任何无法在真实数据上覆盖的限制；不要执行 git commit 或 git push。
