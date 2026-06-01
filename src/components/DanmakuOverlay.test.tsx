import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { DanmakuOverlay } from './DanmakuOverlay';
import type { Danmaku } from '../types';

function mk(id: string, text: string): Danmaku {
  // sendTime = now so the overlay treats these as live (post-mount) messages and flies them
  return { id, text, nickname: 'n', schoolName: '清华大学', position: '队员', racingAge: 1, badge: '', sendTime: Date.now(), userId: 0 };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('DanmakuOverlay', () => {
  it('removes each danmaku after its own lifetime even when newer ones arrive (no accumulation)', () => {
    const { rerender } = render(<DanmakuOverlay messages={[mk('a', 'AAA')]} />);
    expect(screen.getByText('AAA')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1000); });
    rerender(<DanmakuOverlay messages={[mk('a', 'AAA'), mk('b', 'BBB')]} />);
    expect(screen.getByText('BBB')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(9000); }); // now t=10000: AAA(9000) and BBB(10000) both expired
    expect(screen.queryByText('AAA')).toBeNull(); // FAILS on the buggy version (AAA timer was cancelled)
    expect(screen.queryByText('BBB')).toBeNull();
  });
});
