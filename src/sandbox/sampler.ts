import type { Frame, PixelRect } from '../vision/frame';
import { readRectsFor } from './rois';
import type { StreamKind } from './types';

/**
 * 从正在播放的 `<video>` 上取像素。
 *
 * 这是整个沙盘唯一碰浏览器 API 的地方 —— 上游的检测全是纯函数，喂进去的
 * {@link Frame} 无论来自这里还是来自离线抽帧管线都一样。
 *
 * ## 为什么能零额外带宽
 *
 * 画面已经在播了。`drawImage(video)` 读的是解码器已经产出的那一帧，
 * 不额外发一个字节。代价只有 GPU→主存的读回。
 *
 * ## 三个必须处理的现实
 *
 * 1. **画布污染**：原生 HLS 直连 CDN 会让 canvas 变成 tainted，`getImageData`
 *    抛 SecurityError。这依赖 main 上「强制走 hls.js」的修复；万一哪天回退了，
 *    这里要能认出来并把那一路标成不可用，而不是让整个循环崩掉。
 * 2. **还没解码出画面**：readyState < HAVE_CURRENT_DATA 或 videoWidth 为 0 时
 *    drawImage 画的是空白。跳过，不要产出一帧全黑喂给检测器。
 * 3. **隐藏标签页**：Chrome 在隐藏标签页里根本不启动媒体加载，一帧都拿不到。
 *    这不是本模块能解决的，但调用方要知道 —— 沙盘在后台标签页里必然停摆。
 */

/** 一路采样目标。video 由调用方从 DOM 里找（本模块不认识 React 也不认识布局）。 */
export interface SampleTarget {
  id: string;
  video: HTMLVideoElement;
  kind: StreamKind;
}

export interface SampleResult {
  id: string;
  /** 全尺寸帧，只有 ROI 区域填了真像素，其余留黑。检测器只看 ROI。 */
  frame: Frame;
}

export interface SamplerStats {
  /** 上一轮实际取到的路数 */
  grabbed: number;
  /** 上一轮跳过的路数（没解码出画面） */
  skipped: number;
  /** 画布被污染的路（一旦发生就长期记着，别每帧都去撞） */
  tainted: string[];
  /** 上一轮耗时（ms） */
  lastMs: number;
}

export interface Sampler {
  grab(targets: readonly SampleTarget[]): SampleResult[];
  readonly stats: SamplerStats;
  dispose(): void;
}

interface Slot {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  rects: PixelRect[];
}

function makeCanvas(): {
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  resize(w: number, h: number): void;
} {
  // willReadFrequently 让浏览器把这块画布留在主存而不是显存 —— 我们每帧都要读回，
  // 走显存等于每次都付一次同步代价。实测这个标志比任何微优化都管用。
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(1, 1);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('sandbox sampler: 拿不到 2d 上下文');
    return {
      ctx,
      resize(w, h) {
        if (c.width !== w || c.height !== h) {
          c.width = w;
          c.height = h;
        }
      },
    };
  }
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('sandbox sampler: 拿不到 2d 上下文');
  return {
    ctx,
    resize(w, h) {
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
    },
  };
}

export function createSampler(): Sampler {
  const canvas = makeCanvas();
  // 每一路一块常驻缓冲，跨轮复用。
  // 不复用的话：1152×648×4 = 2.99 MB，十路每轮 30 MB，4 Hz 就是 120 MB/s 的
  // 分配速率，GC 会把主线程搅得一顿一顿的。
  const slots = new Map<string, Slot>();
  const tainted = new Set<string>();
  const stats: SamplerStats = { grabbed: 0, skipped: 0, tainted: [], lastMs: 0 };

  function slotFor(id: string, kind: StreamKind, w: number, h: number): Slot {
    const hit = slots.get(id);
    if (hit && hit.width === w && hit.height === h) return hit;
    const slot: Slot = {
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
      rects: readRectsFor(kind, w, h),
    };
    // ROI 之外恒为不透明黑。检测器本就不该读那些像素，万一读了会立刻表现成异常，
    // 而不是悄悄用上一轮的残留。
    for (let i = 3; i < slot.data.length; i += 4) slot.data[i] = 255;
    slots.set(id, slot);
    return slot;
  }

  return {
    grab(targets) {
      const t0 = performance.now();
      const out: SampleResult[] = [];
      let skipped = 0;

      for (const t of targets) {
        if (tainted.has(t.id)) {
          skipped++;
          continue;
        }
        const w = t.video.videoWidth;
        const h = t.video.videoHeight;
        // HAVE_CURRENT_DATA=2：至少有当前帧可画。更低的话 drawImage 画出来是空白
        if (!w || !h || t.video.readyState < 2) {
          skipped++;
          continue;
        }

        const slot = slotFor(t.id, t.kind, w, h);
        canvas.resize(w, h);
        canvas.ctx.drawImage(t.video, 0, 0);

        try {
          for (const r of slot.rects) {
            const img = canvas.ctx.getImageData(r.x, r.y, r.w, r.h);
            for (let row = 0; row < r.h; row++) {
              const src = row * r.w * 4;
              const dst = ((r.y + row) * w + r.x) * 4;
              slot.data.set(img.data.subarray(src, src + r.w * 4), dst);
            }
          }
        } catch (e) {
          // SecurityError = 画布被跨源视频污染。这一路从此不可用，记下来别再撞。
          // 这是个**没有可见症状**的故障：画面照常播，只有取像素会失败。
          tainted.add(t.id);
          stats.tainted = [...tainted];
          console.error(`[sandbox] ${t.id} 画布被污染，该路无法取像素`, e);
          skipped++;
          continue;
        }

        out.push({ id: t.id, frame: { data: slot.data, width: w, height: h } });
      }

      stats.grabbed = out.length;
      stats.skipped = skipped;
      stats.lastMs = performance.now() - t0;
      return out;
    },
    stats,
    dispose() {
      slots.clear();
      tainted.clear();
    },
  };
}
