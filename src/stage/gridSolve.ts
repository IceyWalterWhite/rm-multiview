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

/** 格子宽上限（占容器宽的比例）。挡掉「一格吃掉大半宽度」的退化排布 */
const MAX_TILE_FRAC = 0.55;

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
 * 选列数 —— **只看容器宽高，不看期望高度**。
 *
 * 于是拖横条只改行数、不改列数：格子尺寸与位置全程不动，只有露出的行数在变。
 * 这正是「整档切换」该有的样子。让列数也跟着期望高度浮动的话，拖动中十路画面
 * 会随列数跳变整体改尺寸，而且可见路数会倒退（实测出现过「机位区拖高了、
 * 可见路数反而从 10 掉到 6」）。
 *
 * 取**能把全部十路装进容器的最小列数**：列数越少格子越大，所以第一个装得下的
 * 就是格子最大的那个。都装不下时退回允许的最大列数 —— 格子最小、每屏露得最多。
 */
function chooseCols(W: number, H: number): number {
  const minW = minTileWidth(W);
  const maxH = H * MAX_AREA_FRAC;
  let widest = 1;
  for (let cols = 1; cols <= GRID_TOTAL; cols++) {
    const tw = (W - GRID_GAP * (cols - 1)) / cols;
    if (cols > 1 && tw < minW) break;
    // 容器宽到放得下两列时，不许「一个格子吃掉大半宽度」——
    // 那会让十路里只剩一两路看得见，与多视角的目的正好相反
    if (tw > W * MAX_TILE_FRAC && W >= minW * 2 + GRID_GAP) continue;
    widest = cols;
    const th = (tw * 9) / 16;
    const rows = rowsForAll(cols);
    if (rows * th + GRID_GAP * (rows - 1) <= maxH) return cols;
  }
  return widest;
}

/**
 * 解出最贴近 `desiredH` 的排布。
 *
 * 列宽铺满 → 行高由 16:9 定 → 可见高度只能取整行的离散值，
 * 于是「任意高度都能被某一行数精确填满」——既 1:1 跟手，又永不留缝。
 */
export function solve(W: number, H: number, desiredH: number): GridPlan {
  const maxH = H * MAX_AREA_FRAC;
  const target = Math.max(0, Math.min(desiredH, maxH));
  const cols = chooseCols(W, H);
  const tw = (W - GRID_GAP * (cols - 1)) / cols;
  const th = (tw * 9) / 16;

  // 容器矮到一行都放不下：压扁到塞得进去，绝不返回空
  if (th > maxH) return make(cols, 1, maxH > 0 ? (maxH * 16) / 9 : tw);

  let bestRows = 1;
  let bestD = Infinity;
  for (let rows = 1; rows <= rowsForAll(cols); rows++) {
    const need = rows * th + GRID_GAP * (rows - 1);
    if (need > maxH) break;
    const d = Math.abs(need - target);
    if (d < bestD) { bestD = d; bestRows = rows; }
  }
  return make(cols, bestRows, tw);
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
