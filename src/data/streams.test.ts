import { describe, it, expect } from 'vitest';
import { srcForQuality, isSignatureExpiry } from './streams';
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
