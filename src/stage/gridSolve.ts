/**
 * grid 布局的排布求解器。
 *
 * 唯一的排布来源：给机位区实测宽高 + 期望的可见高度，一次解出
 * 列数 / 行数 / 格子宽高。结果在渲染期现算、不存 state ——
 * 于是任何时刻（首帧、切布局、改窗口、拖动中）都不可能是过期值。
 *
 * **网格里排的是「看得见的那几路」，不是全部十路。** 排不进来的路照样挂着
 * 解码（见 StageGrid 的屏外容器），沙盘取像素与面板预览都不受影响 ——
 * 解码与显示是两回事。
 */

/** 机位之间的间距，横纵同值 */
export const GRID_GAP = 6;

/** 每场恰好十路 FPV，双方各五台 */
export const GRID_TOTAL = 10;

/**
 * 格子宽下限：容器宽的这个比例与 {@link MIN_TILE_PX} 取大。
 *
 * 多视角的格子小到一定程度就失去意义 —— 看不清谁在干什么。34% 意味着
 * 一行最多两格，这是参考稿定的下限（它的 minTilePct 滑块默认 34、范围 10~34）。
 */
const MIN_TILE_FRAC = 0.34;
const MIN_TILE_PX = 120;

/** 格子宽上限（占容器宽的比例）。挡掉「一格吃掉大半宽度」的退化排布 */
const MAX_TILE_FRAC = 0.55;

/**
 * 下半区（分隔条 + 沙盘）至少占容器多高。
 *
 * 目标是「沙盘不小于页面总高的 25%」。这里的容器是机位列（`.sg-right`），
 * 它等于视口高减去 `.live-stage` 的 10px 上下内边距；下半区里还要扣掉
 * 10px 的分隔条。两笔加起来 30px 上下，取 0.27 把它们一并吸收 ——
 * 1080p 下沙盘实得 27%×1060−10 ≈ 276px，恰好高于 25%×1080 = 270px。
 *
 * 沙盘不是可有可无的装饰：它是这套布局的另一半，也是唯一能一眼看全场的东西。
 * 被压成一条缝的话，本布局就退化成「网格 + 一根横线」，所以这是硬下限，
 * 不由用户把横条拖到哪里决定。
 */
const MIN_LOWER_FRAC = 0.27;

/** 机位区最多占容器多高。拖动横条的上界也是它 —— 拖过去再弹回来只会显得像卡了 */
export const MAX_AREA_FRAC = 1 - MIN_LOWER_FRAC;

export interface GridPlan {
  /** 列数 */
  cols: number;
  /** 行数 */
  rows: number;
  /** 这个列数下最多能排几行（满列） */
  totalRows: number;
  /** 格子宽 —— 列宽永远铺满机位区 */
  tw: number;
  /** 格子高 —— 恒守 16:9 */
  th: number;
  /** 机位区高度，精确等于整行铺满的高度 */
  need: number;
  /** 排进网格的格子数 = cols × rows */
  visible: number;
}

function minTileWidth(W: number): number {
  return Math.max(MIN_TILE_PX, W * MIN_TILE_FRAC);
}

/** 这个列数下的满列行数。排不满一行的零头不占行 —— 网格里不留半截空行 */
function rowsForAll(cols: number): number {
  return Math.max(1, Math.floor(GRID_TOTAL / cols));
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
 * 列宽铺满 → 行高由 16:9 定 → 机位区高度只能取整行的离散值，
 * 于是「任意高度都能被某个 (列,行) 组合精确填满」——既 1:1 跟手，又永不留缝。
 */
export function solve(W: number, H: number, desiredH: number): GridPlan {
  const maxH = H * MAX_AREA_FRAC;
  const target = Math.max(0, Math.min(desiredH, maxH));
  const minW = minTileWidth(W);

  let best: GridPlan | null = null;
  let bestD = Infinity;

  for (let cols = 1; cols <= GRID_TOTAL; cols++) {
    const tw = (W - GRID_GAP * (cols - 1)) / cols;
    // 格子窄于下限就不再往下加列 —— 多视角小到看不清就没意义了
    if (cols > 1 && tw < minW) break;
    // 容器宽到放得下两列时，不许「一个格子吃掉大半宽度」的退化解：
    // 那会让机位区只剩一两路，与多视角的目的正好相反
    if (tw > W * MAX_TILE_FRAC && W >= minW * 2 + GRID_GAP) continue;
    const th = (tw * 9) / 16;
    if (th <= 0) break;

    for (let rows = 1; rows <= rowsForAll(cols); rows++) {
      const need = rows * th + GRID_GAP * (rows - 1);
      if (need > maxH) break;
      const d = Math.abs(need - target);
      const cand = make(cols, rows, tw);
      // 贴合度相当（1px 内）时选格子多的：同样的高度当然是多露几路更好
      if (d < bestD - 1 || (Math.abs(d - bestD) <= 1 && best !== null && cand.visible > best.visible)) {
        best = cand;
        bestD = d;
      }
    }
  }

  // 容器矮到一行都放不下：仍按铺满 + 16:9 给一行，超出的部分交给 overflow 裁掉。
  // 为塞进高度而缩窄格子会横向留白，缩高度则把画面压变形 —— 两者都比「被裁掉一截」难看。
  if (!best) return make(2, 1, (W - GRID_GAP) / 2);
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
