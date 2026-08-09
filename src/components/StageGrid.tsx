import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { StreamView } from '../types';
import type { QualityLabel } from '../config';
import type { SyncEngine } from '../sync/engine';
import { VideoPlayer } from './VideoPlayer';
import { SyncBadge } from './SyncBadge';
import { sourceForQuality } from '../data/streams';
import { solve, snapPlan, planFor, GRID_GAP, GRID_TOTAL, MAX_AREA_FRAC, type GridPlan } from '../stage/gridSolve';
import { move } from '../stage/viewOrder';
import { prefersReducedMotion } from '../a11y';

/** 松手吸附的回弹时长，与下面 CSS 里的 .44s 对齐 */
const SNAP_MS = 480;
/** 竖条松手后保留缓动的时长，与 .3s 对齐 */
const AXIS_EASE_MS = 320;
/** 判定重排时，拖动中心沿目标方向需要走完的格中心距离比例。60% 灵敏但仍有回程滞回。 */
const REORDER_PROGRESS = 0.6;
/** 判定为拖动的位移阈值：低于它算点击，免得手抖把点选变成重排 */
const DRAG_THRESHOLD = 10;

interface Props {
  views: StreamView[];
  /** 显示顺序（StreamView.id），由上层持有 */
  order: string[];
  onReorder: (next: string[]) => void;
  /** 当前选中的格子 id，null = 没选 */
  selected: string | null;
  onSelect: (id: string | null) => void;
  quality: QualityLabel;
  onSignatureExpired?: () => void;
  syncEngine?: SyncEngine;
  /** 左侧主视角区（含其下的控制栏） */
  mainSlot: ReactNode;
  /**
   * 右下沙盘。参数是**当前排在网格里的那几路** —— 沙盘要靠它判断某台机器人
   * 「已固定」。可见路数是这里现算出来的，不外泄成 state（那就又多一份会过期的副本）。
   */
  sandboxSlot: (shown: readonly string[]) => ReactNode;
}

interface DragState {
  id: string;
  /** 抓取点相对格子左上角的偏移 —— 不尊重它，格子会在按下瞬间跳到指针中心 */
  grabX: number;
  grabY: number;
  /** 按下时机位区左上角的视口坐标，拖动期间当基准用，免得每帧读 DOM */
  originX: number;
  originY: number;
  x: number;
  y: number;
  moved: boolean;
}

interface ReleaseState {
  id: string;
  /** 松手那一帧的视觉位移；下一 rAF 清空它，才会从真实当前位置连回 home */
  transform: string;
  playing: boolean;
}

/**
 * 一次指针拖拽的手势会话。挂在 ref 里：事件回调不重建、不闭包过期。
 *
 * `currentOrder` 是**本次拖动**的顺序快照 —— 每次重排后立即更新，
 * 于是同一次拖动里来回穿过同一**60% 投影门槛**时，顺序能立刻恢复（旧实现读 pointerdown
 * 时的 order 闭包，回程时 `from === to` 直接不换，松手就跳回原格）。
 */
/** 一次手势冻结的网格度量：拖动期间坐标系不能随渲染期 plan 身份变化而漂 */
interface DragGridMetrics {
  cols: number;
  tw: number;
  th: number;
  visible: number;
}

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
  grid: DragGridMetrics;
  currentOrder: string[];
  x: number;
  y: number;
  moved: boolean;
  frame: number | null;
  /** 清理这次手势装上的 window 监听器；只由 finishTileDrag 调用 */
  removeListeners?: () => void;
}

/**
 * 拖横条时用的排布：沿用静止态的列数与格子尺寸，只把行数补到装得下全部十格。
 *
 * 机位按满列渲染、沙盘浮起来盖住下部 —— 边界移动时格子是被盖住，
 * 而不是先一步凭空消失。
 */
function fillRows(rest: GridPlan, containerH: number): GridPlan {
  const fit = Math.floor((containerH + GRID_GAP) / (rest.th + GRID_GAP));
  const rows = Math.max(1, Math.min(Math.ceil(GRID_TOTAL / rest.cols), fit));
  return {
    ...rest,
    rows,
    need: rows * rest.th + GRID_GAP * (rows - 1),
    visible: Math.min(rest.cols * rows, GRID_TOTAL),
  };
}

/** 第 index 格在机位区里的落位（相对机位区左上角） */
function tileHome(index: number, plan: Pick<GridPlan, 'cols' | 'tw' | 'th'>): { x: number; y: number } {
  return {
    x: (index % plan.cols) * (plan.tw + GRID_GAP),
    y: Math.floor(index / plan.cols) * (plan.th + GRID_GAP),
  };
}

export function StageGrid({
  views, order, onReorder, selected, onSelect,
  quality, onSignatureExpired, syncEngine, mainSlot, sandboxSlot,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const tilesRef = useRef<HTMLDivElement>(null);
  /** keyed 瓦片 DOM：FLIP 只读/写非拖动的现有节点，绝不复制视频 */
  const tileNodes = useRef(new Map<string, HTMLDivElement>());
  /** 每次重排提交前采的旧几何，给下一次 layout effect 反转 */
  const flipFrom = useRef(new Map<string, DOMRect>());
  const flipFrame = useRef<number | null>(null);

  const [leftPct, setLeftPct] = useState(50);
  const [topFrac, setTopFrac] = useState(0.5);
  const [rc, setRc] = useState({ w: 0, h: 0 });
  /** 横条拖动中的光标位置（占容器高的比例）；null = 没在拖横条 */
  const [dragFrac, setDragFrac] = useState<number | null>(null);
  /** 竖条拖动时锁死的排布，免得格子边拖边重排 */
  const [lock, setLock] = useState<{ cols: number; rows: number } | null>(null);
  const [axis, setAxis] = useState<'x' | 'y' | null>(null);
  const [snapping, setSnapping] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  /** 普通松手的回位状态；与拖动中 1:1 transform、同级 FLIP 完全分开 */
  const [release, setRelease] = useState<ReleaseState | null>(null);
  const releaseFrame = useRef<number | null>(null);
  /** 当前指针手势的会话（一次 pointerdown → pointerup/cancel）。事件侧永远读它，渲染侧读上面的 drag */
  const dragSession = useRef<TileDragSession | null>(null);

  const timers = useRef<{ axis?: ReturnType<typeof setTimeout>; snap?: ReturnType<typeof setTimeout> }>({});
  useEffect(() => {
    const t = timers.current;
    return () => { clearTimeout(t.axis); clearTimeout(t.snap); };
  }, []);

  // 右列实测尺寸：排布的唯一输入
  useEffect(() => {
    const el = rightRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const read = () => {
      const w = el.clientWidth, h = el.clientHeight;
      setRc((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    const ro = new ResizeObserver(read);
    ro.observe(el);
    read();
    return () => ro.disconnect();
  }, []);

  // ---- 排布：渲染期现算、不存 state，于是首帧/改窗口/拖动中都不可能是过期值 ----
  const ready = rc.w > 0 && rc.h > 0;
  const rest: GridPlan = ready
    ? (lock ? planFor(rc.w, rc.h, lock.cols, lock.rows) : solve(rc.w, rc.h, rc.h * topFrac))
    : solve(320, 480, 480 * 0.62);

  const plan: GridPlan = dragFrac !== null && !snapping ? fillRows(rest, rc.h) : rest;
  const areaH = plan.need;
  const cursorH = dragFrac !== null ? rc.h * dragFrac : null;
  const reduced = prefersReducedMotion();

  /** 在 React 改变 order 前记住旧格位；layout effect 再把它反转成视觉连续的 FLIP。 */
  const captureFlip = useCallback((dragId: string) => {
    if (reduced) return;
    const previous = new Map<string, DOMRect>();
    tileNodes.current.forEach((node, id) => {
      if (id !== dragId) previous.set(id, node.getBoundingClientRect());
    });
    flipFrom.current = previous;
  }, [reduced]);

  // Grid 重排本身没有可补间的 transform。这里在浏览器绘制新格位前先反向平移，
  // 再下一帧清掉 transform；于是只有非拖动格以精确的 GPU transform 连续让位。
  useLayoutEffect(() => {
    if (reduced || flipFrom.current.size === 0) return;
    if (flipFrame.current !== null) cancelAnimationFrame(flipFrame.current);

    const animated: HTMLDivElement[] = [];
    flipFrom.current.forEach((before, id) => {
      const node = tileNodes.current.get(id);
      if (!node) return;
      const after = node.getBoundingClientRect();
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (dx === 0 && dy === 0) return;
      node.style.transition = 'none';
      node.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      // 强制提交反向起点。只读本节点，避免重算整个网格的样式。
      node.getBoundingClientRect();
      animated.push(node);
    });
    flipFrom.current.clear();
    if (animated.length === 0) return;

    flipFrame.current = requestAnimationFrame(() => {
      flipFrame.current = null;
      animated.forEach((node) => {
        node.style.transition = 'transform 180ms cubic-bezier(0.77, 0, 0.175, 1)';
        node.style.transform = '';
      });
    });
  }, [order, reduced]);

  useEffect(() => () => {
    if (flipFrame.current !== null) cancelAnimationFrame(flipFrame.current);
    if (releaseFrame.current !== null) cancelAnimationFrame(releaseFrame.current);
  }, []);

  // ---- 分隔条拖动 ----
  const startSepDrag = useCallback((e: ReactPointerEvent, which: 'x' | 'y') => {
    const host = which === 'x' ? hostRef.current : rightRef.current;
    if (!host || !rc.w || !rc.h) return;
    e.preventDefault();
    clearTimeout(timers.current.axis);
    clearTimeout(timers.current.snap);
    setAxis(which);
    setSnapping(false);
    // 拖竖条先锁住当前排布：列行不变，横条自己跟着上下走
    if (which === 'x' && !lock) {
      const cur = solve(rc.w, rc.h, rc.h * topFrac);
      setLock({ cols: cur.cols, rows: cur.rows });
    }

    const onMove = (ev: PointerEvent) => {
      const r = host.getBoundingClientRect();
      if (which === 'x') {
        setLeftPct(Math.min(65, Math.max(35, ((ev.clientX - r.left) / r.width) * 100)));
      } else {
        setDragFrac(Math.min(MAX_AREA_FRAC, Math.max(0.04, (ev.clientY - r.top) / r.height)));
      }
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      if (which === 'x') {
        // 竖条松手后保留一小段缓动直到落位，免得格子瞬间跳到终点
        timers.current.axis = setTimeout(() => setAxis(null), AXIS_EASE_MS);
        return;
      }
      setAxis(null);
      const r = host.getBoundingClientRect();
      const frac = Math.min(MAX_AREA_FRAC, Math.max(0.04, (ev.clientY - r.top) / r.height));
      const snapped = snapPlan(rc.w, rc.h, rc.h * frac);
      // 吸附不瞬移：机位区先按落点排布定下来，沙盘组继续绝对定位停在光标处，
      // 再用带回弹的缓动滑到边界，动画结束才回到文档流。
      setLock({ cols: snapped.cols, rows: snapped.rows });
      setTopFrac(snapped.need / rc.h);
      setSnapping(true);
      timers.current.snap = setTimeout(() => { setDragFrac(null); setSnapping(false); }, reduced ? 0 : SNAP_MS);
    };

    document.body.style.cursor = which === 'x' ? 'col-resize' : 'row-resize';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [lock, rc.w, rc.h, topFrac, reduced]);

  // ---- 格子：点选 + 拖动重排 ----
  /** 把 rAF 待处理状态落掉：以最新坐标更新渲染、检查中心阈值、必要时重排 */
  const processTileDrag = useCallback((session: TileDragSession) => {
    session.frame = null;

    // 离起点距离先过拖动阈值，才从「点选手势」升级成「拖动手势」。
    // 阈值判定放在 rAF 里做，避免每个 pointermove 都写一次 React state。
    if (!session.moved) {
      const far = Math.abs(session.x - session.startX) + Math.abs(session.y - session.startY) > DRAG_THRESHOLD;
      if (!far) return;
      session.moved = true;
      // 越过阈值才 capture：没拖起来的手势不抢指针，点选/取消照常
      try {
        session.tile.setPointerCapture(session.pointerId);
      } catch {
        // 极少数浏览器会在指针已释放时报错；拖拽照常继续，只是不 capture
      }
    }

    // 拖动瓦片的视觉中心（指针 − 抓取偏移 + 半格）。后续按它在
    // 当前格→目标格方向上的 60% 投影判定换位，避免刚进格边缘就抖动。
    const centerX = session.x - session.grabX + session.width / 2;
    const centerY = session.y - session.grabY + session.height / 2;

    // 不是刚进目标格就插入：从当前 home 往指针中心画一条向量，只有那条向量
    // 穿过另一格的**中心垂线**才把它视为落点。横向从 A→B 时要跨过 B 的中心，
    // 而不是跨过两格中点；调头时同一公式会跨回 B 新位置的中心。
    const from = session.currentOrder.indexOf(session.id);
    const visible = session.currentOrder.slice(0, session.grid.visible);
    const ownHome = tileHome(from, session.grid);
    const ownCenterX = session.originX + ownHome.x + session.grid.tw / 2;
    const ownCenterY = session.originY + ownHome.y + session.grid.th / 2;
    const travelX = centerX - ownCenterX;
    const travelY = centerY - ownCenterY;
    const crossed = visible
      .map((candidate, index) => {
        if (candidate === session.id) return null;
        const home = tileHome(index, session.grid);
        const targetCenterX = session.originX + home.x + session.grid.tw / 2;
        const targetCenterY = session.originY + home.y + session.grid.th / 2;
        const targetX = targetCenterX - ownCenterX;
        const targetY = targetCenterY - ownCenterY;
        const targetLengthSq = targetX ** 2 + targetY ** 2;
        // 投影达到目标中心距离的 60% 才交换。换位后 ownCenter 已落到对面，
        // 反向也要走 60%，故两阈值之间天然留下 20% 格距的滞回稳定区。
        const progress = travelX * targetX + travelY * targetY;
        if (progress < targetLengthSq * REORDER_PROGRESS) return null;
        return { index, distance: (centerX - targetCenterX) ** 2 + (centerY - targetCenterY) ** 2 };
      })
      .filter((candidate): candidate is { index: number; distance: number } => candidate !== null);
    const to = crossed.reduce<{ index: number; distance: number } | null>(
      (closest, candidate) => !closest || candidate.distance < closest.distance ? candidate : closest,
      null,
    )?.index;
    if (from !== -1 && to !== undefined && to !== from) {
      const next = move(session.currentOrder, from, to);
      captureFlip(session.id);
      // 先更新会话内顺序再通知上层：同一次拖动里的后续移动都基于最新顺序，
      // 来回拖才不会把旧位置当成当前位。
      session.currentOrder = next;
      onReorder(next);
    }

    // 拖动瓦片 1:1 跟手：只在状态里放最新坐标，由渲染期的 transform 绘制
    setDrag({
      id: session.id,
      grabX: session.grabX,
      grabY: session.grabY,
      originX: session.originX,
      originY: session.originY,
      x: session.x,
      y: session.y,
      moved: true,
    });
  }, [onReorder, captureFlip]);

  /**
   * 普通松手才回位：先保留松手那一帧的 translate3d，下一帧清空 transform，
   * 让浏览器从实际手指位置以 transform-only 动画回到 Grid home。取消操作立即清掉，
   * 不制造用户没有完成的动作的动画反馈。
   */
  const startRelease = useCallback((session: TileDragSession) => {
    if (!session.moved || reduced) return;
    const from = session.currentOrder.indexOf(session.id);
    if (from === -1) return;
    const home = tileHome(from, session.grid);
    const transform = `translate3d(${session.x - session.grabX - session.originX - home.x}px, ${session.y - session.grabY - session.originY - home.y}px, 0)`;
    setRelease({ id: session.id, transform, playing: false });
    releaseFrame.current = requestAnimationFrame(() => {
      releaseFrame.current = null;
      setRelease((current) => current?.id === session.id ? { ...current, playing: true } : current);
    });
  }, [reduced]);

  /** 统一收尾：pointerup / pointercancel / 卸载共用，保证不留半截状态 */
  const finishTileDrag = useCallback((cancelled: boolean) => {
    const session = dragSession.current;
    dragSession.current = null;
    if (!session) return;
    if (session.frame !== null) cancelAnimationFrame(session.frame);
    session.removeListeners?.();
    try {
      if (session.tile.hasPointerCapture?.(session.pointerId)) {
        session.tile.releasePointerCapture(session.pointerId);
      }
    } catch {
      // capture 可能已被系统释放；释放失败不影响拖拽结束
    }
    setDrag(null);
    if (!cancelled) startRelease(session);
    if (cancelled) setRelease(null);
    if (!cancelled && !session.moved) {
      // 没拖动过就是一次点选；再点同一个取消选中
      onSelect(selected === session.id ? null : session.id);
    }
  }, [selected, onSelect, startRelease]);

  function startTileDrag(e: ReactPointerEvent, id: string) {
    if (e.button !== 0) return;
    const tiles = tilesRef.current;
    if (!tiles || dragSession.current) return;
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const host = tiles.getBoundingClientRect();
    const session: TileDragSession = {
      id,
      pointerId: e.pointerId,
      tile: e.currentTarget as HTMLElement,
      startX: e.clientX,
      startY: e.clientY,
      grabX: e.clientX - box.left,
      grabY: e.clientY - box.top,
      originX: host.left,
      originY: host.top,
      width: box.width,
      height: box.height,
      grid: { cols: plan.cols, tw: plan.tw, th: plan.th, visible: plan.visible },
      currentOrder: order,
      x: e.clientX,
      y: e.clientY,
      moved: false,
      frame: null,
    };
    dragSession.current = session;

    const onMove = (ev: PointerEvent) => {
      const s = dragSession.current;
      if (!s || ev.pointerId !== s.pointerId) return;
      s.x = ev.clientX;
      s.y = ev.clientY;
      // 每帧最多一次处理：pointer 事件经常 120/240Hz 地来，没必要逐个都触发
      // React 更新 + 几何计算。
      if (s.frame === null) {
        s.frame = requestAnimationFrame(() => processTileDrag(s));
      }
    };
    const onUp = (ev: PointerEvent) => {
      const s = dragSession.current;
      if (s && ev.pointerId === s.pointerId) finishTileDrag(false);
    };
    const onCancel = (ev: PointerEvent) => {
      const s = dragSession.current;
      if (s && ev.pointerId === s.pointerId) finishTileDrag(true);
    };
    session.removeListeners = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }

  // 卸载时兜底收尾：拖动到一半切换布局/切页，不能让监听器与 capture 留着。
  // 注意不把 finishTileDrag 当依赖：它因 selected 变化会重建，若依赖它就会在
  // 父组件响应 onReorder 的 re-render 后错误终止仍在进行的拖动。
  useEffect(() => () => {
    const session = dragSession.current;
    if (!session) return;
    if (session.frame !== null) cancelAnimationFrame(session.frame);
    session.removeListeners?.();
    dragSession.current = null;
  }, []);

  // Esc 取消选中 —— 任何状态都要有键盘退路。对话框开着时 Esc 属于对话框，不越权抢
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      onSelect(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, onSelect]);

  const byId = new Map(views.map((v) => [v.id, v]));
  // 排进网格的是前 visible 路，其余挂到屏外 —— 见下面 sg-offscreen 的注释
  const shown = order.slice(0, plan.visible);
  const offscreen = order.slice(plan.visible);

  const lowerStyle: CSSProperties = dragFrac !== null
    ? {
        position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 6,
        top: Math.round(snapping ? areaH : Math.min(cursorH ?? areaH, areaH)),
        // 松手吸附：带回弹的缓动滑到边界，略过冲再收住；拖动中保持 1:1 跟手（无过渡）
        transition: snapping && !reduced ? 'top .44s cubic-bezier(.34,1.5,.5,1)' : 'none',
      }
    : {};

  const axisEase = axis === 'x' && !reduced ? '.3s cubic-bezier(.2,.9,.25,1)' : undefined;

  return (
    <div className="stage-grid" ref={hostRef}>
      <div
        className="sg-main"
        style={{ flex: `0 0 ${leftPct}%`, transition: axisEase ? `flex-basis ${axisEase}` : 'none' }}
      >
        {mainSlot}
      </div>

      <div
        className="sg-sep sg-sep--col"
        role="separator"
        aria-label="调整左右占比"
        aria-orientation="vertical"
        title="拖动调整左右占比"
        onPointerDown={(e) => startSepDrag(e, 'x')}
      >
        <span aria-hidden="true" />
      </div>

      <div className="sg-right" ref={rightRef}>
        <div
          className="sg-tiles"
          ref={tilesRef}
          style={{
            flex: `0 0 ${areaH}px`,
            gridTemplateColumns: `repeat(${plan.cols}, ${plan.tw}px)`,
            gridAutoRows: `${plan.th}px`,
            // 拖竖条时区高与格子轨道走同一条缓动，整组机位一起长大/缩小；
            // 横条跟手与吸附一律无过渡（那两者自己管动画）
            transition: axisEase
              ? `flex-basis ${axisEase}, grid-template-columns ${axisEase}, grid-auto-rows ${axisEase}`
              : 'none',
          }}
        >
          {shown.map((id, index) => {
            const v = byId.get(id);
            if (!v) return null;
            const dragging = drag?.id === id && drag.moved;
            const releasing = release?.id === id;
            const source = sourceForQuality(v, quality);
            let style: CSSProperties | undefined;
            if (dragging && drag) {
              // 1:1 跟手且尊重抓取偏移。格子留在网格流里占位（让位动画才有参照），
              // 只用 transform 视觉上跟到指针 —— 落位差值按几何算，不在渲染期读 DOM。
              const home = tileHome(index, plan);
              style = {
                ...style,
                transform: `translate3d(${drag.x - drag.grabX - drag.originX - home.x}px, ${drag.y - drag.grabY - drag.originY - home.y}px, 0)`,
                transition: 'none',
              };
            } else if (releasing && release) {
              style = release.playing
                ? { transition: 'transform 180ms cubic-bezier(0.77, 0, 0.175, 1)' }
                : { transform: release.transform, transition: 'none' };
            }
            return (
              <div
                key={id}
                className={`sg-tile ${v.side}${selected === id ? ' selected' : ''}${dragging ? ' dragging' : ''}`}
                data-view-id={id}
                role="button"
                tabIndex={0}
                aria-pressed={selected === id}
                aria-label={v.role}
                title={v.role}
                ref={(node) => {
                  if (node) tileNodes.current.set(id, node);
                  else tileNodes.current.delete(id);
                }}
                style={style}
                onPointerDown={(e) => startTileDrag(e, id)}
                onTransitionEnd={(e) => {
                  if (releasing && release?.playing && e.propertyName === 'transform') setRelease(null);
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  onSelect(selected === id ? null : id);
                }}
              >
                <VideoPlayer
                  src={source?.src}
                  className="sg-tile-video"
                  onSignatureExpired={onSignatureExpired}
                  syncEngine={syncEngine}
                  syncId={v.id}
                  syncTier={source?.label ?? quality}
                />
                {syncEngine && <SyncBadge source={syncEngine} id={v.id} />}
              </div>
            );
          })}
        </div>

        <div className="sg-lower" style={lowerStyle}>
          <div
            className="sg-sep sg-sep--row"
            role="separator"
            aria-label="调整上下占比"
            aria-orientation="horizontal"
            title="拖动调整上下占比"
            onPointerDown={(e) => startSepDrag(e, 'y')}
          >
            <span aria-hidden="true" />
          </div>
          {/* shown 的引用稳定性交给 React Compiler：它按 order 与 plan.visible 记忆
              这个 slice，可见集合没变时沙盘不会被拖着重渲。手写 useMemo 反而会让
              编译器放弃优化整个组件（order 是 prop 数组，它不敢假定不被改） */}
          <div className="sg-sandbox">{sandboxSlot(shown)}</div>
        </div>

        {/* 排不进网格的路：照常挂着解码，只是不给人看。
            沙盘按 data-view-id 找 <video> 取像素，机器人面板的实时预览也从这里取 ——
            显示与解码是两回事，不显示不等于要把流断掉。
            用 1px + opacity 而非 display:none：后者会让浏览器把解码也停掉。 */}
        {offscreen.length > 0 && (
          <div className="sg-offscreen" aria-hidden="true">
            {offscreen.map((id) => {
              const v = byId.get(id);
              if (!v) return null;
              const source = sourceForQuality(v, quality);
              return (
                <div key={id} data-view-id={id}>
                  <VideoPlayer
                    src={source?.src}
                    onSignatureExpired={onSignatureExpired}
                    syncEngine={syncEngine}
                    syncId={v.id}
                    syncTier={source?.label ?? quality}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
