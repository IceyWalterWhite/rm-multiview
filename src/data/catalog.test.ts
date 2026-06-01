import { describe, it, expect } from 'vitest';
import { parseLiveGameInfo, NoLiveZoneError } from './catalog';
import sample from '../fixtures/live-game-info.sample.json';

describe('parseLiveGameInfo', () => {
  const cat = parseLiveGameInfo(sample);

  it('selects the liveState===1 zone', () => {
    expect(cat.zoneName).toBe('北部赛区');
    expect(cat.chatRoomId).toBe('69ff0439fa62cf0ebe01d583');
  });

  it('main view comes from zoneLiveString with 3 qualities', () => {
    expect(cat.main.side).toBe('main');
    expect(cat.main.id).toBe('fight2026-output');
    expect(cat.main.sources.map(s => s.label)).toEqual(['1080p', '720p', '540p']);
  });

  it('drops 合集 and 无解说 views by role', () => {
    const roles = [...cat.redViews, ...cat.blueViews].map(v => v.role);
    expect(roles).not.toContain('主视角（无解说版）');
    expect(roles).not.toContain('红方机器人第一视角合集');
  });

  it('splits views into red/blue by role', () => {
    expect(cat.redViews.map(v => v.role)).toContain('红方英雄第一视角');
    expect(cat.blueViews.map(v => v.role)).toContain('蓝方英雄第一视角');
  });

  it('throws NoLiveZoneError when no zone is live (event not started / ended)', () => {
    expect(() => parseLiveGameInfo({ eventData: [{ liveState: 0 }] })).toThrow(NoLiveZoneError);
  });
});
