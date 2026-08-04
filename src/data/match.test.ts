import { describe, it, expect } from 'vitest';
import { parseCurrentMatch, parseCheerTarget, formatMatchTitle, shortenEventName } from './match';
import type { MatchEntry } from './match';
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
    const m = (sample as { currentMatch: MatchEntry }[])[2].currentMatch;
    expect(formatMatchTitle(m)).toBe('超级对抗赛 北部赛区 第68场 A大学 Alpha vs B大学 Beta');
  });
  it('omits the vs and 第0场 when teams are missing (warmup)', () => {
    const m = (sample as { nextMatch: MatchEntry }[])[1].nextMatch;
    expect(formatMatchTitle(m)).toBe('超级对抗赛 东部赛区');
  });
  it('omits the vs when only one side has a team', () => {
    const m = {
      orderNumber: 5,
      redSide: { player: { team: { collegeName: 'A大学', name: 'Alpha' } } },
      blueSide: { player: null },
      zone: { name: '中部赛区', event: { title: 'RMUC 2026超级对抗赛' } },
    };
    expect(formatMatchTitle(m)).toBe('超级对抗赛 中部赛区 第5场 A大学 Alpha');
  });
});

describe('parseCurrentMatch', () => {
  it('uses currentMatch for the matching zone', () => {
    expect(parseCurrentMatch(sample, '北部赛区')).toEqual({
      text: '超级对抗赛 北部赛区 第68场 A大学 Alpha vs B大学 Beta',
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

describe('parseCheerTarget', () => {
  // 夹具不带 team.id（标题不需要），助威用例自带含 id 的最小载荷
  const zone = { name: '北部赛区', event: { title: 'RMUC 2026超级对抗赛' } };
  const withIds = [{
    currentMatch: {
      id: 31228, orderNumber: 68, zone,
      redSide: { player: { team: { id: 3059, collegeName: 'A大学', name: 'Alpha' } } },
      blueSide: { player: { team: { id: 739, collegeName: 'B大学', name: 'Beta' } } },
    },
    nextMatch: {
      id: 31229, orderNumber: 69, zone,
      redSide: { player: { team: { id: 900, collegeName: 'C大学', name: 'Gamma' } } },
      blueSide: { player: { team: { id: 901, collegeName: 'D大学', name: 'Delta' } } },
    },
  }];

  it('exposes ids as strings plus college+team labels', () => {
    expect(parseCheerTarget(withIds, '北部赛区')).toEqual({
      matchId: '31228', redTeamId: '3059', blueTeamId: '739',
      redLabel: 'A大学 Alpha', blueLabel: 'B大学 Beta',
    });
  });

  it('never falls back to nextMatch (下一场不能投票)', () => {
    const onlyNext = [{ currentMatch: null, nextMatch: withIds[0].nextMatch }];
    expect(parseCheerTarget(onlyNext, '北部赛区')).toBeNull();
  });

  it('returns null when a side has no player (数据里确实有 player: null)', () => {
    const halfEmpty = [{ currentMatch: { ...withIds[0].currentMatch, blueSide: { player: null } } }];
    expect(parseCheerTarget(halfEmpty, '北部赛区')).toBeNull();
  });

  it('returns null when the match id is missing', () => {
    const noId = [{ currentMatch: { ...withIds[0].currentMatch, id: undefined } }];
    expect(parseCheerTarget(noId, '北部赛区')).toBeNull();
  });

  it('returns null for an unknown zone or non-array input', () => {
    expect(parseCheerTarget(withIds, '南部赛区')).toBeNull();
    expect(parseCheerTarget(null, '北部赛区')).toBeNull();
  });

  it('returns null for the sample zone that only has a warmup nextMatch', () => {
    expect(parseCheerTarget(sample, '东部赛区')).toBeNull();
  });
});
