import { estimateEpoch } from './nameClock';
import { decide } from './controller';

// 同步引擎：持有 11 路注册流，1Hz 节拍上以主视角为基准驱动侧路收敛。
// 框架无关（不 import React/DOM 类型），interval 的启停由 hook 层负责。
export interface SyncMedia {
  currentTime: number;
  playbackRate: number;
  paused: boolean;
  buffered: { length: number; end(i: number): number };
}

export interface StreamHandle {
  video: SyncMedia;
  isMain: boolean;
  /** 清晰度档（'1080p' | '720p' | '540p'），决定 δ 的 tier 先验 */
  tier: string;
}

export interface StreamStatus {
  /** wall − target − trim（秒）；无法测量时 null */
  error: number | null;
  mode: 'off' | 'synced' | 'adjusting' | 'edge';
}

export type ByteSink = (
  id: string,
  bytes: ArrayBuffer,
  url: string,
  handle: { isMain: boolean; tier: string },
) => void;

const OFF_STATUS: StreamStatus = { error: null, mode: 'off' };

// 2026-08-01 实测：540p 转码管线名字钟晚标 3.94s（跨视角一致的全局常量）。
// 720p 同为 5s 分片转码流，先验沿用同值，运行时校准（audioCalib）可精修。
export const TIER_PRIOR: Record<string, number> = { '1080p': 0, '720p': 3.94, '540p': 3.94 };
const MAX_SAMPLES = 8;
const TICK_MS = 1000;

interface StreamState {
  handle: StreamHandle;
  samples: { wallSec: number; fragStart: number }[];
  adjusting: boolean;
}

function bufferedEnd(v: SyncMedia): number {
  return v.buffered.length ? v.buffered.end(v.buffered.length - 1) : v.currentTime;
}

export class SyncEngine {
  private streams = new Map<string, StreamState>();
  private enabled = true;
  private trim = 0;
  private viewDelta = new Map<string, number>();
  private listeners = new Set<(s: Map<string, StreamStatus>) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private byteSink: ByteSink | null = null;
  private changeListeners = new Set<() => void>();
  private statusCache = new Map<string, StreamStatus>();

  register(id: string, handle: StreamHandle): () => void {
    this.streams.set(id, { handle, samples: [], adjusting: false });
    return () => {
      const st = this.streams.get(id);
      // hls 重建时新注册可能先于旧清理到达：只删自己的注册
      if (st && st.handle === handle) {
        this.resetStream(st);
        this.streams.delete(id);
      }
    };
  }

  onFrag(id: string, sample: { wallSec: number; fragStart: number }): void {
    const st = this.streams.get(id);
    if (!st) return;
    st.samples.push(sample);
    if (st.samples.length > MAX_SAMPLES) st.samples.shift();
  }

  setEnabled(on: boolean): void {
    if (this.enabled === on) return;
    this.enabled = on;
    if (!on) for (const st of this.streams.values()) this.resetStream(st);
  }

  setTrim(sec: number): void {
    this.trim = sec;
  }

  /** 音频校准写入的 view 常量（叠加在 tier 先验上） */
  setDelta(id: string, sec: number): void {
    this.viewDelta.set(id, sec);
  }

  /** tee 下来的分片字节的去向（audioCalib 的 ingest 胶水） */
  setByteSink(fn: ByteSink | null): void {
    this.byteSink = fn;
  }

  pushBytes(id: string, bytes: ArrayBuffer, url: string): void {
    const st = this.streams.get(id);
    if (!st || !this.byteSink) return;
    this.byteSink(id, bytes, url, { isMain: st.handle.isMain, tier: st.handle.tier });
  }

  subscribe(fn: (s: Map<string, StreamStatus>) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 供 useSyncExternalStore：仅当某路状态实际变化时通知 */
  subscribeChange(fn: () => void): () => void {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }

  /** 引用稳定：状态未变时返回同一对象（1Hz tick 不得击穿 11 路 memo） */
  statusOf(id: string): StreamStatus {
    return this.statusCache.get(id) ?? OFF_STATUS;
  }

  /** hook 层在挂载/开关时调用；tick 也可被测试直接驱动 */
  start(): void {
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  tick(): void {
    if (!this.enabled) return;
    const statuses = new Map<string, StreamStatus>();

    let target: number | null = null;
    for (const [id, st] of this.streams) {
      if (!st.handle.isMain) continue;
      const wall = this.wallOf(id, st);
      if (wall !== null && !st.handle.video.paused) target = wall;
      statuses.set(id, { error: null, mode: wall === null ? 'off' : 'synced' });
      break;
    }

    for (const [id, st] of this.streams) {
      if (st.handle.isMain) continue;
      const v = st.handle.video;
      const wall = this.wallOf(id, st);
      if (target === null || wall === null || v.paused) {
        statuses.set(id, { error: null, mode: 'off' });
        continue;
      }
      const error = wall - target - this.trim;
      const action = decide({
        error,
        currentTime: v.currentTime,
        bufferedEnd: bufferedEnd(v),
        adjusting: st.adjusting,
      });
      let mode: StreamStatus['mode'];
      switch (action.type) {
        case 'rate':
          v.playbackRate = action.rate;
          st.adjusting = true;
          mode = 'adjusting';
          break;
        case 'seek':
          v.currentTime = action.to;
          this.resetStream(st);
          mode = 'adjusting';
          break;
        case 'edge':
          this.resetStream(st);
          mode = 'edge';
          break;
        default:
          this.resetStream(st);
          mode = 'synced';
      }
      statuses.set(id, { error, mode });
    }

    // 稳定引用缓存：mode 或 0.1s 粒度的误差变了才换对象、才通知
    let changed = false;
    for (const [id, s] of statuses) {
      const prev = this.statusCache.get(id);
      const rounded = s.error === null ? null : Math.round(s.error * 10) / 10;
      if (!prev || prev.mode !== s.mode || prev.error !== rounded) {
        this.statusCache.set(id, { error: rounded, mode: s.mode });
        changed = true;
      }
    }
    for (const id of [...this.statusCache.keys()]) {
      if (!statuses.has(id)) {
        this.statusCache.delete(id);
        changed = true;
      }
    }
    if (changed) for (const fn of this.changeListeners) fn();

    for (const fn of this.listeners) fn(statuses);
  }

  private wallOf(id: string, st: StreamState): number | null {
    const epoch = estimateEpoch(st.samples);
    if (epoch === null) return null;
    const delta = (TIER_PRIOR[st.handle.tier] ?? 0) + (this.viewDelta.get(id) ?? 0);
    return epoch + st.handle.video.currentTime - delta;
  }

  private resetStream(st: StreamState): void {
    if (st.handle.video.playbackRate !== 1) st.handle.video.playbackRate = 1;
    st.adjusting = false;
  }
}
