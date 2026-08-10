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
  /** 实际播放源的清晰度档；用于选择完全匹配的实测 offset */
  tier: string;
}

export interface OffsetMetadata {
  mainRef: string;
  sideTier: string;
}

/** 主视角身份 → 侧路 ID → 侧路分辨率 → 实测 offset */
export type OffsetProfiles = Record<string, Record<string, Record<string, number>>>;

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
  /** 仅保存实测值；按主视角身份、侧路 ID、侧路分辨率三层索引 */
  private offsets = new Map<string, Map<string, Map<string, number>>>();
  private listeners = new Set<(s: Map<string, StreamStatus>) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private byteSink: ByteSink | null = null;
  private changeListeners = new Set<() => void>();
  private statusCache = new Map<string, StreamStatus>();
  /** 比赛是否进行中；null = 还判不出来。仅供 UI 取舍，不参与控制决策 */
  private matchLive: boolean | null = null;

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
    if (on) return;
    for (const st of this.streams.values()) this.resetStream(st);
    // 关掉后 tick 直接 return，statusCache 会冻结在最后一帧——角标订阅的正是它，
    // 不清就会永远定格在关闭那一刻的读数。清空 + 通知，让各路回落到 off。
    if (this.statusCache.size === 0) return;
    this.statusCache.clear();
    for (const fn of this.changeListeners) fn();
  }

  setTrim(sec: number): void {
    this.trim = sec;
  }

  /** 写入一条完整元数据匹配的实测 offset；不存在任何先验或默认值。 */
  setOffset(id: string, sec: number, meta: OffsetMetadata): void {
    let byStream = this.offsets.get(meta.mainRef);
    if (!byStream) {
      byStream = new Map();
      this.offsets.set(meta.mainRef, byStream);
    }
    let byTier = byStream.get(id);
    if (!byTier) {
      byTier = new Map();
      byStream.set(id, byTier);
    }
    byTier.set(meta.sideTier, sec);
  }

  /** 只返回与当前主视角和当前侧路分辨率完全匹配的实测值。 */
  offsetOf(id: string): number | undefined {
    const ref = this.mainRef();
    const st = this.streams.get(id);
    if (ref === null || !st || st.handle.isMain) return undefined;
    return this.offsets.get(ref)?.get(id)?.get(st.handle.tier);
  }

  /** 当前主视角的 ID + 实际播放分辨率，构成 offset 的主参照元数据。 */
  mainRef(): string | null {
    for (const [id, st] of this.streams) {
      if (st.handle.isMain) return `${id}|${st.handle.tier}`;
    }
    return null;
  }

  /** 构造期可先恢复全部 profile；真正使用时由 offsetOf 按当前元数据选择。 */
  restoreOffsets(profiles: OffsetProfiles): void {
    for (const [mainRef, byStream] of Object.entries(profiles)) {
      for (const [id, byTier] of Object.entries(byStream)) {
        for (const [sideTier, sec] of Object.entries(byTier)) {
          if (Number.isFinite(sec)) this.setOffset(id, sec, { mainRef, sideTier });
        }
      }
    }
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

  /**
   * 开赛状态（audioCalib 的探针写入）。刻意**不**参与控制决策——
   * 赛间垫片同样要对齐，只是没必要把误差摆到观众眼前。
   */
  setMatchLive(v: boolean | null): void {
    if (this.matchLive === v) return;
    this.matchLive = v;
    for (const fn of this.changeListeners) fn();
  }

  isMatchLive(): boolean | null {
    return this.matchLive;
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
      // 主视角是基准：偏移恒为 0，它自己永不被调整
      const wall = this.wallOf(st, 0);
      if (wall !== null && !st.handle.video.paused) target = wall;
      statuses.set(id, { error: null, mode: wall === null ? 'off' : 'synced' });
      break;
    }

    for (const [id, st] of this.streams) {
      if (st.handle.isMain) continue;
      const v = st.handle.video;
      const offset = this.offsetOf(id);
      // 没有与当前元数据匹配的实测 offset，就不参与同步。猜测会制造不可验证的 seek。
      if (offset === undefined) {
        this.resetStream(st);
        statuses.set(id, { error: null, mode: 'off' });
        continue;
      }
      const wall = this.wallOf(st, offset);
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

  /**
   * 把播放位置换算成「内容时刻」，单位与分片名的 unix 秒同域。
   * offset = 这一路的名字钟比主视角快多少秒（主视角自己传 0）。
   * 同步只需要相对量，所以主视角的绝对管线延迟无须知道，也无从知道。
   */
  private wallOf(st: StreamState, offset: number): number | null {
    const epoch = estimateEpoch(st.samples);
    if (epoch === null) return null;
    return epoch + st.handle.video.currentTime - offset;
  }

  private resetStream(st: StreamState): void {
    if (st.handle.video.playbackRate !== 1) st.handle.video.playbackRate = 1;
    st.adjusting = false;
  }
}
