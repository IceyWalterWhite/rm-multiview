import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { StreamView } from '../types';
import type { QualityLabel } from '../config';
import type { SyncEngine } from '../sync/engine';
import { VideoPlayer } from './VideoPlayer';
import { SyncBadge } from './SyncBadge';
import { sourceForQuality } from '../data/streams';
import { solve, snapPlan, planFor, GRID_GAP, GRID_TOTAL, type GridPlan } from '../stage/gridSolve';
import { move } from '../stage/viewOrder';
import { prefersReducedMotion } from '../a11y';

/** 松手吸附的回弹时长，与下面 CSS 里的 .44s 对齐 */
const SNAP_MS = 480;
/** 竖条松手后保留缓动的时长，与 .3s 对齐 */
const AXIS_EASE_MS = 320;
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
  /** 右下沙盘 */
  sandboxSlot: ReactNode;
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

/** 第 index 格在机位区里的落位（相对机位区左上角） */
function tileHome(index: number, plan: GridPlan): { x: number; y: number } {
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

  const [leftPct, setLeftPct] = useState(58);
  const [topFrac, setTopFrac] = useState(0.62);
  const [rc, setRc] = useState({ w: 0, h: 0 });
  /** 横条拖动中的光标位置（占容器高的比例）；null = 没在拖横条 */
  const [dragFrac, setDragFrac] = useState<number | null>(null);
  /** 竖条拖动时锁死的排布，免得格子边拖边重排 */
  const [lock, setLock] = useState<{ cols: number; rows: number } | null>(null);
  const [axis, setAxis] = useState<'x' | 'y' | null>(null);
  const [snapping, setSnapping] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);

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

  // 拖横条中：沿用静止态的列数与格子尺寸，只把行数补到能放下全部十格。
  // 机位按满列渲染、沙盘浮起来盖住下部 —— 边界移动时格子是被盖住，不会先一步凭空消失。
  let plan = rest;
  if (dragFrac !== null && !snapping) {
    const fit = Math.floor((rc.h + GRID_GAP) / (rest.th + GRID_GAP));
    const rowsFill = Math.max(1, Math.min(Math.ceil(GRID_TOTAL / rest.cols), fit));
    plan = {
      ...rest,
      rows: rowsFill,
      need: rowsFill * rest.th + GRID_GAP * (rowsFill - 1),
      visible: Math.min(rest.cols * rowsFill, GRID_TOTAL),
    };
  }
  const areaH = plan.need;
  const cursorH = dragFrac !== null ? rc.h * dragFrac : null;
  const reduced = prefersReducedMotion();

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
        setDragFrac(Math.min(0.94, Math.max(0.04, (ev.clientY - r.top) / r.height)));
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
      const frac = Math.min(0.94, Math.max(0.04, (ev.clientY - r.top) / r.height));
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
  const startTileDrag = useCallback((e: ReactPointerEvent, id: string) => {
    if (e.button !== 0) return;
    const tiles = tilesRef.current;
    if (!tiles) return;
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const host = tiles.getBoundingClientRect();
    let st: DragState = {
      id,
      grabX: e.clientX - box.left,
      grabY: e.clientY - box.top,
      originX: host.left,
      originY: host.top,
      x: e.clientX,
      y: e.clientY,
      moved: false,
    };
    setDrag(st);

    const onMove = (ev: PointerEvent) => {
      const far = Math.abs(ev.clientX - e.clientX) + Math.abs(ev.clientY - e.clientY) > DRAG_THRESHOLD;
      st = { ...st, x: ev.clientX, y: ev.clientY, moved: st.moved || far };
      setDrag(st);
      if (!st.moved) return;
      // 其他格子实时让位：过了阈值就立刻改顺序，不等松手
      const col = Math.floor((ev.clientX - st.originX) / (plan.tw + GRID_GAP));
      const row = Math.floor((ev.clientY - st.originY) / (plan.th + GRID_GAP));
      if (col < 0 || col >= plan.cols || row < 0) return;
      const to = row * plan.cols + col;
      const from = order.indexOf(id);
      if (from !== -1 && to !== from && to >= 0 && to < order.length) onReorder(move(order, from, to));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      // 没拖动过就是一次点选；再点同一个取消选中
      if (!st.moved) onSelect(selected === id ? null : id);
      setDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [plan.tw, plan.th, plan.cols, order, onReorder, onSelect, selected]);

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
            height: areaH,
            gridTemplateColumns: `repeat(${plan.cols}, ${plan.tw}px)`,
            gridAutoRows: `${plan.th}px`,
            transition: axisEase ? `height ${axisEase}` : 'none',
          }}
        >
          {order.map((id, index) => {
            const v = byId.get(id);
            if (!v) return null;
            const dragging = drag?.id === id && drag.moved;
            const source = sourceForQuality(v, quality);
            let style: CSSProperties | undefined;
            if (dragging && drag) {
              // 1:1 跟手且尊重抓取偏移。格子留在网格流里占位（让位动画才有参照），
              // 只用 transform 视觉上跟到指针 —— 落位差值按几何算，不在渲染期读 DOM。
              const home = tileHome(index, plan);
              style = {
                transform: `translate(${drag.x - drag.grabX - drag.originX - home.x}px, ${drag.y - drag.grabY - drag.originY - home.y}px)`,
                transition: 'none',
              };
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
                style={style}
                onPointerDown={(e) => startTileDrag(e, id)}
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
                <span className="sg-tile-name" aria-hidden="true">{v.role}</span>
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
          <div className="sg-sandbox">{sandboxSlot}</div>
        </div>
      </div>
    </div>
  );
}
