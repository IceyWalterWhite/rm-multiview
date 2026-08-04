import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioCalibrator, type DecodedPcm } from './audioCalib';
import { SyncEngine } from './engine';

// ---- 合成场景 ----
// 共享内容 c(t)：确定性噪声，采样率 CAL 域 8kHz
const SR = 8000;
function contentNoise(len: number, seed = 9): Float32Array {
  const out = new Float32Array(len);
  let s = seed >>> 0;
  for (let i = 0; i < len; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = s / 0xffffffff - 0.5;
  }
  return out;
}
const CONTENT = contentNoise(SR * 30); // 30s 共享内容，t=0 起

// 每个「分片」的假 ADTS 就是一个索引标记；假 decode 按标记切出对应内容 PCM。
// 流的名字钟带偏差 δ：内容 t 在该流的名字域时刻 = t + δ
interface FakeSeg {
  contentStart: number; // 内容域起点（秒）
  dur: number;
}
function makeStream(
  cal: AudioCalibrator,
  id: string,
  opts: { isMain: boolean; tier: string; delta: number; segs: FakeSeg[]; pcmRegistry: Map<number, Float32Array> },
) {
  for (const [i, seg] of opts.segs.entries()) {
    const marker = opts.pcmRegistry.size;
    opts.pcmRegistry.set(
      marker,
      CONTENT.subarray(Math.round(seg.contentStart * SR), Math.round((seg.contentStart + seg.dur) * SR)),
    );
    // 名字钟秒 = 内容起点 + δ（取整模拟 1s 命名分辨率对 E 的影响；PTS 保留小数精度）
    const nameSec = Math.round(seg.contentStart + opts.delta);
    const firstVideoPts = seg.contentStart + opts.delta - nameSec + seg.contentStart; // E_seg = nameSec − firstVideoPts
    cal.ingest(id, { isMain: opts.isMain, tier: opts.tier }, {
      nameSec: seg.contentStart + opts.delta, // 用未取整名字钟以便断言精确 δ（取整鲁棒性由 nameClock 中位数测试覆盖）
      firstAudioPts: seg.contentStart,
      firstVideoPts: seg.contentStart,
      adts: new Uint8Array([marker]),
      sampleRate: SR,
      frameCount: Math.round(seg.dur * 43),
    });
    void i;
    void firstVideoPts;
  }
}

describe('AudioCalibrator', () => {
  let engine: SyncEngine;
  let setDelta: ReturnType<typeof vi.spyOn>;
  let pcmRegistry: Map<number, Float32Array>;
  let cal: AudioCalibrator;

  const decode = async (adts: Uint8Array): Promise<DecodedPcm> => {
    const pcm = pcmRegistry.get(adts[0]);
    if (!pcm) throw new Error('unknown marker');
    return { sampleRate: SR, channelData: pcm };
  };

  beforeEach(() => {
    engine = new SyncEngine();
    setDelta = vi.spyOn(engine, 'setDelta');
    pcmRegistry = new Map();
    // 隔离存储：默认 storage 是真实 localStorage，会把上个用例持久化的 δ restore 进来
    const store = new Map<string, string>();
    cal = new AudioCalibrator(engine, {
      decode,
      storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    });
  });

  it('measures a side view constant against main and writes it to the engine', async () => {
    // main：1080p，δ=0，内容 [0, 12]（6×2s 片）
    makeStream(cal, 'main', {
      isMain: true, tier: '1080p', delta: 0, pcmRegistry,
      segs: Array.from({ length: 6 }, (_, i) => ({ contentStart: i * 2, dur: 2 })),
    });
    // side：1080p（tier 先验 0），真实 view 常量 2.5s，内容 [0, 15]（3×5s 片）
    makeStream(cal, 's1', {
      isMain: false, tier: '1080p', delta: 2.5, pcmRegistry,
      segs: Array.from({ length: 3 }, (_, i) => ({ contentStart: i * 5, dur: 5 })),
    });

    const ok = await cal.calibrate();
    expect(ok).toBe(1);
    expect(setDelta).toHaveBeenCalledOnce();
    const [id, view] = setDelta.mock.calls[0] as unknown as [string, number];
    expect(id).toBe('s1');
    expect(view).toBeCloseTo(2.5, 1);
  });

  it('subtracts the tier prior so a 540p side stream stores only its view constant', async () => {
    makeStream(cal, 'main', {
      isMain: true, tier: '1080p', delta: 0, pcmRegistry,
      segs: Array.from({ length: 6 }, (_, i) => ({ contentStart: i * 2, dur: 2 })),
    });
    // 540p：名字钟总偏差 = tier 3.94 + view 0.5 = 4.44
    makeStream(cal, 's540', {
      isMain: false, tier: '540p', delta: 4.44, pcmRegistry,
      segs: Array.from({ length: 3 }, (_, i) => ({ contentStart: i * 5, dur: 5 })),
    });

    await cal.calibrate();
    const [, view] = setDelta.mock.calls[0] as unknown as [string, number];
    expect(view).toBeCloseTo(0.5, 1);
  });

  it('measures through the correlation-lag channel when window starts are offset (判决 lag 通道符号)', async () => {
    // main 覆盖内容 [0,12]；side 覆盖内容 [2.5,17.5] 且 δ=0：
    // 窗口起点差 baseOffset=+2.5 全部来自内容取材差异，真实 δ 差为 0，
    // 相关峰必须给出 lag=−2.5 抵消——只有 lag 与 baseOffset 符号约定一致才能得 0
    makeStream(cal, 'main', {
      isMain: true, tier: '1080p', delta: 0, pcmRegistry,
      segs: Array.from({ length: 6 }, (_, i) => ({ contentStart: i * 2, dur: 2 })),
    });
    makeStream(cal, 's1', {
      isMain: false, tier: '1080p', delta: 0, pcmRegistry,
      segs: Array.from({ length: 3 }, (_, i) => ({ contentStart: 2.5 + i * 5, dur: 5 })),
    });
    const ok = await cal.calibrate();
    expect(ok).toBe(1);
    const [, view] = setDelta.mock.calls[0] as unknown as [string, number];
    expect(view).toBeCloseTo(0, 1);
  });

  it('splits a real delta correctly across both channels (混合通道)', async () => {
    // side δ=+1.0 且内容取材再错开 2.5s → baseOffset=3.5、lag=−2.5，合成必须回到 +1.0
    makeStream(cal, 'main', {
      isMain: true, tier: '1080p', delta: 0, pcmRegistry,
      segs: Array.from({ length: 6 }, (_, i) => ({ contentStart: i * 2, dur: 2 })),
    });
    makeStream(cal, 's1', {
      isMain: false, tier: '1080p', delta: 1.0, pcmRegistry,
      segs: Array.from({ length: 3 }, (_, i) => ({ contentStart: 2.5 + i * 5, dur: 5 })),
    });
    await cal.calibrate();
    const [, view] = setDelta.mock.calls[0] as unknown as [string, number];
    expect(view).toBeCloseTo(1.0, 1);
  });

  it('does not calibrate when audio is silent (between matches)', async () => {
    makeStream(cal, 'main', {
      isMain: true, tier: '1080p', delta: 0, pcmRegistry,
      segs: [{ contentStart: 0, dur: 2 }, { contentStart: 2, dur: 2 }, { contentStart: 4, dur: 2 }],
    });
    makeStream(cal, 's1', {
      isMain: false, tier: '1080p', delta: 1, pcmRegistry,
      segs: [{ contentStart: 0, dur: 5 }],
    });
    // 静音：把 side 的 PCM 全部清零
    for (const [k, v] of pcmRegistry) if (k >= 3) pcmRegistry.set(k, new Float32Array(v.length));

    const ok = await cal.calibrate();
    expect(ok).toBe(0);
    expect(setDelta).not.toHaveBeenCalled();
  });

  it('does nothing without a main stream', async () => {
    makeStream(cal, 's1', {
      isMain: false, tier: '1080p', delta: 1, pcmRegistry,
      segs: [{ contentStart: 0, dur: 5 }],
    });
    expect(await cal.calibrate()).toBe(0);
  });

  it('persists measured view constants and restores them same-day', async () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    const calA = new AudioCalibrator(engine, { decode, storage, today: () => '2026-08-02' });
    makeStream(calA, 'main', {
      isMain: true, tier: '1080p', delta: 0, pcmRegistry,
      segs: Array.from({ length: 6 }, (_, i) => ({ contentStart: i * 2, dur: 2 })),
    });
    makeStream(calA, 's1', {
      isMain: false, tier: '1080p', delta: 2.5, pcmRegistry,
      segs: Array.from({ length: 3 }, (_, i) => ({ contentStart: i * 5, dur: 5 })),
    });
    await calA.calibrate();

    // 同日新会话：从存储恢复，不需要重新校准即写入 engine
    const engine2 = new SyncEngine();
    const setDelta2 = vi.spyOn(engine2, 'setDelta');
    new AudioCalibrator(engine2, { decode, storage, today: () => '2026-08-02' });
    expect(setDelta2).toHaveBeenCalledWith('s1', expect.closeTo(2.5, 1));

    // 跨日失效
    const engine3 = new SyncEngine();
    const setDelta3 = vi.spyOn(engine3, 'setDelta');
    new AudioCalibrator(engine3, { decode, storage, today: () => '2026-08-03' });
    expect(setDelta3).not.toHaveBeenCalled();
  });

  // 开赛探针：判据是「FPV 路有没有声音」。赛间实测是数字静音（采样恒为 0），
  // 比赛时各路共享主视角音频。主视角全程有解说，不能参与判定。
  describe('probeLive', () => {
    const silentSeg = (id: string, isMain: boolean, marker: number) => {
      pcmRegistry.set(marker, new Float32Array(SR * 5)); // 全零＝数字静音
      cal.ingest(id, { isMain, tier: '540p' }, {
        nameSec: 1000 + marker, firstAudioPts: 0, firstVideoPts: 0,
        adts: new Uint8Array([marker]), sampleRate: SR, frameCount: 215,
      });
    };
    const soundingSeg = (id: string, isMain: boolean, marker: number) => {
      pcmRegistry.set(marker, CONTENT.subarray(0, SR * 5));
      cal.ingest(id, { isMain, tier: '540p' }, {
        nameSec: 1000 + marker, firstAudioPts: 0, firstVideoPts: 0,
        adts: new Uint8Array([marker]), sampleRate: SR, frameCount: 215,
      });
    };

    it('reports null when there is nothing to judge', async () => {
      expect(await cal.probeLive()).toBeNull();
    });

    it('reports false when every FPV path is digitally silent', async () => {
      silentSeg('s1', false, 1);
      silentSeg('s2', false, 2);
      expect(await cal.probeLive()).toBe(false);
    });

    it('reports true as soon as any one FPV path has audio', async () => {
      silentSeg('s1', false, 3);   // 各路出声差一个分片（现网实测 ~6s），不能要求全部出声
      soundingSeg('s2', false, 4);
      expect(await cal.probeLive()).toBe(true);
    });

    it('ignores the main view, which carries commentary throughout', async () => {
      soundingSeg('main', true, 5); // 只有主视角有声 → 仍是赛间
      silentSeg('s1', false, 6);
      expect(await cal.probeLive()).toBe(false);
    });

    it('reports null when decoding is unavailable, so the UI holds instead of assuming idle', async () => {
      cal.ingest('s1', { isMain: false, tier: '540p' }, {
        nameSec: 1000, firstAudioPts: 0, firstVideoPts: 0,
        adts: new Uint8Array([250]), // 未注册的 marker → decode 抛错
        sampleRate: SR, frameCount: 215,
      });
      expect(await cal.probeLive()).toBeNull();
    });
  });
});
