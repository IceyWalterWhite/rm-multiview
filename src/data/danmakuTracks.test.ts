import { describe, it, expect } from 'vitest';
import { pickFreeTrack, trackBusyUntil, estimateDanmakuWidth } from './danmaku';

const d = (text: string) => ({ text, schoolName: 'A大学', nickname: 'n', racingAge: 0, position: '队员' });

describe('pickFreeTrack', () => {
  it('picks the longest-free track among available ones', () => {
    expect(pickFreeTrack([500, 0, 300], 1000)).toBe(1);
  });
  it('returns -1 when every track is busy', () => {
    expect(pickFreeTrack([2000, 3000], 1000)).toBe(-1);
  });
  it('treats busyUntil === now as free (boundary)', () => {
    expect(pickFreeTrack([1000], 1000)).toBe(0);
  });
});

describe('estimateDanmakuWidth / trackBusyUntil', () => {
  it('longer text estimates wider and holds the track longer', () => {
    const short = estimateDanmakuWidth(d('666'));
    const long = estimateDanmakuWidth(d('这是一条特别长的弹幕内容啊啊啊啊啊'));
    expect(long).toBeGreaterThan(short);
    expect(trackBusyUntil(0, long, 160)).toBeGreaterThan(trackBusyUntil(0, short, 160));
  });
  it('busy window covers width/speed plus a safety headway', () => {
    // 320px @ 160px/s = 2000ms 通过时间；headway 在其上追加
    expect(trackBusyUntil(1000, 320, 160)).toBeGreaterThan(1000 + 2000);
  });
});
