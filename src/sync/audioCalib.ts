import { type OffsetProfiles, type SyncEngine } from './engine';
import { crossCorrelate } from './xcorr';

// 音频互相关校准器：比赛进行时各路共享主视角音频，用 tee 下来的分片音频
// 测出每路名字钟的 view 常量（δ 的 per-view 因子），写入 engine 并按日持久化。
// 素材由播放管道 tee（零额外带宽）；赛间静音时互相关无可信峰 → 自动跳过沿用旧值。
export interface DecodedPcm {
  sampleRate: number;
  channelData: Float32Array;
}
export type DecodeFn = (adts: Uint8Array) => Promise<DecodedPcm>;

export interface CalSegmentInput {
  /** 分片名墙钟（unix 秒） */
  nameSec: number;
  /** 首音频/视频 PES 的 PTS（秒） */
  firstAudioPts: number;
  firstVideoPts: number;
  adts: Uint8Array;
  sampleRate: number | null;
  frameCount: number;
}

export interface CalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface Options {
  decode: DecodeFn;
  storage?: CalStorage;
  /** 注入便于测试；默认当地日期 YYYY-MM-DD（δ 缓存当日有效） */
  today?: () => string;
}

interface Entry extends CalSegmentInput {
  /** 解码+降采样后的 PCM（惰性，null = 解码失败） */
  pcm?: Float32Array | null;
}

interface StreamBuf {
  isMain: boolean;
  tier: string;
  entries: Entry[];
}

// 相关域用「整流能量包络」而非原始 PCM：主视角是导播混音、侧路是场馆通道，
// 同一节目的不同混音在波形级相关性很低（离线实测过不了峰值门限），
// 能量包络则强相关（实测 r≈0.4、单峰无歧义）。500Hz 包络的峰定位精度 ~±0.05s，绰绰有余。
const CAL_SR = 500;
// 30s 而非 20s：各 FPV 是独立拾音（2026-08-06 实测 004↔005 直接对测 peak 仅 0.45），
// 包络里可相关的只有场馆公共声音，占比低的路（弱拾音）峰高塌、锐度过不了门限。
// 窗口加长是唯一不动门限就能提 SNR 的路（×√1.5）——门限绝不能松，弱峰收进来就是错值入库。
// 代价只是每轮素材要攒 30s（BUF_SPAN_SEC 40 装得下），校准慢一点，准比快重要。
const WINDOW_SEC = 30;
const BUF_SPAN_SEC = 40; // 环形缓冲保留跨度
const MAX_SEARCH_SEC = 8; // δ 差搜索半径（实测 ≤4.4s，留裕量）
// v3 把主视角 ID/分辨率与侧视角 ID/分辨率全部写进 profile key。
// v2 缺少侧路分辨率，无法判断旧值是否适用于当前实际播放源，不能迁移。
const STORE_KEY = 'rm.sync.offset.v3';
const CAL_INTERVAL_MS = 60_000;
// 开赛探针：比赛时各路共享主视角音频，赛间 FPV 是**数字静音**——
// 2026-08-04 现网实测采样值恒为 0（peak 严格 0，非低电平），出声段包络 rms ≈0.05。
// 门限放在两者之间任何位置都行，取 1e-3 纯粹留余量（解码链路可能混入微量抖动）。
const LIVE_RMS = 1e-3;
// 10s：比 calibrate 的 60s 密得多。这只解最新一片、不做互相关，一片几毫秒，开销可忽略。
const PROBE_INTERVAL_MS = 10_000;

function defaultToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 浏览器 ADTS 解码器：Chromium/Firefox 的 decodeAudioData 原生吃 ADTS AAC。
// 不支持的环境首次解码即抛错 → assemble 标记 pcm=null → 校准整层安静降级（L1 兜底）。
export function createAdtsDecoder(): DecodeFn {
  let ctx: OfflineAudioContext | null = null;
  return async (adts: Uint8Array): Promise<DecodedPcm> => {
    ctx ??= new OfflineAudioContext(1, 1, 44100);
    const copy = adts.slice(); // decodeAudioData 会 detach buffer，给它独立副本
    const audio = await ctx.decodeAudioData(copy.buffer as ArrayBuffer);
    return { sampleRate: audio.sampleRate, channelData: audio.getChannelData(0) };
  };
}

function defaultStorage(): CalStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** 整流包络降采样：每块取 |x| 均值（不同混音间只有能量包络稳定共享） */
function downsample(pcm: Float32Array, srcSr: number, dstSr: number): Float32Array {
  const k = Math.max(1, Math.round(srcSr / dstSr));
  const out = new Float32Array(Math.floor(pcm.length / k));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    const base = i * k;
    for (let j = 0; j < k; j++) sum += Math.abs(pcm[base + j]);
    out[i] = sum / k;
  }
  return out;
}

interface Assembled {
  signal: Float32Array;
  /** 信号起点对应的名字域时刻（秒） */
  startWall: number;
}

/** localStorage 只保存当天的完整实测 profile；没有默认值。 */
interface Stored {
  date?: string;
  profiles?: OffsetProfiles;
}

export class AudioCalibrator {
  private engine: SyncEngine;
  private decode: DecodeFn;
  private storage: CalStorage | undefined;
  private today: () => string;
  private streams = new Map<string, StreamBuf>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private probeTimer: ReturnType<typeof setInterval> | null = null;
  private calibrating = false;

  constructor(engine: SyncEngine, opts: Options) {
    this.engine = engine;
    this.decode = opts.decode;
    this.storage = opts.storage ?? defaultStorage();
    this.today = opts.today ?? defaultToday;
    this.restore();
  }

  ingest(id: string, meta: { isMain: boolean; tier: string }, seg: CalSegmentInput): void {
    if (seg.frameCount === 0 || !seg.sampleRate) return;
    let buf = this.streams.get(id);
    if (!buf || buf.isMain !== meta.isMain || buf.tier !== meta.tier) {
      buf = { isMain: meta.isMain, tier: meta.tier, entries: [] };
      this.streams.set(id, buf);
    }
    buf.entries.push({ ...seg });
    while (
      buf.entries.length > 1 &&
      buf.entries[buf.entries.length - 1].nameSec - buf.entries[0].nameSec > BUF_SPAN_SEC
    ) {
      buf.entries.shift();
    }
  }

  /** 对全部侧路做一轮校准；返回成功写入 δ 的路数 */
  async calibrate(): Promise<number> {
    if (this.calibrating) return 0;
    this.calibrating = true;
    try {
      const mainEntry = [...this.streams.entries()].find(([, b]) => b.isMain && b.entries.length > 0);
      if (!mainEntry) return 0;
      const [, mainBuf] = mainEntry;
      const main = await this.assemble(mainBuf);
      if (!main) return 0;

      // 全程相对主视角测量，主视角身份就是这批数的参照系。assemble 要 await 解码，
      // 期间用户完全可能换档/换主视角——开头锁定，写入前复查，不一致整轮丢弃。
      const ref = this.engine.mainRef();
      if (ref === null) return 0;

      let ok = 0;
      const saved: Record<string, { offset: number; sideTier: string }> = {};
      for (const [id, buf] of this.streams) {
        if (buf.isMain || buf.entries.length === 0) continue;
        const side = await this.assemble(buf);
        if (!side) continue;
        // 数组域 lag → 名字域 δ 差：δ_side − δ_main = lag + (side起点 − main起点)
        const baseOffset = side.startWall - main.startWall;
        const r = crossCorrelate(
          main.signal,
          side.signal,
          CAL_SR,
          MAX_SEARCH_SEC + Math.min(15, Math.abs(baseOffset)),
        );
        if (!r) continue;
        // 这就是最终答案：这一路相对主视角错开多少秒。
        // 不再拆成「档位常量 + 每路残差」——拆完用的时候还要拼回去，净效果为零，
        // 反而让存档绑死在档位常量上（常量一改，旧存档全部失准）。
        const offset = r.lagSec + baseOffset;
        saved[id] = { offset, sideTier: buf.tier };
        ok++;
      }
      if (ok === 0) return 0;
      // 复查：换过参照系的话这批数除了误导控制器没有任何用处，直接扔
      if (this.engine.mainRef() !== ref) return 0;
      for (const [id, value] of Object.entries(saved)) {
        this.engine.setOffset(id, value.offset, { mainRef: ref, sideTier: value.sideTier });
      }
      this.persist(saved, ref);
      return ok;
    } finally {
      this.calibrating = false;
    }
  }

  /**
   * 开赛探针：只解各侧路最新一片、不做互相关。
   * 返回 true=比赛进行中、false=赛间、null=没有可判的素材（无分片或解码不可用）。
   * 判据即「FPV 路有没有声音」——比赛时各路共享主视角音频，赛间是数字静音。
   * 用 null 而非 false 表示「不知道」：消费方据此保持原状，不会把解码失败误当成赛间。
   */
  async probeLive(): Promise<boolean | null> {
    let decoded = 0;
    let sounding = 0;
    for (const buf of this.streams.values()) {
      if (buf.isMain) continue; // 主视角全程有解说，拿它判必然恒真
      const last = buf.entries.at(-1);
      if (!last) continue;
      if (last.pcm === undefined) {
        try {
          const d = await this.decode(last.adts);
          last.pcm = downsample(d.channelData, d.sampleRate, CAL_SR);
        } catch {
          last.pcm = null;
        }
      }
      if (!last.pcm || last.pcm.length === 0) continue;
      decoded++;
      let sum = 0;
      for (const x of last.pcm) sum += x * x;
      if (Math.sqrt(sum / last.pcm.length) > LIVE_RMS) sounding++;
    }
    if (decoded === 0) return null;
    return sounding > 0; // 任一路出声即算开赛：各路出声差一个分片（实测 ~6s），取最早的那个
  }

  start(intervalMs: number = CAL_INTERVAL_MS): void {
    if (!this.timer) this.timer = setInterval(() => void this.calibrate(), intervalMs);
    if (!this.probeTimer) {
      this.probeTimer = setInterval(() => void this.publishLive(), PROBE_INTERVAL_MS);
      void this.publishLive(); // 首次立即探一发，别让角标白挂 10 秒
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.probeTimer) {
      clearInterval(this.probeTimer);
      this.probeTimer = null;
    }
  }

  private async publishLive(): Promise<void> {
    this.engine.setMatchLive(await this.probeLive());
  }

  /** 把一路缓冲装配成名字域连续信号（空洞按 PTS 定位、补零） */
  private async assemble(buf: StreamBuf): Promise<Assembled | null> {
    const entries = buf.entries;
    for (const e of entries) {
      if (e.pcm === undefined) {
        try {
          const d = await this.decode(e.adts);
          e.pcm = downsample(d.channelData, d.sampleRate, CAL_SR);
        } catch {
          e.pcm = null; // 解码失败（如 decodeAudioData 不支持 ADTS）→ 跳过该段
        }
      }
    }
    const usable = entries.filter((e) => e.pcm && e.pcm.length > 0);
    if (usable.length === 0) return null;

    // E_seg = 名字秒 − 首视频 PTS；音频样本 n 的名字域时刻 = E + firstAudioPts + n/SR
    const wallStartOf = (e: Entry) => e.nameSec - e.firstVideoPts + e.firstAudioPts;
    const wallEnd = Math.max(...usable.map((e) => wallStartOf(e) + e.pcm!.length / CAL_SR));
    const wallStart = Math.max(
      Math.min(...usable.map((e) => wallStartOf(e))),
      wallEnd - WINDOW_SEC,
    );
    const n = Math.ceil((wallEnd - wallStart) * CAL_SR);
    if (n < CAL_SR) return null; // 有效窗不足 1s
    const signal = new Float32Array(n);
    for (const e of usable) {
      const at = Math.round((wallStartOf(e) - wallStart) * CAL_SR);
      const pcm = e.pcm!;
      for (let i = 0; i < pcm.length; i++) {
        const j = at + i;
        if (j >= 0 && j < n) signal[j] = pcm[i];
      }
    }
    return { signal, startWall: wallStart };
  }

  private restore(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as Stored;
      if (data.date !== this.today() || !data.profiles) return;
      this.engine.restoreOffsets(data.profiles);
    } catch {
      // 损坏的缓存直接忽略
    }
  }

  private persist(
    updates: Record<string, { offset: number; sideTier: string }>,
    mainRef: string,
  ): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORE_KEY);
      const prev = raw ? (JSON.parse(raw) as Stored) : {};
      const profiles: OffsetProfiles = prev.date === this.today() && prev.profiles
        ? structuredClone(prev.profiles)
        : {};
      const byStream = profiles[mainRef] ??= {};
      for (const [id, value] of Object.entries(updates)) {
        const byTier = byStream[id] ??= {};
        byTier[value.sideTier] = value.offset;
      }
      this.storage.setItem(STORE_KEY, JSON.stringify({ date: this.today(), profiles }));
    } catch {
      // 存不进就算了：内存里的偏移仍然生效
    }
  }
}
