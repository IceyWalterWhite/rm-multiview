import { describe, it, expect } from 'vitest';
import { findBlobs, distanceTransform } from './blob';
import type { Mask } from './mask';

function maskOf(rows: string[]): Mask {
  const width = rows[0].length;
  const bits = new Uint8Array(width * rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) bits[y * width + x] = row[x] === '#' ? 1 : 0;
  });
  return { bits, width, height: rows.length };
}

describe('findBlobs', () => {
  it('separates disconnected regions and sorts them largest first', () => {
    const { blobs } = findBlobs(
      maskOf([
        '##...#',
        '##....',
        '......',
        '....##',
      ]),
    );
    expect(blobs.map((b) => b.area)).toEqual([4, 2, 1]);
    expect(blobs[0]).toMatchObject({ x0: 0, y0: 0, x1: 2, y1: 2, cx: 0.5, cy: 0.5 });
  });

  it('joins diagonal neighbours (8-connectivity)', () => {
    // 自机标记的三角箭头常常只以对角与圆盘相接，4 连通会把它切掉、朝向就丢了
    const { blobs } = findBlobs(maskOf(['#.', '.#']));
    expect(blobs).toHaveLength(1);
    expect(blobs[0].area).toBe(2);
  });

  it('drops blobs below minArea', () => {
    const { blobs } = findBlobs(maskOf(['##.#', '##..']), 4);
    expect(blobs.map((b) => b.area)).toEqual([4]);
  });
});

describe('distanceTransform', () => {
  it('peaks at the thickest part of the shape, not at its centroid', () => {
    // 5×5 圆盘右侧挂一条细尾巴 —— 质心会被尾巴拽向右，距离场峰值不会
    const mask = maskOf([
      '.###..',
      '#####.',
      '######',
      '#####.',
      '.###..',
    ]);
    const dist = distanceTransform(mask);
    let best = -1;
    let bestIdx = 0;
    dist.forEach((d, i) => {
      if (d > best) {
        best = d;
        bestIdx = i;
      }
    });
    expect(bestIdx % mask.width).toBe(2); // 圆盘中心列
    expect((bestIdx / mask.width) | 0).toBe(2);

    const { blobs } = findBlobs(mask);
    expect(blobs[0].cx).toBeGreaterThan(2); // 质心确实被尾巴拽偏了
  });

  it('treats outside the mask as background so edge shapes are not infinitely thick', () => {
    const dist = distanceTransform(maskOf(['####', '####']));
    // 全前景：每个像素都贴边，厚度只能是 1
    expect(Math.max(...dist)).toBe(1);
  });

  it('returns zero for background pixels', () => {
    const mask = maskOf(['.#.', '...']);
    const dist = distanceTransform(mask);
    expect(dist[0]).toBe(0);
    expect(dist[1]).toBe(1);
  });
});
