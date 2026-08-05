/**
 * grid 布局的排布求解器。
 *
 * 唯一的排布来源：给机位区实测宽高 + 期望的可见高度，一次解出
 * 列数 / 可见行数 / 格子宽高。结果在渲染期现算、不存 state ——
 * 于是任何时刻（首帧、切布局、改窗口、拖动中）都不可能是过期值。
 *
 * **十路恒在。** 网格永远铺满 {@link GRID_TOTAL} 个格子，沙盘绝对定位浮在
 * 它上面、盖住下部若干行。所以「可见行数」变的是遮挡边界，不是格子数量 ——
 * 十路 `<video>` 一路都不能少，沙盘要靠它们全都在解码才反解得出全场机器人。
 * （这一点与参考稿不同：那边行数上限取 `floor(total/cols)`，3 列时只排 9 格。）
 */

/** 机位之间的间距，横纵同值 */
export const GRID_GAP = 6;

/** 每场恰好十路 FPV，双方各五台 */
export const GRID_TOTAL = 10;

/** 格子宽下限：容器宽的这个比例与 {@link MIN_TILE_PX} 取大 */
const MIN_TILE_FRAC = 0.22;
const MIN_TILE_PX = 120;

/** 机位区最多占容器多高 —— 留一线给沙盘，不让它被挤没 */
const MAX_AREA_FRAC = 0.94;

export interface GridPlan {
  /** 列数 */
  cols: number;
  /** 可见行数（沙盘上边界之上的完整行数） */
  rows: number;
  /** 放下全部十格所需的行数 */
  totalRows: number;
  /** 格子宽 —— 列宽永远铺满机位区 */
  tw: number;
  /** 格子高 —— 恒守 16:9 */
  th: number;
  /** 可见区高度，精确等于整行铺满的高度 */
  need: number;
  /** 可见格子数 */
  visible: number;
}

function minTileWidth(W: number): number {
  return Math.max(MIN_TILE_PX, W * MIN_TILE_FRAC);
}

function rowsForAll(cols: number): number {
  return Math.ceil(GRID_TOTAL / cols);
}

function make(cols: number, rows: number, tw: number): GridPlan {
  const th = (tw * 9) / 16;
  return {
    cols,
    rows,
    totalRows: rowsForAll(cols),
    tw,
    th,
    need: rows * th + GRID_GAP * (rows - 1),
    visible: Math.min(cols * rows, GRID_TOTAL),
  };
}

/**
 * 解出最贴近 `desiredH` 的排布。
 *
 * 列宽铺满 → 行高由 16:9 定 → 可见高度只能取整行的离散值，
 * 于是「任意高度都能被某个 (列, 行) 组合精确填满」——既 1:1 跟手，又永不留缝。
 */
export function solve(W: number, H: number, desiredH: number): GridPlan {
  const maxH = H * MAX_AREA_FRAC;
  const target = Math.max(0, Math.min(desiredH, maxH));
  const minW = minTileWidth(W);

  let best: GridPlan | null = null;
  let bestD = Infinity;

  for (let cols = 1; cols <= GRID_TOTAL; cols++) {
    const tw = (W - GRID_GAP * (cols - 1)) / cols;
    // 单列永远允许：再窄也得给用户看点东西
    if (cols > 1 && tw < minW) break;
    const th = (tw * 9) / 16;
    if (th <= 0) break;

    for (let rows = 1; rows <= rowsForAll(cols); rows++) {
      const need = rows * th + GRID_GAP * (rows - 1);
      if (need > maxH) break;
      const d = Math.abs(need - target);
      const cand = make(cols, rows, tw);
      // 差距相当（1px 内）时选可见格子多的：同样的高度当然是多露几路更好
      if (d < bestD - 1 || (Math.abs(d - bestD) <= 1 && best !== null && cand.visible > best.visible)) {
        best = cand;
        bestD = d;
      }
    }
  }

  // 容器矮到一行都放不下：给一个塞得进去的单格排布，绝不返回空
  if (!best) {
    const tw = W;
    const th = (tw * 9) / 16;
    const scale = th > maxH && th > 0 ? maxH / th : 1;
    return make(1, 1, tw * scale);
  }
  return best;
}

/**
 * 松手吸附：沿用当前列数，把边界吸到最近的整行处。
 *
 * 不重排 —— 拖动过程中用的哪套列数，落位就还是那套。换列数会让格子在
 * 松手瞬间集体变尺寸，那正是「吸附看起来像跳了一下」的来源。
 */
export function snapPlan(W: number, H: number, h: number): GridPlan {
  const base = solve(W, H, H);
  const { cols, tw, th } = base;
  const maxRows = Math.min(base.totalRows, Math.max(1, Math.floor((H * MAX_AREA_FRAC + GRID_GAP) / (th + GRID_GAP))));
  const wanted = Math.round((h + GRID_GAP) / (th + GRID_GAP));
  const rows = Math.max(1, Math.min(maxRows, wanted));
  return make(cols, rows, tw);
}

/**
 * 竖条拖动：锁死列数与行数，只按新宽度重算格子尺寸。
 *
 * 排布不动，机位区高度随宽度连续变化 —— 拖竖条时格子平滑缩放而不是
 * 突然重排。宽度缩到锁定列数放不下了才退回 {@link solve} 重新求解。
 */
export function planFor(W: number, H: number, cols: number, rows: number): GridPlan {
  const minW = minTileWidth(W);
  const tw = (W - GRID_GAP * (cols - 1)) / cols;
  if (cols > 1 && tw < minW) return solve(W, H, H * 0.6);

  const th = (tw * 9) / 16;
  const maxH = H * MAX_AREA_FRAC;
  let r = Math.max(1, Math.min(rows, rowsForAll(cols)));
  while (r > 1 && r * th + GRID_GAP * (r - 1) > maxH) r -= 1;
  return make(cols, r, tw);
}
