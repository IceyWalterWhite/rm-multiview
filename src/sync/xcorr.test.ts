import { describe, it, expect } from 'vitest';
import { crossCorrelate } from './xcorr';

// 确定性伪随机（LCG），模拟宽带音频
function noise(n: number, seed = 42): Float32Array {
  const out = new Float32Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = s / 0xffffffff - 0.5;
  }
  return out;
}

const SR = 4000;

function delayed(a: Float32Array, lagSamples: number): Float32Array {
  // b[n] = a[n − lag]：b 的内容比 a 晚 lag 个采样出现
  const b = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const j = i - lagSamples;
    b[i] = j >= 0 && j < a.length ? a[j] : 0;
  }
  return b;
}

/** 类似整流能量包络：正值、带约 100ms 的平滑，而非理想白噪声 */
function envelope(sampleRate: number, sec: number, seed: number): Float32Array {
  const raw = noise(sampleRate * sec, seed);
  const width = Math.round(sampleRate * 0.1);
  const out = new Float32Array(raw.length);
  let sum = 0;
  for (let i = 0; i < raw.length; i++) {
    sum += Math.abs(raw[i]);
    if (i >= width) sum -= Math.abs(raw[i - width]);
    out[i] = sum / Math.min(i + 1, width);
  }
  return out;
}

describe('crossCorrelate', () => {
  it('finds a positive lag when b is a delayed copy of a', () => {
    const a = noise(SR * 4);
    const b = delayed(a, Math.round(1.23 * SR));
    const r = crossCorrelate(a, b, SR, 3);
    expect(r).not.toBeNull();
    expect(r!.lagSec).toBeCloseTo(1.23, 2);
  });

  it('finds a negative lag when b leads a', () => {
    const b = noise(SR * 4, 7);
    const a = delayed(b, Math.round(0.8 * SR)); // a 比 b 晚 → b 领先 → 负 lag
    const r = crossCorrelate(a, b, SR, 3);
    expect(r).not.toBeNull();
    expect(r!.lagSec).toBeCloseTo(-0.8, 2);
  });

  it('rejects silence (no reliable peak)', () => {
    const a = new Float32Array(SR * 4);
    const b = new Float32Array(SR * 4);
    expect(crossCorrelate(a, b, SR, 3)).toBeNull();
  });

  it('restricts the search to maxLagSec', () => {
    const a = noise(SR * 4);
    const b = delayed(a, Math.round(2.5 * SR));
    // 真实偏移 2.5s 超出 ±1s 搜索窗 → 找不到可信峰
    expect(crossCorrelate(a, b, SR, 1)).toBeNull();
  });

  it('finds 10s of shared audio inside two fully-audible 30s windows', () => {
    const sr = 200;
    const a = envelope(sr, 30, 1); // 两边其余 20s 都有声音，但内容互不相同
    const b = envelope(sr, 30, 2);
    const common = envelope(sr, 10, 3);
    // A 的共同段在尾部，B 的共同段在头部：B 相对 A 领先 20s
    a.set(common, 20 * sr);
    b.set(common, 0);

    const r = crossCorrelate(a, b, sr, 23);
    expect(r).not.toBeNull();
    expect(r!.lagSec).toBeCloseTo(-20, 1);
  });
});
