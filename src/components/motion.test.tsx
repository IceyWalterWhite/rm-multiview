import { act, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSpringValue } from './motion';

/**
 * 弹簧必须在 StrictMode 下仍然会动。
 *
 * StrictMode 在 dev 里把「挂载→模拟卸载→再挂载」跑一遍：模拟卸载会
 * cancelAnimationFrame，若清理时不把 raf id 置回 null，二次挂载的 effect 会
 * 误以为循环还在飞而直接 return —— 循环已死，之后所有目标变化都被无声吞掉，
 * 数字永远冻在初值（prod 无双挂载，故只有 dev 演示暴露）。
 */

function Probe({ target }: { target: number }) {
  const v = useSpringValue(target);
  return <output data-testid="v">{v.toFixed(1)}</output>;
}

describe('useSpringValue', () => {
  let frameCbs: Map<number, FrameRequestCallback>;
  let nextId: number;
  let clock: number;

  beforeEach(() => {
    frameCbs = new Map();
    nextId = 1;
    clock = 0;
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = nextId++;
      frameCbs.set(id, cb);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frameCbs.delete(id); });
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** 推进一帧：把当前排队的回调全部以 +16ms 的时钟执行（新排的留到下一帧） */
  const frame = () => {
    clock += 16;
    const pending = [...frameCbs.entries()];
    frameCbs.clear();
    for (const [, cb] of pending) cb(clock);
  };

  it('StrictMode 双挂载后目标变化仍会补间（清理必须归还 raf id）', () => {
    const { getByTestId, rerender } = render(
      <StrictMode><Probe target={100} /></StrictMode>,
    );
    act(() => { frame(); frame(); });
    expect(getByTestId('v').textContent).toBe('100.0');

    rerender(<StrictMode><Probe target={200} /></StrictMode>);
    // 一秒的帧数足够临界阻尼弹簧（response 0.4）走完全程
    act(() => { for (let i = 0; i < 60; i += 1) frame(); });
    expect(getByTestId('v').textContent).toBe('200.0');
  });
});
