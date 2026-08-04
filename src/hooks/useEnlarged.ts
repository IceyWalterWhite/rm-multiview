import { useCallback, useRef, useState, type RefObject } from 'react';

/** 机位在布局里占的位置。放大是纯 transform，不占布局——所以这里永远是「没放大时」的盒子 */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface TileGeometry {
  readonly id: string;
  readonly box: Box;
  /** transform-origin，相对机位自身左上角的像素 */
  readonly originX: number;
  readonly originY: number;
}

/**
 * 放大后实际盖住的区域：锚点钉住不动，其余边按 scale 从锚点推开。
 * 侧列首尾的锚点在 top/bottom（放大只朝列内长，不出界被裁），中间的在 center。
 */
export function scaledBox(tile: TileGeometry, scale: number): Box {
  const ax = tile.box.left + tile.originX;
  const ay = tile.box.top + tile.originY;
  return {
    left: ax + (tile.box.left - ax) * scale,
    top: ay + (tile.box.top - ay) * scale,
    right: ax + (tile.box.right - ax) * scale,
    bottom: ay + (tile.box.bottom - ay) * scale,
  };
}

/** 两个盒子的分离距离：正 = 留了这么宽的缝，负 = 压进去这么深。只要有一个轴分开就算分开 */
export function separation(a: Box, b: Box): number {
  const dx = Math.max(b.left - a.right, a.left - b.right);
  const dy = Math.max(b.top - a.bottom, a.top - b.bottom);
  return Math.max(dx, dy);
}

/**
 * 点开 id 之后，哪些机位该保持放大——被挤到的让位，够开的留着。
 * current 按点开先后排列，返回值同样。已放大的再点一次是收起。
 */
export function resolveEnlarged(
  geometries: readonly TileGeometry[],
  current: readonly string[],
  id: string,
  scale: number,
  minGap: number,
): string[] {
  if (current.includes(id)) return current.filter((x) => x !== id);
  const byId = new Map(geometries.map((g) => [g.id, g]));
  const target = byId.get(id);
  // 量不到几何（测试 / 首帧未布局）就不擅自收人：宁可挤一下，也不该无缘无故弹掉用户开着的机位
  if (!target) return [...current, id];
  const targetBox = scaledBox(target, scale);
  const kept = current.filter((other) => {
    const g = byId.get(other);
    if (!g) return true;
    return separation(targetBox, scaledBox(g, scale)) >= minGap;
  });
  return [...kept, id];
}

/**
 * 两个放大框之间至少要留出的缝，按机位高取比例（用绝对像素会随屏幕尺寸翻转结论）。
 * 0.05 落在两档之间且两侧都有富余：相邻机位重叠 0.9×机位高，隔位机位留缝 0.1×机位高 + 2×gap。
 */
const MIN_BREATH_RATIO = 0.05;
const FALLBACK_SCALE = 1.6;

/** 从 DOM 量布局。offsetTop/offsetHeight 是布局值，不受 transform 影响——已放大的机位也能量到原始盒子 */
export function readGeometries(row: HTMLElement): TileGeometry[] {
  const tiles = Array.from(row.querySelectorAll<HTMLElement>('.view-tile[data-view-id]'));
  return tiles.map((el) => {
    const [ox, oy] = getComputedStyle(el).transformOrigin.split(' ').map(parseFloat);
    let left = 0;
    let top = 0;
    // 侧列自己是定位祖先，逐级累加才能把红蓝两列换算到同一坐标系（跨列遮挡也就一并判了）
    for (let n: HTMLElement | null = el; n && n !== row; n = n.offsetParent as HTMLElement | null) {
      left += n.offsetLeft;
      top += n.offsetTop;
    }
    return {
      id: el.dataset.viewId ?? '',
      box: { left, top, right: left + el.offsetWidth, bottom: top + el.offsetHeight },
      originX: Number.isFinite(ox) ? ox : 0,
      originY: Number.isFinite(oy) ? oy : 0,
    };
  });
}

const EMPTY: ReadonlyMap<string, number> = new Map();

/**
 * 多路放大：互不遮挡就同时开着，会挤到的那一路自己缩回去。
 * 返回的 Map 值是点开次序，供层叠用——最新点开的必须压在正在缩回去的那一路上面。
 */
export function useEnlarged(rowRef: RefObject<HTMLElement | null>) {
  const [stacks, setStacks] = useState<ReadonlyMap<string, number>>(EMPTY);
  // 当前值放 ref：toggle 要读 DOM 算几何，不适合塞进 setState 的 updater（会被 StrictMode 跑两遍）
  const stacksRef = useRef(stacks);
  const seqRef = useRef(0);

  const toggle = useCallback((id: string) => {
    const prev = stacksRef.current;
    const row = rowRef.current;
    let next: string[];
    if (row && typeof getComputedStyle === 'function') {
      const geometries = readGeometries(row);
      const scale = parseFloat(getComputedStyle(row).getPropertyValue('--enlarge-scale'));
      const first = geometries[0];
      const tileHeight = first ? first.box.bottom - first.box.top : 0;
      next = resolveEnlarged(
        geometries,
        [...prev.keys()],
        id,
        Number.isFinite(scale) ? scale : FALLBACK_SCALE,
        tileHeight * MIN_BREATH_RATIO,
      );
    } else {
      next = prev.has(id) ? [...prev.keys()].filter((x) => x !== id) : [...prev.keys(), id];
    }
    // 复用旧次序、只给新放大的发号：让位中的那一路 z 仍高于普通机位，但低于刚点开的
    const map = new Map<string, number>();
    for (const key of next) map.set(key, prev.get(key) ?? seqRef.current++);
    stacksRef.current = map;
    setStacks(map);
  }, [rowRef]);

  const clear = useCallback(() => {
    if (stacksRef.current.size === 0) return;
    stacksRef.current = EMPTY;
    setStacks(EMPTY);
  }, []);

  return { stacks, toggle, clear };
}
