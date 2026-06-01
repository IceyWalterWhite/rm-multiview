import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { DanmakuOverlay } from './DanmakuOverlay';
import type { Danmaku } from '../types';

// sendTime far in the future guarantees the message is treated as post-mount (mountAt) and flies.
function mk(id: string, text: string): Danmaku {
  return { id, text, nickname: 'n', schoolName: 'A大学', position: '队员', racingAge: 1, badge: '', sendTime: Date.now() + 10_000_000, userId: 0 };
}

const flyOf = (text: string) => screen.getByText(text).closest('.dm-fly') as HTMLElement;
const TRACKS_TO_FILL = 5; // spawn one danmaku per track (matches TRACKS in the component)

afterEach(() => vi.useRealTimers());

describe('DanmakuOverlay', () => {
  it('flies a new (post-mount) message', () => {
    render(<DanmakuOverlay messages={[mk('a', 'AAA')]} />);
    expect(screen.getByText('AAA')).toBeInTheDocument();
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

  it('keeps a constant px/s speed: fly duration scales linearly with viewport width', () => {
    // distance = 220vw = 2.2×innerWidth px; duration = distance / speed → same px/s on any screen.
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
});
