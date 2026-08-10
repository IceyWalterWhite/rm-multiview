import { describe, it, expect } from 'vitest';
import { srcForQuality, sourceForQuality, isSignatureExpiry } from './streams';
import type { StreamView } from '../types';

const view: StreamView = {
  id: 'fight2026001', role: '红方英雄第一视角', side: 'red',
  sources: [
    { label: '1080p', src: 'a.m3u8', res: '1920x1080' },
    { label: '540p', src: 'c.m3u8', res: '960x540' },
  ],
};

describe('srcForQuality', () => {
  it('returns the source matching the requested label', () => {
    expect(srcForQuality(view, '540p')).toBe('c.m3u8');
  });
  it('falls back to the first source when the label is absent', () => {
    expect(srcForQuality(view, '720p')).toBe('a.m3u8');
  });
});

describe('sourceForQuality', () => {
  it('returns the whole source so callers can read the REAL tier label', () => {
    expect(sourceForQuality(view, '540p')).toEqual({ label: '540p', src: 'c.m3u8', res: '960x540' });
  });
  it('falls back with the fallback source own label (缺档回退时 offset metadata 必须跟着实际源走)', () => {
    // 请求 720p 回退到 1080p 源：label 必须是 1080p，否则会误用不匹配的实测 offset
    expect(sourceForQuality(view, '720p')?.label).toBe('1080p');
  });
  it('returns undefined for a view without sources', () => {
    expect(sourceForQuality({ ...view, sources: [] }, '540p')).toBeUndefined();
  });
});

describe('isSignatureExpiry', () => {
  it('treats 401/403 as an expired signature (re-fetch a fresh signed URL)', () => {
    expect(isSignatureExpiry(403)).toBe(true);
    expect(isSignatureExpiry(401)).toBe(true);
  });
  it('treats other statuses / missing code as transient (retry in place)', () => {
    expect(isSignatureExpiry(404)).toBe(false);
    expect(isSignatureExpiry(500)).toBe(false);
    expect(isSignatureExpiry(undefined)).toBe(false);
  });
});
