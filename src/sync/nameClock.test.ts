import { describe, it, expect } from 'vitest';
import { parseFragName, estimateEpoch } from './nameClock';

describe('parseFragName', () => {
  it('parses wall-second and sequence from an absolute segment URL', () => {
    const url =
      'https://rtmp.djicdn.com/robomaster/superflight2026004/1785592811_24312.ts?aliyunols=on&auth_key=1784611204-0-0-21db';
    expect(parseFragName(url)).toEqual({ wallSec: 1785592811, seq: 24312 });
  });

  it('parses a relative segment URI as found in the playlist', () => {
    expect(parseFragName('superflight2026-output_hd/1785591919_9414.ts?auth_key=x')).toEqual({
      wallSec: 1785591919,
      seq: 9414,
    });
  });

  it('returns null when the URL does not follow the {unix}_{seq}.ts convention', () => {
    expect(parseFragName('https://example.com/foo/bar.ts')).toBeNull();
    expect(parseFragName('')).toBeNull();
    expect(parseFragName('12345_1.ts')).toBeNull(); // 10 位 unix 秒才算命名时间戳
  });
});

describe('estimateEpoch', () => {
  it('returns the median of (wallSec - fragStart) across samples', () => {
    // 名字钟只有 1 秒分辨率，中位数抵消取整抖动
    const samples = [
      { wallSec: 1785593205, fragStart: 100.0 }, // E = 1785593105
      { wallSec: 1785593207, fragStart: 101.6 }, // E = 1785593105.4
      { wallSec: 1785593209, fragStart: 104.2 }, // E = 1785593104.8
    ];
    expect(estimateEpoch(samples)).toBeCloseTo(1785593105, 5);
  });

  it('is robust to a single outlier sample', () => {
    const samples = [
      { wallSec: 1785593205, fragStart: 100.0 },
      { wallSec: 1785593207, fragStart: 102.0 },
      { wallSec: 1785599999, fragStart: 104.0 }, // 异常样本（如 hls 重建瞬间）
    ];
    expect(estimateEpoch(samples)).toBeCloseTo(1785593105, 5);
  });

  it('returns null for an empty sample set', () => {
    expect(estimateEpoch([])).toBeNull();
  });
});
