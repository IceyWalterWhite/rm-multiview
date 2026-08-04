/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { demuxAudio } from './tsDemux';

// 真实分片 fixture（gitignore 的 testdata，缺失时跳过——见 testdata/sync/ 归档说明）
const FIXTURE = join(__dirname, '../../testdata/sync/segs/main-540_1785592804_9591.ts');
const hasFixture = existsSync(FIXTURE);

describe.skipIf(!hasFixture)('demuxAudio (真实 540p 分片)', () => {
  // 期望值来自独立的 Python 解析器（2026-08-01 实验，ts_parse.json）
  const seg = () => new Uint8Array(readFileSync(FIXTURE));

  it('extracts the AAC sample rate from the ADTS header', () => {
    expect(demuxAudio(seg()).sampleRate).toBe(44100);
  });

  it('extracts first audio and video PTS in seconds', () => {
    const d = demuxAudio(seg());
    expect(d.firstAudioPts).toBeCloseTo(4315615302 / 90000, 2);
    expect(d.firstVideoPts).toBeCloseTo(4315633200 / 90000, 2);
  });

  it('walks all ADTS frames of the 5s segment', () => {
    expect(demuxAudio(seg()).frameCount).toBe(217);
  });

  it('returns a non-empty concatenated ADTS elementary stream', () => {
    const d = demuxAudio(seg());
    expect(d.adts.length).toBeGreaterThan(10000);
    // ADTS syncword 开头
    expect(d.adts[0]).toBe(0xff);
    expect(d.adts[1] & 0xf0).toBe(0xf0);
  });
});

describe('demuxAudio (非法输入)', () => {
  it('returns an empty result for garbage bytes', () => {
    const d = demuxAudio(new Uint8Array([1, 2, 3, 4, 5]));
    expect(d.frameCount).toBe(0);
    expect(d.adts.length).toBe(0);
    expect(d.firstAudioPts).toBeNull();
    expect(d.sampleRate).toBeNull();
  });
});
