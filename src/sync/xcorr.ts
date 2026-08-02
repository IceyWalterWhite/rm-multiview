// FFT 互相关：测两段共享音频的相对延迟（δ 校准的数学核心）。
// 无依赖的迭代 radix-2 FFT；两信号零均值、零填充到 2^k 做线性（非循环）相关。
export interface CorrResult {
  /** b 相对 a 的延迟秒数（正 = b 内容出现更晚） */
  lagSec: number;
  /** 归一化峰值（1 = 完全相同的信号） */
  peak: number;
  /** 峰锐度：主峰 / 排除主峰邻域后的次峰 */
  sharpness: number;
}

const MIN_RMS = 1e-4; // 静音门限（赛间 FPV 无共享音频时拒绝校准）
const MIN_PEAK = 0.1;
const MIN_SHARPNESS = 3;
const PEAK_EXCLUDE_SEC = 0.25; // 次峰统计时排除主峰邻域

function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  // 位反转置换
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const j = i + k;
        const l = j + len / 2;
        const tr = re[l] * cr - im[l] * ci;
        const ti = re[l] * ci + im[l] * cr;
        re[l] = re[j] - tr;
        im[l] = im[j] - ti;
        re[j] += tr;
        im[j] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function rmsAndMean(x: Float32Array): { rms: number; mean: number } {
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i];
  const mean = x.length ? sum / x.length : 0;
  let sq = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i] - mean;
    sq += v * v;
  }
  return { rms: Math.sqrt(sq / Math.max(1, x.length)), mean };
}

export function crossCorrelate(
  a: Float32Array,
  b: Float32Array,
  sampleRate: number,
  maxLagSec: number,
): CorrResult | null {
  if (a.length < 2 || b.length < 2) return null;
  const sa = rmsAndMean(a);
  const sb = rmsAndMean(b);
  if (sa.rms < MIN_RMS || sb.rms < MIN_RMS) return null;

  let nfft = 1;
  while (nfft < a.length + b.length) nfft <<= 1;

  const ar = new Float64Array(nfft);
  const ai = new Float64Array(nfft);
  const br = new Float64Array(nfft);
  const bi = new Float64Array(nfft);
  let ea = 0;
  let eb = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i] - sa.mean;
    ar[i] = v;
    ea += v * v;
  }
  for (let i = 0; i < b.length; i++) {
    const v = b[i] - sb.mean;
    br[i] = v;
    eb += v * v;
  }
  fftInPlace(ar, ai);
  fftInPlace(br, bi);
  // C = A · conj(B) → IFFT 得 c[k] = Σ a[n]·b[n−k]（k 为 b 的延迟；负延迟在尾部）
  for (let i = 0; i < nfft; i++) {
    const rr = ar[i] * br[i] + ai[i] * bi[i];
    const ri = ai[i] * br[i] - ar[i] * bi[i];
    ar[i] = rr;
    ai[i] = ri;
  }
  // IFFT via conj 技巧：ifft(x) = conj(fft(conj(x)))/n
  for (let i = 0; i < nfft; i++) ai[i] = -ai[i];
  fftInPlace(ar, ai);
  const norm = Math.sqrt(ea * eb) * nfft || 1;

  const maxLag = Math.min(Math.floor(maxLagSec * sampleRate), nfft >> 1);
  const corrAt = (k: number): number => ar[(k + nfft) % nfft] / norm; // /nfft 已并入 norm

  let bestK = 0;
  let bestV = -Infinity;
  for (let k = -maxLag; k <= maxLag; k++) {
    const v = corrAt(k);
    if (v > bestV) {
      bestV = v;
      bestK = k;
    }
  }
  // 次峰（排除主峰 ±PEAK_EXCLUDE_SEC 邻域）
  const excl = Math.floor(PEAK_EXCLUDE_SEC * sampleRate);
  let second = 0;
  for (let k = -maxLag; k <= maxLag; k++) {
    if (Math.abs(k - bestK) <= excl) continue;
    const v = Math.abs(corrAt(k));
    if (v > second) second = v;
  }
  const sharpness = bestV / Math.max(second, 1e-12);
  if (bestV < MIN_PEAK || sharpness < MIN_SHARPNESS) return null;
  // z[k] = Σ a[m+k]·b[m]：b 延迟 d 时峰位于 k = −d，故取负还原「b 相对 a 的延迟」
  return { lagSec: -bestK / sampleRate, peak: bestV, sharpness };
}
