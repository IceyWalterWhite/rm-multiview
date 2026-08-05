import { resolveRect, type Frame, type NormRect } from '../vision/frame';
import { rgbToHsv } from '../vision/hsv';
import { EXEMPLARS, GLYPH_H, GLYPH_W } from './glyphs';

/**
 * 赛事 UI 上白色数字的通用识别管线。
 *
 * 机器人血量「198/200」、基地「5000」、前哨站「1500」用的是同一套字体、同一种
 * 「白字压在阵营色底上」的渲染，所以切分与分类完全共用；差别只在 ROI 和格式校验，
 * 由调用方各自负责。
 */

/**
 * 白度阈值的候选阶梯（相对该 ROI 的最大白度）。
 *
 * 不存在一个通吃的阈值。实测 14 帧血量夹具：0.45 会让「300/300」的后三位粘成一坨，
 * 0.70 又会把「198/200」的某一位裂成两段。0.55~0.65 三档都是 14/14 全对，
 * 所以以 0.6 为中心向两侧铺开，逐个试，用结构合法性挑。
 * 白度图只算一次，多试几个阈值几乎不花钱。
 */
const RATIO_LADDER = [0.6, 0.55, 0.65, 0.5, 0.7, 0.45];

/** 字宽离散度上限（最宽/中位宽）。实测切分正确时 ≤1.3，粘连时 ≥1.6。 */
const MAX_WIDTH_SPREAD = 1.45;

/** 一列里至少要有这么多笔画像素才算「非空列」，用于抑制孤立噪点。 */
const MIN_COLUMN_INK = 1;

/** 字形段的笔画高度至少要达到本帧最高段的这个比例，否则当噪点丢掉。 */
const MIN_RELATIVE_HEIGHT = 0.5;

/** ROI 里最亮的像素都比这暗，就认为这块 UI 根本没在渲染。 */
const MIN_PEAK_WHITENESS = 60;

/** 切分候选允许的字形数区间。 */
export interface GlyphCountRange {
  min: number;
  max: number;
}

/** 「白度」通道：越白越高。高饱和的阵营色和暗背景都会被压低，只剩下白字。 */
function whiteness(r: number, g: number, b: number): number {
  const { s, v } = rgbToHsv(r, g, b);
  return (v * (255 - s)) / 255;
}

interface Ink {
  bits: Uint8Array;
  width: number;
  height: number;
}

export interface GlyphCandidate {
  ratio: number;
  /** 每个字形重采样后的固定字格 */
  cells: Float32Array[];
  /** 字宽离散度，越小越像一行等宽数字 */
  spread: number;
}

/**
 * 用一整条阈值阶梯切分，返回所有结构上说得通的候选。
 * 分类器和模板生成工具都从这里取料 —— 两边共用同一套切分，模板才不会与线上行为脱节。
 */
export function segmentCandidates(frame: Frame, roi: NormRect, counts: GlyphCountRange): GlyphCandidate[] {
  const rect = resolveRect(roi, frame.width, frame.height);
  // 只要够放下几个像素就试。基地那几个 ROI 在 480p 下才 8~10 行高，
  // 按字格尺寸(12 行)设下限会把它们整个挡掉。
  if (rect.w < 4 || rect.h < 4) return [];

  const values = new Float32Array(rect.w * rect.h);
  let peak = 0;
  for (let y = 0; y < rect.h; y++) {
    let src = ((rect.y + y) * frame.width + rect.x) * 4;
    let dst = y * rect.w;
    for (let x = 0; x < rect.w; x++, src += 4, dst++) {
      const wv = whiteness(frame.data[src], frame.data[src + 1], frame.data[src + 2]);
      values[dst] = wv;
      if (wv > peak) peak = wv;
    }
  }
  if (peak < MIN_PEAK_WHITENESS) return [];

  const out: GlyphCandidate[] = [];
  for (const ratio of RATIO_LADDER) {
    const th = peak * ratio;
    const bits = new Uint8Array(values.length);
    for (let i = 0; i < values.length; i++) if (values[i] >= th) bits[i] = 1;
    const ink: Ink = { bits, width: rect.w, height: rect.h };

    const runs: Array<{ x0: number; x1: number }> = [];
    let start = -1;
    for (let x = 0; x <= ink.width; x++) {
      let count = 0;
      if (x < ink.width) for (let y = 0; y < ink.height; y++) count += ink.bits[y * ink.width + x];
      const on = count >= MIN_COLUMN_INK;
      if (on && start < 0) start = x;
      else if (!on && start >= 0) {
        runs.push({ x0: start, x1: x });
        start = -1;
      }
    }
    // 按笔画高度剔除噪点段：真数字占满字高，UI 边框的碎片只有一两行。
    // 不剔的话它们会凑成额外的字形段，把段数顶出合法区间，整帧读数直接作废。
    const heights = runs.map((r) => inkHeight(ink, r));
    const tallest = heights.length ? Math.max(...heights) : 0;
    const kept = runs.filter((_, i) => heights[i] >= tallest * MIN_RELATIVE_HEIGHT);
    runs.length = 0;
    runs.push(...kept);

    if (runs.length < counts.min || runs.length > counts.max) continue;

    const widths = runs.map((r) => r.x1 - r.x0).sort((a, b) => a - b);
    const median = widths[widths.length >> 1];
    const spread = median > 0 ? widths[widths.length - 1] / median : Infinity;
    // 单字形时离散度恒为 1，这条约束自动失效，正好 —— 前哨站被击毁就只剩一个 "0"
    if (spread > MAX_WIDTH_SPREAD) continue;

    const cells: Float32Array[] = [];
    for (const run of runs) {
      const cell = normalize(ink, run);
      if (cell) cells.push(cell);
    }
    if (cells.length === runs.length) out.push({ ratio, cells, spread });
  }
  return out;
}

/** 某一列区间内笔画的行跨度。 */
function inkHeight(ink: Ink, seg: { x0: number; x1: number }): number {
  let y0 = ink.height;
  let y1 = -1;
  for (let y = 0; y < ink.height; y++) {
    for (let x = seg.x0; x < seg.x1; x++) {
      if (ink.bits[y * ink.width + x]) {
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        break;
      }
    }
  }
  return y1 < y0 ? 0 : y1 - y0 + 1;
}

/**
 * 把一个字形重采样进固定字格。
 *
 * 两个要点：
 * 1) 按高度缩放并保持宽高比，水平居中，而不是把包围盒拉满字格。
 *    拉满会让「1」这种 2px 宽的字形变成一整块实心，宽度这个最有判别力的特征直接丢掉。
 * 2) 面积平均而非最近邻。源只有 5×7，面积平均会在笔画边缘生成灰度过渡，
 *    相当于自带抗锯齿，让后续的 L2 匹配对 1px 错位宽容得多。
 */
function normalize(ink: Ink, seg: { x0: number; x1: number }): Float32Array | null {
  let y0 = ink.height;
  let y1 = -1;
  for (let y = 0; y < ink.height; y++) {
    for (let x = seg.x0; x < seg.x1; x++) {
      if (ink.bits[y * ink.width + x]) {
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (y1 < y0) return null;
  const sw = seg.x1 - seg.x0;
  const sh = y1 - y0 + 1;

  const cols = Math.min(GLYPH_W, Math.max(1, Math.round((sw * GLYPH_H) / sh)));
  const xOffset = (GLYPH_W - cols) >> 1;

  const cell = new Float32Array(GLYPH_W * GLYPH_H);
  for (let cy = 0; cy < GLYPH_H; cy++) {
    const ya = y0 + (cy * sh) / GLYPH_H;
    const yb = y0 + ((cy + 1) * sh) / GLYPH_H;
    for (let c = 0; c < cols; c++) {
      const xa = seg.x0 + (c * sw) / cols;
      const xb = seg.x0 + ((c + 1) * sw) / cols;
      let sum = 0;
      let area = 0;
      for (let y = Math.floor(ya); y < Math.ceil(yb); y++) {
        const fy = Math.min(yb, y + 1) - Math.max(ya, y);
        if (fy <= 0) continue;
        for (let x = Math.floor(xa); x < Math.ceil(xb); x++) {
          const fx = Math.min(xb, x + 1) - Math.max(xa, x);
          if (fx <= 0) continue;
          sum += ink.bits[y * ink.width + x] * fx * fy;
          area += fx * fy;
        }
      }
      cell[cy * GLYPH_W + xOffset + c] = area > 0 ? sum / area : 0;
    }
  }
  return cell;
}

/**
 * 最近样本分类。对每个字符取「到该字符任一样本的最小距离」，再在字符之间比较。
 * 不用样本平均：样本少时平均会把不同渲染糊成谁也不像的东西（'8' 曾因此被读成 '6'）。
 */
function classifyGlyph(
  cell: Float32Array,
  exemplars: Record<string, Float32Array[]>,
): { char: string; distance: number; confidence: number } | null {
  let best = Infinity;
  let second = Infinity;
  let bestChar = '';
  for (const char of Object.keys(exemplars)) {
    let charBest = Infinity;
    for (const ex of exemplars[char]) {
      let d = 0;
      for (let i = 0; i < cell.length; i++) {
        const diff = cell[i] - ex[i];
        d += diff * diff;
      }
      if (d < charBest) charBest = d;
    }
    if (charBest < best) {
      second = best;
      best = charBest;
      bestChar = char;
    } else if (charBest < second) {
      second = charBest;
    }
  }
  if (bestChar === '') return null;
  const confidence = !Number.isFinite(second) || second === 0 ? 1 : Math.max(0, 1 - best / second);
  return { char: bestChar, distance: best, confidence };
}

export interface RawRead {
  /** 识别出的字符串，排障时比数字有用 */
  raw: string;
  /** 0..1。取所有字形里最不确定的那个 —— 一位读错整个数就废了，木桶效应。 */
  confidence: number;
  /** 各字形与其最近样本的平均 L2 距离，越小说明这版切分整体越像一行数字 */
  cost: number;
}

function classifyCells(cells: Float32Array[], exemplars: Record<string, Float32Array[]>): RawRead | null {
  let raw = '';
  let confidence = 1;
  let cost = 0;
  for (const cell of cells) {
    const m = classifyGlyph(cell, exemplars);
    if (!m) return null;
    raw += m.char;
    cost += m.distance;
    if (m.confidence < confidence) confidence = m.confidence;
  }
  return { raw, confidence, cost: cost / cells.length };
}

/**
 * 读一块数字 UI。
 *
 * 多假设 + 投票：不同阈值给出的是几乎独立的读数，多数一致的那个远比任何单一打分可靠。
 * 票数相同才比平均样本距离 —— 注意不能比 confidence，那是「最佳 vs 次佳」的相对间隔，
 * 跨切分方案没有可比性，一版把字形切坏的方案完全可能碰巧间隔很大
 * （实测就因此把 198 读成过 196）。
 *
 * `parse` 由调用方给：它既负责把字符串转成结果，也负责格式校验 ——
 * 返回 null 就等于否决这个候选。这是最便宜也最有效的一道防线。
 */
export function readField<T>(
  frame: Frame,
  roi: NormRect,
  counts: GlyphCountRange,
  parse: (read: RawRead) => T | null,
  exemplars: Record<string, Float32Array[]> = EXEMPLARS,
): { value: T; read: RawRead } | null {
  const tally = new Map<string, { votes: number; value: T; read: RawRead }>();
  for (const candidate of segmentCandidates(frame, roi, counts)) {
    const read = classifyCells(candidate.cells, exemplars);
    if (!read) continue;
    const value = parse(read);
    if (value === null) continue;
    const key = JSON.stringify(value);
    const entry = tally.get(key);
    if (!entry) tally.set(key, { votes: 1, value, read });
    else {
      entry.votes++;
      if (read.cost < entry.read.cost) entry.read = read;
    }
  }

  let winner: { votes: number; value: T; read: RawRead } | null = null;
  for (const entry of tally.values()) {
    if (!winner || entry.votes > winner.votes || (entry.votes === winner.votes && entry.read.cost < winner.read.cost)) {
      winner = entry;
    }
  }
  return winner ? { value: winner.value, read: winner.read } : null;
}
