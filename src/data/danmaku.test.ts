import { describe, it, expect } from 'vitest';
import { messageToDanmaku, identityTag, danmakuColor } from './danmaku';
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
    expect(identityTag({ racingAge: 2, position: '老队员' } as any)).toBe('2年老队员');
  });
  it('shows only position when racingAge is 0', () => {
    expect(identityTag({ racingAge: 0, position: '校友' } as any)).toBe('校友');
  });
});

describe('danmakuColor', () => {
  it('veteran (老队员) is gold', () => {
    expect(danmakuColor({ position: '老队员' } as any)).toBe(COLOR_VETERAN);
  });
  it('队员/校友 are common red', () => {
    expect(danmakuColor({ position: '队员' } as any)).toBe(COLOR_COMMON);
    expect(danmakuColor({ position: '校友' } as any)).toBe(COLOR_COMMON);
  });
});
