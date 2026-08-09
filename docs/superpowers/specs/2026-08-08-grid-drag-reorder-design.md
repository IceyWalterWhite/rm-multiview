# 沙盘网格拖拽换位修复设计

**日期：** 2026-08-08
**范围：** `StageGrid` 的网格布局多路视角拖动换位。经典 `wings` 布局不挂载该组件，行为与首屏包体均不改变。

## 目标

将多路视频瓦片的拖拽重排做成连续、可逆、可取消的手势：

- 拖动瓦片的中心沿目标格方向走过两格中心距的 **60%** 才触发插入式重排；换位后反向也需走过 60%，两阈值之间自然保留 20% 格距的稳定区。
- 一次拖动中来回穿过同一中心，顺序可立即恢复；绝不使用按下时过期的 `order`。
- 非拖动瓦片在重排时平滑让位，而不是 CSS Grid 瞬移。
- 指针离开原瓦片、系统取消触摸或窗口失焦时都能结束拖动，不遗留视觉状态。
- 直播解码中的视频节点始终原地复用，不复制视频，也不移入 overlay。

## 实现方案

### 1. 拖拽会话与输入节流

在 `StageGrid` 中建立仅覆盖一次 pointer 手势的 ref 会话，保存：

- `pointerId`、抓取点相对瓦片左上角的偏移、机位区起点；
- 最新指针坐标；
- `currentOrder`（每次重排后立即更新）；
- 唯一的 `requestAnimationFrame` 句柄；
- 是否已超过 10px 拖动阈值。

`pointermove` 只记录最新坐标并请求一个 rAF。每个动画帧至多写一次拖动状态/变换。仅当拖动瓦片的视觉中心沿当前格→目标格方向走过两格中心距离的 **60%**，才根据 `currentOrder` 调用 `move()` 并通知上层 `onReorder(next)`；换位后反向也采用 60%，留下 20% 的稳定区。

达到拖动阈值时，对原瓦片调用 `setPointerCapture(pointerId)`。`pointerup` 与 `pointercancel` 共享 cleanup：取消 rAF、释放 pointer capture（仍持有时）、清理拖动状态。未超过阈值的 `pointerup` 保持原有点选/取消选中语义。

### 2. FLIP 让位动画

顺序提交前量取非拖动瓦片的 `DOMRect`；React 提交新 `order` 后，在 layout effect 量取新位置：

1. 给每个位置改变的非拖动节点设置反向 `translate3d(dx, dy, 0)`，不带 transition；
2. 下一帧清空该 transform；
3. 节点以 `180ms cubic-bezier(0.77, 0, 0.175, 1)` 连续移动到新的 Grid 格位。

正在拖动的瓦片继续用无 transition 的 `translate3d` 1:1 跟手，尊重抓取偏移。`prefers-reduced-motion` 时跳过让位 FLIP，仍保留拖动和最终顺序，以消除自动位移但不牺牲直接操作反馈。

### 3. DOM 与组件边界

不引入 dnd-kit、overlay 或 portal；保留每个 `VideoPlayer` 的同一 keyed DOM 节点，从而避免 HLS 视频复制、黑帧和重复的无障碍节点。

为已渲染格子添加稳定 ref 记录，FLIP 只操作发生重排的非拖动瓦片。渲染层仍由 `shown`、`order` 与 `GridPlan` 推导，不额外保留一个与 React state 竞争的显示顺序副本。

## 验证

扩展 `StageGrid.test.tsx`：

1. 未达到目标方向 60% 距离不调用 `onReorder`；
2. 达到 60% 后按插入语义发出新顺序；
3. 换位后的 20% 滞回稳定区内不反向重排，跨过反向 60% 门槛后才恢复；
3. `A → B → A` 在同一次拖动中恢复原顺序；
4. 小幅移动保留点击选择；
5. `pointercancel` 后清理拖动状态，后续点击仍可用。

运行相关 Vitest、TypeScript 检查、生产构建；随后启动 Vite，在浏览器中进行真实指针拖拽，验证 60% 阈值、FLIP 让位、反向滞回、取消、减弱动效与经典布局未受影响。

## 非目标

- 不改变 `wings` 布局、沙盘固定到上方的 `swap()` 语义或流同步。
- 不重构分隔条拖拽。
- 不引入第三方拖拽依赖。
- 不提交或推送变更，除非用户之后明确提出。
