import type { Mask } from './mask';

export interface Blob {
  label: number;
  area: number;
  /** 质心（掩码局部坐标，像素中心制） */
  cx: number;
  cy: number;
  /** 包围盒，x1/y1 为开区间 */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface BlobResult {
  /** 与掩码同尺寸；0 = 背景，>0 = blob.label */
  labels: Int32Array;
  blobs: Blob[];
}

/**
 * 8 连通域标注。用显式栈的漫水填充而非两遍并查集：ROI 只有几百到几万像素，
 * 漫水一遍就出全部统计量，省掉第二遍扫描和 union-find 的路径压缩。
 * 结果按面积降序 —— 调用方几乎总是只要最大的那个。
 */
export function findBlobs(mask: Mask, minArea = 1): BlobResult {
  const { bits, width, height } = mask;
  const labels = new Int32Array(width * height);
  const blobs: Blob[] = [];
  const stack: number[] = [];
  let next = 0;

  for (let seed = 0; seed < bits.length; seed++) {
    if (bits[seed] === 0 || labels[seed] !== 0) continue;
    const label = ++next;
    let area = 0;
    let sx = 0;
    let sy = 0;
    let x0 = width;
    let y0 = height;
    let x1 = 0;
    let y1 = 0;

    labels[seed] = label;
    stack.push(seed);
    while (stack.length > 0) {
      const idx = stack.pop()!;
      const x = idx % width;
      const y = (idx / width) | 0;
      area++;
      sx += x;
      sy += y;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x >= x1) x1 = x + 1;
      if (y >= y1) y1 = y + 1;

      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const n = ny * width + nx;
          if (bits[n] === 1 && labels[n] === 0) {
            labels[n] = label;
            stack.push(n);
          }
        }
      }
    }

    if (area >= minArea) {
      blobs.push({ label, area, cx: sx / area, cy: sy / area, x0, y0, x1, y1 });
    }
  }

  blobs.sort((a, b) => b.area - a.area);
  return { labels, blobs };
}

/**
 * 掩码内每个前景像素到最近背景的距离（3-4 倒角近似，除以 3 归一到像素单位）。
 * 自机标记是「圆盘 + 外挂小三角」，圆盘是整个形状里最"厚"的部分，
 * 所以距离场的峰值天然落在圆心上 —— 这比取质心稳，质心会被三角形拽偏。
 */
export function distanceTransform(mask: Mask): Float32Array {
  const { bits, width, height } = mask;
  const INF = 1e9;
  const dist = new Float32Array(width * height);
  for (let i = 0; i < bits.length; i++) dist[i] = bits[i] === 1 ? INF : 0;

  // 帧外一律视作背景。不这么做的话，贴着 ROI 边缘的形状会被当成"无限厚"，
  // 距离场峰值就会跑到边上去，圆心定位直接失准。
  for (let x = 0; x < width; x++) {
    if (bits[x] === 1) dist[x] = 3;
    const b = (height - 1) * width + x;
    if (bits[b] === 1) dist[b] = 3;
  }
  for (let y = 0; y < height; y++) {
    const l = y * width;
    if (bits[l] === 1) dist[l] = 3;
    const r = l + width - 1;
    if (bits[r] === 1) dist[r] = 3;
  }

  const relax = (idx: number, from: number, cost: number) => {
    const d = dist[from] + cost;
    if (d < dist[idx]) dist[idx] = d;
  };

  // 前向：左上 → 右下
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (dist[i] === 0) continue;
      if (y > 0) {
        relax(i, i - width, 3);
        if (x > 0) relax(i, i - width - 1, 4);
        if (x < width - 1) relax(i, i - width + 1, 4);
      }
      if (x > 0) relax(i, i - 1, 3);
    }
  }
  // 反向：右下 → 左上
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (dist[i] === 0) continue;
      if (y < height - 1) {
        relax(i, i + width, 3);
        if (x > 0) relax(i, i + width - 1, 4);
        if (x < width - 1) relax(i, i + width + 1, 4);
      }
      if (x < width - 1) relax(i, i + 1, 3);
    }
  }

  for (let i = 0; i < dist.length; i++) dist[i] = dist[i] >= INF ? 0 : dist[i] / 3;
  return dist;
}
