import { describe, it, expect } from 'vitest';
import { messageToDanmaku, identityTag, danmakuColor, selectFreshDanmaku, dedupeKey } from './danmaku';
import type { Danmaku } from '../types';
import samples from '../fixtures/danmaku-samples.json';
import { COLOR_VETERAN, COLOR_COMMON } from '../config';

describe('messageToDanmaku', () => {
  it('maps LeanCloud attrs to Danmaku model', () => {
    const s = samples[0];
    const d = messageToDanmaku('id1', s.text, s.attributes);
    expect(d.id).toBe('id1');
    expect(d.text).toBe(s.text);
    expect(d.nickname).toBe(s.attributes.nickname);
    expect(d.schoolName).toBe(s.attributes.schoolName);
    expect(d.position).toBe(s.attributes.position);
    expect(d.racingAge).toBe(s.attributes.racingAge);
  });

  it('coerces missing/zero racingAge to 0', () => {
    const d = messageToDanmaku('id2', 'hi', { nickname: 'n', schoolName: 's', position: '校友' });
    expect(d.racingAge).toBe(0);
  });
});

describe('identityTag', () => {
  it('shows "N年{position}" when racingAge>0', () => {
    expect(identityTag({ racingAge: 2, position: '老队员' })).toBe('2年老队员');
  });
  it('shows only position when racingAge is 0', () => {
    expect(identityTag({ racingAge: 0, position: '校友' })).toBe('校友');
  });
});

describe('danmakuColor', () => {
  it('veteran (老队员) is gold', () => {
    expect(danmakuColor({ position: '老队员' })).toBe(COLOR_VETERAN);
  });
  it('队员/校友 are common red', () => {
    expect(danmakuColor({ position: '队员' })).toBe(COLOR_COMMON);
    expect(danmakuColor({ position: '校友' })).toBe(COLOR_COMMON);
  });
});

describe('selectFreshDanmaku', () => {
  const mk = (id: string, sendTime: number, text = 't'): Danmaku => ({
    id, text, nickname: 'n', schoolName: 'A', position: '队员', racingAge: 0, badge: '', sendTime, userId: 0,
  });

  it('returns only messages at/after `since` that are not already seen', () => {
    const msgs = [mk('a', 100), mk('b', 200), mk('c', 300)];
    const { fresh } = selectFreshDanmaku(msgs, 150, new Set());
    expect(fresh.map((d) => d.id)).toEqual(['b', 'c']); // 'a' predates `since`
  });

  it('skips messages already present in prevSeen', () => {
    const seen = new Set([dedupeKey(mk('b', 200))]);
    const { fresh } = selectFreshDanmaku([mk('b', 200), mk('c', 300)], 150, seen);
    expect(fresh.map((d) => d.id)).toEqual(['c']);
  });

  it('reconciles nextSeen to the current buffer so it cannot grow unbounded', () => {
    // The leak: an ever-growing Set keyed by every message ever seen. nextSeen must be
    // bounded by the live buffer (stale keys dropped), not prevSeen.size + new.
    const stale = new Set(Array.from({ length: 5000 }, (_, i) => `old-${i}`));
    const msgs = Array.from({ length: 300 }, (_, i) => mk(`m${i}`, 1000 + i));
    const { nextSeen } = selectFreshDanmaku(msgs, 0, stale);
    expect(nextSeen.size).toBe(300); // exactly the buffer — not 5300
    expect(nextSeen.has(dedupeKey(msgs[0]))).toBe(true);
    expect(nextSeen.has('old-0')).toBe(false);
  });
});
