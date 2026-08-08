import { MINIMAP, SELF_MARKER_GREEN, SELF_MARKER_GREEN_VIGNETTE, SELF_MARKER_MIN_AREA_RATIO } from '../rmui/layout';
import type { HsvRange } from '../vision/hsv';
import type { NormRect } from '../vision/frame';
import { distanceTransform, findBlobs } from '../vision/blob';
import { resolveRect, type Frame } from '../vision/frame';
import { maskInRange, type Mask } from '../vision/mask';

export interface SelfMarker {
  /** 小地图 ROI 内的归一化坐标（0..1，左上原点）。转场地真实坐标是渲染层的事。 */
  x: number;
  y: number;
  /**
   * 朝向，弧度。0 = 小地图正右方，顺时针为正（屏幕坐标 y 向下）。
   * null = 找到了圆盘但没找到箭头 —— 位置可信、朝向不可信，两者必须分开表达。
   */
  heading: number | null;
  /** 圆盘半径（小地图 ROI 像素），用于诊断与画面标注。 */
  radius: number;
  /** 命中像素数，用于诊断阈值是否漂了。 */
  area: number;
}

/** 箭头相对圆心的搜索环。内径避开圆盘本体，外径框住三角的最远端。 */
const ARROW_INNER = 1.15;
const ARROW_OUTER = 3.2;
/** 少于这个像素数就不认朝向 —— 一两个噪点算出来的角度毫无意义。 */
const ARROW_MIN_PIXELS = 2;

/** 距离场上「接近峰值」的容差（像素）。圆盘中心被编号数字打洞时，峰值会摊成一圈。 */
const PEAK_TOLERANCE = 0.5;

/**
 * 从一帧里提取自机在小地图上的位置与朝向。
 *
 * 自机在官方小地图上画成「绿色圆盘 + 紧贴外侧的小三角」。同屏还有两类绿：
 * 能量机关是黄绿（色相≈42）、蓝方图标是青（色相≥90），都靠 SELF_MARKER_GREEN
 * 的窄色相区间排掉 —— 实测 623 个命中帧里 622 帧只剩唯一候选。
 *
 * 返回 null 表示这一帧没有可信的自机标记：机器人阵亡、标记被叠图遮住、
 * 或这一路根本没开小地图（实测有操作手全场关着）。调用方必须把它当正常情况处理。
 *
 * roi 默认是地面机器人的小地图。无人机那一路的 HUD 内嵌在子画面里，位置与尺寸都不同，
 * 传 DRONE_MINIMAP —— 算法本身不用改，四旋翼图标同样是「一团绿 + 外挂箭头」，
 * 距离场峰值照样落在机身中心。
 *
 * range 可覆盖是为了标定：色彩窗必须能在评估里扫，否则只能把算法复制一份去扫，
 * 那样扫出来的结论对真正跑的这条路径不作数。生产路径一律用默认值。
 */
export function detectSelfMarker(
  frame: Frame,
  roi: NormRect = MINIMAP,
  minAreaRatio: number = SELF_MARKER_MIN_AREA_RATIO,
  range: HsvRange = SELF_MARKER_GREEN,
): SelfMarker | null {
  const rect = resolveRect(roi, frame.width, frame.height);
  if (rect.w === 0 || rect.h === 0) return null;

  const mask = maskInRange(frame, rect, range);
  const found = locate(mask, Math.max(4, Math.round(minAreaRatio * rect.w * rect.h)));
  if (!found) return null;
  return {
    x: (found.cx + 0.5) / rect.w,
    y: (found.cy + 0.5) / rect.h,
    heading: findHeading(mask, found.cx, found.cy, found.peak),
    radius: found.peak,
    area: found.area,
  };
}

/**
 * 生产路径的检测：主窗交白卷时，用受击红晕的退化窗再试一次。
 *
 * 刻意做成两遍而不是直接把主窗放宽 —— 放宽会把绿标记与相邻青图标之间的低饱和
 * 过渡带收进来，两团并合、质心被悄悄拽走（committed 夹具 B1Hero@1400 实测偏
 * 0.0066，而浏览器那批数据的面积判据根本没抓到）。分成两遍之后，主窗命中的帧
 * 逐位不变，放宽只作用在**本来就要返回 null** 的帧上：那里原本没有任何信息，
 * 多一次尝试只可能改善。实测浏览器 138 个 HUD 帧从 112 收到 120，位移中位
 * 3.40→3.35px 未退化。
 *
 * 代价是丢检帧多跑一遍掩码，而那一帧本来就没产出。实测浏览器现网 222 帧：
 * 0.672 → 0.874 ms/帧（+30%），十路一轮多花约 2ms —— 比取像素本身便宜得多。
 */
export function detectSelfMarkerResilient(
  frame: Frame,
  roi: NormRect = MINIMAP,
  minAreaRatio: number = SELF_MARKER_MIN_AREA_RATIO,
): SelfMarker | null {
  return (
    detectSelfMarker(frame, roi, minAreaRatio, SELF_MARKER_GREEN) ??
    detectSelfMarker(frame, roi, minAreaRatio, SELF_MARKER_GREEN_VIGNETTE)
  );
}

interface Located {
  cx: number;
  cy: number;
  peak: number;
  area: number;
}

/** 在掩码里定位最大的一团，返回距离场峰值处的质心。 */
function locate(mask: Mask, minArea: number): Located | null {
  const { labels, blobs } = findBlobs(mask, minArea);
  if (blobs.length === 0) return null;

  const disc = blobs[0];
  const discMask: Mask = { bits: new Uint8Array(mask.bits.length), width: mask.width, height: mask.height };
  for (let i = 0; i < labels.length; i++) if (labels[i] === disc.label) discMask.bits[i] = 1;

  const dist = distanceTransform(discMask);
  let peak = 0;
  for (let i = 0; i < dist.length; i++) if (dist[i] > peak) peak = dist[i];

  // 取所有接近峰值的像素的质心作为圆心：中心被编号数字打洞时峰值会摊成一圈，
  // 直接取单个 argmax 会落到圆环上的任意一点。
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let i = 0; i < dist.length; i++) {
    if (dist[i] >= peak - PEAK_TOLERANCE) {
      sx += i % mask.width;
      sy += (i / mask.width) | 0;
      n++;
    }
  }
  return { cx: sx / n, cy: sy / n, peak, area: disc.area };
}

/**
 * 朝向 = 圆心指向箭头质心的方向。
 * 刻意在整张掩码上找而不是只在圆盘那个连通域里：实测箭头常常只以对角相接，
 * 480p 下甚至完全断开成 2~8px 的独立小块，限定在同一连通域内会直接丢掉朝向。
 */
function findHeading(mask: Mask, cx: number, cy: number, radius: number): number | null {
  const inner = radius * ARROW_INNER;
  const outer = radius * ARROW_OUTER;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let i = 0; i < mask.bits.length; i++) {
    if (mask.bits[i] === 0) continue;
    const dx = (i % mask.width) - cx;
    const dy = ((i / mask.width) | 0) - cy;
    const d = Math.hypot(dx, dy);
    if (d < inner || d > outer) continue;
    sx += dx;
    sy += dy;
    n++;
  }
  if (n < ARROW_MIN_PIXELS) return null;
  return Math.atan2(sy / n, sx / n);
}
