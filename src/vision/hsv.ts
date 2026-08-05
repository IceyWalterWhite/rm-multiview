// OpenCV 的 8-bit HSV 约定：H∈[0,179]（即真实色相角的一半）、S/V∈[0,255]。
// 本仓库所有色彩阈值都是拿 cv2 在真实赛事录屏上标定出来的，换算约定会让那些
// 常数集体失效，所以这里刻意跟 OpenCV 对齐，而不是用 CSS 的 H∈[0,360]。

export interface Hsv {
  h: number;
  s: number;
  v: number;
}

/** 单像素 RGB→HSV。会分配对象，只用于测试和非热路径；逐像素扫描请用 inHsvRange。 */
export function rgbToHsv(r: number, g: number, b: number): Hsv {
  const v = r > g ? (r > b ? r : b) : g > b ? g : b;
  const min = r < g ? (r < b ? r : b) : g < b ? g : b;
  const d = v - min;
  if (d === 0) return { h: 0, s: 0, v };

  const s = Math.round((d * 255) / v);
  // 分段线性色相：以最大分量决定处于哪个 60° 扇区，再在扇区内插值。
  let h6: number;
  if (v === r) h6 = ((g - b) / d + 6) % 6;
  else if (v === g) h6 = (b - r) / d + 2;
  else h6 = (r - g) / d + 4;
  return { h: Math.round(h6 * 30) % 180, s, v }; // ×30 而非 ×60：8-bit 约定下色相折半
}

export interface HsvRange {
  /** 含端点；hMin>hMax 表示跨 0 的环形区间（红色需要）。 */
  hMin: number;
  hMax: number;
  sMin: number;
  vMin: number;
}

/**
 * 判断像素是否落在阈值区间内，不分配任何对象。
 * 比较顺序按代价排列：V 最便宜且能拒掉绝大多数暗背景像素，S 次之，
 * 色相要做除法所以放最后——热路径上这个顺序比可读顺序快一大截。
 */
export function inHsvRange(r: number, g: number, b: number, range: HsvRange): boolean {
  const v = r > g ? (r > b ? r : b) : g > b ? g : b;
  if (v < range.vMin) return false;

  const min = r < g ? (r < b ? r : b) : g < b ? g : b;
  const d = v - min;
  if (d === 0) return range.sMin === 0; // 纯灰：仅当不要求饱和度时才算命中
  if ((d * 255) / v < range.sMin) return false;

  let h6: number;
  if (v === r) h6 = ((g - b) / d + 6) % 6;
  else if (v === g) h6 = (b - r) / d + 2;
  else h6 = (r - g) / d + 4;
  const h = Math.round(h6 * 30) % 180;

  return range.hMin <= range.hMax
    ? h >= range.hMin && h <= range.hMax
    : h >= range.hMin || h <= range.hMax; // 环形区间
}
