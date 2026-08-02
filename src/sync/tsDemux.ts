// MPEG-TS → AAC(ADTS) 提取，供 decodeAudioData 与互相关校准使用。
// 只实现校准所需的最小子集：PAT/PMT 定位 PID、PES 头剥离取 PTS、ADTS 帧扫描。
// 与 2026-08-01 实验的 Python 参考解析器行为一致（testdata fixture 交叉验证）。
export interface DemuxedAudio {
  /** 从首个 ADTS 同步字起拼接的 AAC 基本流 */
  adts: Uint8Array;
  /** 首个音频/视频 PES 的 PTS（秒） */
  firstAudioPts: number | null;
  firstVideoPts: number | null;
  sampleRate: number | null;
  frameCount: number;
}

const TS_PACKET = 188;
const SYNC = 0x47;
const ST_AAC_ADTS = 0x0f;
const ST_H264 = 0x1b;
const ST_HEVC = 0x24;
const ADTS_SR_TABLE = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000];

function readPts(p: Uint8Array, off: number): number {
  return (
    (((p[off] >> 1) & 0x07) * 0x40000000 + // (30 位移超出 32 位安全范围，用乘法)
      ((p[off + 1] << 22) | (((p[off + 2] >> 1) & 0x7f) << 15) | (p[off + 3] << 7) | (p[off + 4] >> 1))) /
    90000
  );
}

export function demuxAudio(ts: Uint8Array): DemuxedAudio {
  let pmtPid = -1;
  const streamTypes = new Map<number, number>();
  const audioChunks: Uint8Array[] = [];
  const audioPusi: boolean[] = [];
  let firstAudioPts: number | null = null;
  let firstVideoPts: number | null = null;

  for (let i = 0; i + TS_PACKET <= ts.length; i += TS_PACKET) {
    if (ts[i] !== SYNC) continue;
    const pusi = ((ts[i + 1] >> 6) & 1) === 1;
    const pid = ((ts[i + 1] & 0x1f) << 8) | ts[i + 2];
    const afc = (ts[i + 3] >> 4) & 3;
    let off = i + 4;
    if (afc & 2) off += 1 + ts[i + 4];
    if (!(afc & 1) || off >= i + TS_PACKET) continue;
    const payload = ts.subarray(off, i + TS_PACKET);

    if (pid === 0 && pusi && pmtPid < 0) {
      // PAT：取第一个非空 program 的 PMT PID
      const p = payload.subarray(1 + payload[0]);
      const secLen = ((p[1] & 0x0f) << 8) | p[2];
      for (let j = 8; j + 3 < 3 + secLen - 4; j += 4) {
        if ((p[j] << 8) | p[j + 1]) pmtPid = ((p[j + 2] & 0x1f) << 8) | p[j + 3];
      }
    } else if (pid === pmtPid && pusi && streamTypes.size === 0) {
      const p = payload.subarray(1 + payload[0]);
      const secLen = ((p[1] & 0x0f) << 8) | p[2];
      const infoLen = ((p[10] & 0x0f) << 8) | p[11];
      let j = 12 + infoLen;
      const end = 3 + secLen - 4;
      while (j + 4 < end) {
        const st = p[j];
        const epid = ((p[j + 1] & 0x1f) << 8) | p[j + 2];
        streamTypes.set(epid, st);
        j += 5 + (((p[j + 3] & 0x0f) << 8) | p[j + 4]);
      }
    } else if (streamTypes.has(pid)) {
      const st = streamTypes.get(pid)!;
      const isPes =
        pusi && payload.length > 13 && payload[0] === 0 && payload[1] === 0 && payload[2] === 1;
      const hasPts = isPes && (payload[7] & 0x80) !== 0;
      if (st === ST_AAC_ADTS) {
        audioChunks.push(payload);
        audioPusi.push(isPes);
        if (hasPts && firstAudioPts === null) firstAudioPts = readPts(payload, 9);
      } else if ((st === ST_H264 || st === ST_HEVC) && hasPts && firstVideoPts === null) {
        firstVideoPts = readPts(payload, 9);
      }
    }
  }

  // 拼 ES：PES 头（9 + header_len 字节）剥掉，其余原样连接
  let esLen = 0;
  const parts: Uint8Array[] = [];
  for (let c = 0; c < audioChunks.length; c++) {
    const p = audioChunks[c];
    const part = audioPusi[c] ? p.subarray(9 + p[8]) : p;
    parts.push(part);
    esLen += part.length;
  }
  const es = new Uint8Array(esLen);
  let w = 0;
  for (const part of parts) {
    es.set(part, w);
    w += part.length;
  }

  // ADTS 扫描：从首个同步字起计帧、取采样率
  let sampleRate: number | null = null;
  let frameCount = 0;
  let firstSync = -1;
  let i = 0;
  while (i < es.length - 7) {
    if (es[i] === 0xff && (es[i + 1] & 0xf0) === 0xf0) {
      const fl = ((es[i + 3] & 0x03) << 11) | (es[i + 4] << 3) | ((es[i + 5] >> 5) & 0x07);
      if (fl >= 7) {
        if (firstSync < 0) firstSync = i;
        if (sampleRate === null) sampleRate = ADTS_SR_TABLE[(es[i + 2] >> 2) & 0x0f] ?? null;
        frameCount++;
        i += fl;
        continue;
      }
    }
    i++;
  }

  return {
    adts: firstSync >= 0 ? es.subarray(firstSync) : new Uint8Array(0),
    firstAudioPts,
    firstVideoPts,
    sampleRate,
    frameCount,
  };
}
