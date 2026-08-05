import { describe, it, expect } from 'vitest';
import { mergeReadRects, readRectsFor, roisFor } from './rois';
import { resolveRect, type PixelRect } from '../vision/frame';
import { MINIMAP, TOP_SCOREBOARD } from '../rmui/layout';

const W = 1152;
const H = 648;
const area = (r: PixelRect) => r.w * r.h;
const covers = (outer: PixelRect, inner: PixelRect) =>
  outer.x <= inner.x &&
  outer.y <= inner.y &&
  outer.x + outer.w >= inner.x + inner.w &&
  outer.y + outer.h >= inner.y + inner.h;

describe('mergeReadRects', () => {
  it('并完之后每一块原 ROI 仍被完整覆盖', () => {
    // 这是合并的正确性底线：少读一个像素，检测就会在边缘上出错
    for (const kind of ['ground', 'drone'] as const) {
      const originals = roisFor(kind).map((r) => resolveRect(r, W, H));
      const merged = readRectsFor(kind, W, H);
      for (const o of originals) {
        expect(merged.some((m) => covers(m, o))).toBe(true);
      }
    }
  });

  it('地面路七块压到四次读回', () => {
    // 540p 下的实际分块（像素坐标）：
    //   顶部左半  记分板 + 红方前哨/基地       333×26
    //   顶部右半  蓝方基地/前哨               121×13
    //   右下      小地图                     240×135
    //   左下      血量数字                    62×15
    // 顶部左右两半**不并**：它们中间隔着 900 px 的画面宽度，并起来面积是两者之和的
    // 2.7 倍，被 maxWaste 挡住了。这正是要的行为 —— 多读一次好过白读大半张画面。
    expect(roisFor('ground')).toHaveLength(7);
    expect(readRectsFor('ground', W, H)).toHaveLength(4);
    expect(readRectsFor('drone', W, H)).toHaveLength(2);
  });

  it('不会为了凑数把画面两头并到一起', () => {
    // 小地图在右下、记分板在顶部，并起来就是大半张画面 —— 那还不如整帧读
    const far = [MINIMAP, TOP_SCOREBOARD].map((r) => resolveRect(r, W, H));
    expect(mergeReadRects(far)).toHaveLength(2);
  });

  it('总读回面积远小于整帧', () => {
    const merged = readRectsFor('ground', W, H);
    const total = merged.reduce((s, r) => s + area(r), 0);
    expect(total).toBeLessThan(W * H * 0.2);
  });

  it('结果与输入次序无关', () => {
    const rects = roisFor('ground').map((r) => resolveRect(r, W, H));
    const a = mergeReadRects(rects);
    const b = mergeReadRects([...rects].reverse());
    const key = (rs: PixelRect[]) =>
      rs
        .map((r) => `${r.x},${r.y},${r.w},${r.h}`)
        .sort()
        .join('|');
    expect(key(a)).toBe(key(b));
  });

  it('丢掉零面积矩形', () => {
    expect(mergeReadRects([{ x: 0, y: 0, w: 0, h: 10 }])).toHaveLength(0);
  });
});
