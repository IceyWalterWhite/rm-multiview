import { describe, it, expect } from 'vitest';
import { parseCurrentMatch, formatMatchTitle, shortenEventName } from './match';
import sample from '../fixtures/current-and-next-matches.sample.json';

describe('shortenEventName', () => {
  it('strips leading non-CJK prefix', () => {
    expect(shortenEventName('RMUC 2026超级对抗赛')).toBe('超级对抗赛');
  });
  it('falls back to original when there is no CJK', () => {
    expect(shortenEventName('RoboMaster')).toBe('RoboMaster');
  });
});

describe('formatMatchTitle', () => {
  it('formats a full current match: event zone 第N场 red vs blue', () => {
    const m = (sample as any[])[2].currentMatch;
    expect(formatMatchTitle(m)).toBe('超级对抗赛 北部赛区 第68场 东北大学 TDT vs 山东理工大学 齐奇');
  });
  it('omits the vs and 第0场 when teams are missing (warmup)', () => {
    const m = (sample as any[])[1].nextMatch;
    expect(formatMatchTitle(m)).toBe('超级对抗赛 东部赛区');
  });
  it('omits the vs when only one side has a team', () => {
    const m = {
      orderNumber: 5,
      redSide: { player: { team: { collegeName: '清华大学', name: '火神' } } },
      blueSide: { player: null },
      zone: { name: '中部赛区', event: { title: 'RMUC 2026超级对抗赛' } },
    };
    expect(formatMatchTitle(m)).toBe('超级对抗赛 中部赛区 第5场 清华大学 火神');
  });
});

describe('parseCurrentMatch', () => {
  it('uses currentMatch for the matching zone', () => {
    expect(parseCurrentMatch(sample, '北部赛区')).toEqual({
      text: '超级对抗赛 北部赛区 第68场 东北大学 TDT vs 山东理工大学 齐奇',
      isNext: false,
    });
  });
  it('falls back to nextMatch when that zone has no currentMatch', () => {
    expect(parseCurrentMatch(sample, '东部赛区')).toEqual({
      text: '超级对抗赛 东部赛区',
      isNext: true,
    });
  });
  it('returns null when the zone is not present', () => {
    expect(parseCurrentMatch(sample, '南部赛区')).toBeNull();
  });
  it('returns null for non-array input', () => {
    expect(parseCurrentMatch(null, '北部赛区')).toBeNull();
  });
  it('returns null when the matched zone has neither current nor next match', () => {
    expect(parseCurrentMatch([{ currentMatch: null, nextMatch: null }], '北部赛区')).toBeNull();
  });
});
