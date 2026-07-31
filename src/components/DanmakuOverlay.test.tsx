import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { DanmakuOverlay } from './DanmakuOverlay';
import type { Danmaku } from '../types';

// sendTime far in the future guarantees the message is treated as post-mount (mountAt) and flies.
function mk(id: string, text: string, sendTime: number = Date.now() + 10_000_000): Danmaku {
  return { id, text, nickname: 'n', schoolName: 'A大学', position: '队员', racingAge: 1, badge: '', sendTime, userId: 0 };
}

const flyOf = (text: string) => screen.getByText(text).closest('.dm-fly') as HTMLElement;
const TRACKS_TO_FILL = 5; // spawn one danmaku per track (matches TRACKS in the component)

afterEach(() => vi.useRealTimers());

describe('DanmakuOverlay', () => {
  it('flies a new (post-mount) message', () => {
    render(<DanmakuOverlay messages={[mk('a', 'AAA')]} />);
    expect(screen.getByText('AAA')).toBeInTheDocument();
  });

  it('flies every new message from a batched update', () => {
    const { rerender } = render(<DanmakuOverlay messages={[]} />);
    rerender(<DanmakuOverlay messages={[mk('a', 'AAA'), mk('b', 'BBB'), mk('c', 'CCC')]} />);

    expect(screen.getByText('AAA')).toBeInTheDocument();
    expect(screen.getByText('BBB')).toBeInTheDocument();
    expect(screen.getByText('CCC')).toBeInTheDocument();
  });

  it('uses component mount time rather than first-message effect time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { rerender } = render(<DanmakuOverlay messages={[]} />);

    vi.setSystemTime(1_500);
    rerender(<DanmakuOverlay messages={[mk('live', 'LIVE', 1_200)]} />);

    expect(screen.getByText('LIVE')).toBeInTheDocument();
  });

  it('does not remove a danmaku on a fixed timer — only when its animation ends', () => {
    // Removal is driven by animationend (onAnimationEnd), NOT a setTimeout. This is what lets a
    // hover-paused danmaku stay put: a paused animation never ends, so no clock can delete it.
    vi.useFakeTimers();
    render(<DanmakuOverlay messages={[mk('a', 'AAA')]} />);
    act(() => { vi.advanceTimersByTime(120_000); }); // two minutes pass...
    expect(screen.getByText('AAA')).toBeInTheDocument(); // ...still there: no timer removal
  });

  it('confines danmaku to the upper half of the stage (top <= 50%)', () => {
    const msgs: Danmaku[] = [];
    const { rerender } = render(<DanmakuOverlay messages={msgs} />);
    for (let i = 0; i < TRACKS_TO_FILL; i++) {
      msgs.push(mk(`m${i}`, `T${i}`));
      rerender(<DanmakuOverlay messages={[...msgs]} />);
    }
    const tops = [...document.querySelectorAll('.dm-fly')].map((el) => parseFloat((el as HTMLElement).style.top));
    expect(tops.length).toBe(TRACKS_TO_FILL);
    for (const top of tops) expect(top).toBeLessThanOrEqual(50);
  });

  it('caps the number of concurrently flying danmaku', () => {
    const msgs = Array.from({ length: 120 }, (_, i) => mk('m' + i, 'X' + i));
    const { rerender } = render(<DanmakuOverlay messages={[]} />);
    rerender(<DanmakuOverlay messages={msgs} />);
    expect(document.querySelectorAll('.dm-fly').length).toBeLessThanOrEqual(80);
  });

  it('keeps a constant px/s speed: fly duration scales linearly with viewport width', () => {
    // distance = 140vw = 1.4×innerWidth px; duration = distance / speed → same px/s on any screen.
    window.innerWidth = 1000;
    const { unmount } = render(<DanmakuOverlay messages={[mk('a', 'AAA')]} />);
    const dNarrow = parseFloat(flyOf('AAA').style.animationDuration);
    unmount();

    window.innerWidth = 2000;
    render(<DanmakuOverlay messages={[mk('b', 'BBB')]} />);
    const dWide = parseFloat(flyOf('BBB').style.animationDuration);

    expect(dNarrow).toBeGreaterThan(0);
    expect(dWide).toBeCloseTo(dNarrow * 2, 5); // 2× width → 2× duration → identical px/s
  });

  // ===== 轨道调度（防同轨咬尾重叠）=====

  it('assigns simultaneous danmaku to distinct tracks — never stacked on one line', () => {
    const { rerender } = render(<DanmakuOverlay messages={[]} />);
    rerender(<DanmakuOverlay messages={[mk('a', 'AA'), mk('b', 'BB'), mk('c', 'CC')]} />);
    const tops = [...document.querySelectorAll('.dm-fly')].map((el) => (el as HTMLElement).style.top);
    expect(new Set(tops).size).toBe(3); // 三条同帧到达 → 三条不同轨道
  });

  it('drops burst overflow beyond the track count instead of overlapping', () => {
    const msgs = Array.from({ length: 9 }, (_, i) => mk('b' + i, 'B' + i));
    const { rerender } = render(<DanmakuOverlay messages={[]} />);
    rerender(<DanmakuOverlay messages={msgs} />);
    // 9 条同帧爆发：5 条各占一轨，其余丢弃（聊天列表仍完整保留）
    expect(document.querySelectorAll('.dm-fly').length).toBe(TRACKS_TO_FILL);
  });

  it('frees a track only after the previous occupant has tail-cleared', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const first = Array.from({ length: 5 }, (_, i) => mk('f' + i, 'F' + i));
    const { rerender } = render(<DanmakuOverlay messages={[]} />);
    rerender(<DanmakuOverlay messages={first} />);
    expect(document.querySelectorAll('.dm-fly').length).toBe(5);

    // 全轨占用中：立刻追加 → 丢弃，不同轨叠放（对象复用：重建会改变 sendTime → 变成"新"消息）
    const x = mk('x', 'XX');
    rerender(<DanmakuOverlay messages={[...first, x]} />);
    expect(document.querySelectorAll('.dm-fly').length).toBe(5);

    // 时间推进到所有尾部让出后：新弹幕可入轨
    vi.setSystemTime(10_000 + 60_000);
    rerender(<DanmakuOverlay messages={[...first, x, mk('y', 'YY')]} />);
    expect(document.querySelectorAll('.dm-fly').length).toBe(6);
  });
});
