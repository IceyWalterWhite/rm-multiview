import { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { StageGrid } from './StageGrid';
import type { StreamView } from '../types';

const viewA: StreamView = { id: 'a', role: '红方英雄第一视角', side: 'red', sources: [] };
const viewB: StreamView = { id: 'b', role: '蓝方工程第二视角', side: 'blue', sources: [] };
const viewC: StreamView = { id: 'c', role: '红方哨兵第一视角', side: 'red', sources: [] };

/**
 * 一行两格、6px gap、每格 160×90 —— 与真实 plan（`solve(326,180)` 得 cols=2）一致。
 * `to` 由 plan 的列数推导，mock 几何必须与 plan 自洽，否则测试测的是另一套排布。
 */
function makeTileRect(index: number): DOMRect {
  const x = index * (160 + 6);
  return { left: x, top: 0, right: x + 160, bottom: 90, width: 160, height: 90, x, y: 0, toJSON() {} } as DOMRect;
}

/** 组件内部只读 clientWidth/clientHeight 与 getBoundingClientRect，这里一次全给齐 */
function mockTilesGeometry(tiles: HTMLDivElement, tileById: Map<string, HTMLDivElement>) {
  Object.defineProperty(tiles, 'clientWidth', { configurable: true, value: 326 });
  Object.defineProperty(tiles, 'clientHeight', { configurable: true, value: 180 });
  tiles.getBoundingClientRect = () => ({ left: 0, top: 0, right: 326, bottom: 180, width: 326, height: 180, x: 0, y: 0, toJSON() {} }) as DOMRect;
  tileById.forEach((el) => {
    // 顺序变化后同一 DOM 节点会落到新格；每次读取都按当前 children 顺序量几何，
    // 才能验证向回越过 B 的新中心时，A 真正回到原位。
    el.getBoundingClientRect = () => makeTileRect(Array.from(tiles.children).indexOf(el));
  });
}

/** stateful 宿主：onReorder 真的改顺序，测试断言的是组件行为而不是 mock 调用 */
function GridHarness() {
  const [order, setOrder] = useState<string[]>(['a', 'b', 'c']);
  return (
    <StageGrid
      views={[viewA, viewB, viewC]}
      order={order}
      onReorder={setOrder}
      selected={null}
      onSelect={() => {}}
      quality="540p"
      mainSlot={<div>主视角</div>}
      sandboxSlot={() => <div>沙盘</div>}
    />
  );
}

describe('StageGrid', () => {
  it('keeps the stream name accessible without painting it over the video', () => {
    const { container } = render(
      <StageGrid
        views={[viewA]}
        order={[viewA.id]}
        onReorder={vi.fn()}
        selected={null}
        onSelect={vi.fn()}
        quality="540p"
        mainSlot={<div>主视角</div>}
        sandboxSlot={() => <div>沙盘</div>}
      />,
    );

    expect(screen.getByRole('button', { name: '红方英雄第一视角' })).toBeInTheDocument();
    expect(container.querySelector('.sg-tile-name')).not.toBeInTheDocument();
    expect(screen.queryByText('红方英雄第一视角')).not.toBeInTheDocument();
  });
});

describe('StageGrid grid drag reorder', () => {
  let container: HTMLElement;
  let tiles: HTMLDivElement;
  let tileById: Map<string, HTMLDivElement>;
  let notifyResize: ResizeObserverCallback;
  let nextFrameId: number;
  let frames: Map<number, FrameRequestCallback>;

  beforeEach(() => {
    // 组件把右列尺寸交给 ResizeObserver；测试在 render 后提供确定性尺寸再触发回调。
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { notifyResize = callback; }
      observe() {}
      disconnect() {}
      unobserve() {}
    });
    nextFrameId = 1;
    frames = new Map();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function renderHarness() {
    const res = render(<GridHarness />);
    container = res.container;
    const right = container.querySelector('.sg-right') as HTMLDivElement;
    Object.defineProperty(right, 'clientWidth', { configurable: true, value: 326 });
    Object.defineProperty(right, 'clientHeight', { configurable: true, value: 180 });
    act(() => notifyResize([], {} as ResizeObserver));

    tiles = container.querySelector('.sg-tiles') as HTMLDivElement;
    tileById = new Map(
      ['a', 'b'].map((id) => [
        id,
        tiles.querySelector(`[data-view-id="${id}"]`) as HTMLDivElement,
      ]),
    );
    mockTilesGeometry(tiles, tileById);
  }

  function beginDragA() {
    fireEvent.pointerDown(tileById.get('a')!, {
      pointerId: 1,
      button: 0,
      // A 的真实中心（160 / 2, 90 / 2）；因此视觉中心和 pointer 坐标一致。
      clientX: 80,
      clientY: 45,
    });
  }

  /** 模拟 window 层的 pointermove / pointerup / pointercancel（实现挂在 window 上） */
  function flushAnimationFrame() {
    const queued = [...frames.values()];
    frames.clear();
    act(() => queued.forEach((callback) => callback(0)));
  }

  function movePointer(x: number, y: number) {
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: x, clientY: y, bubbles: true }));
    });
    flushAnimationFrame();
  }

  function upPointer() {
    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 80, clientY: 45, bubbles: true }));
    });
  }

  function orderText() {
    return Array.from(tiles.querySelectorAll<HTMLElement>(':scope > [data-view-id]'))
      .map((tile) => tile.dataset.viewId)
      .join(',');
  }

  it('reorders after 60% of the distance toward the target center', () => {
    renderHarness();
    // 相邻格中心相距 166px：从 A 中心 80 往右走 60% 的阈值是 179.6。
    beginDragA();

    movePointer(179, 45);
    expect(orderText()).toBe('a,b');

    movePointer(180, 45);
    expect(orderText()).toBe('b,a');

    upPointer();
  });

  it('keeps a 20% hysteresis band before a reordered tile moves back', () => {
    renderHarness();
    beginDragA();

    movePointer(180, 45);
    expect(orderText()).toBe('b,a');

    // 换位后 A 的 home 已在 x=246；左行 60% 的回退阈值是 146.4。
    // 180 到 147 的 33px（20% 格距）区间是稳定区，不应立即抖回。
    movePointer(147, 45);
    expect(orderText()).toBe('b,a');

    movePointer(146, 45);
    expect(orderText()).toBe('a,b');

    upPointer();
  });

  it('plays a FLIP transition for a displaced non-dragged tile', () => {
    renderHarness();
    beginDragA();

    movePointer(247, 45);
    const b = tileById.get('b')!;

    // React 已将 B 排到首格；FLIP 先反向拉回旧位置，第一阶段禁止 transition
    // 以提交起点。下一 rAF 再开启 180ms transform transition 并播放。
    expect(b.style.transform).toBe('translate3d(166px, 0px, 0)');
    expect(b.style.transition).toBe('none');

    flushAnimationFrame();
    expect(b.style.transition).toBe('transform 180ms cubic-bezier(0.77, 0, 0.175, 1)');
    expect(b.style.transform).toBe('');

    upPointer();
  });

  it('animates a normally released dragged tile back to its grid home', () => {
    renderHarness();
    beginDragA();
    movePointer(120, 45);

    const a = tileById.get('a')!;
    expect(a.style.transform).toBe('translate3d(40px, 0px, 0)');

    upPointer();
    // 松手的提交帧仍停在手指最终位置；否则会先瞬移回 home 再开始动画。
    expect(a.style.transform).toBe('translate3d(40px, 0px, 0)');
    expect(a.style.transition).toBe('none');

    flushAnimationFrame();
    expect(a.style.transition).toBe('transform 180ms cubic-bezier(0.77, 0, 0.175, 1)');
    expect(a.style.transform).toBe('');

    fireEvent.transitionEnd(a, { propertyName: 'transform' });
    expect(a.style.transition).toBe('');
  });

  it('captures after crossing the drag threshold and clears state on pointercancel', () => {
    const setCapture = vi.fn();
    const releaseCapture = vi.fn();
    renderHarness();

    const a = tileById.get('a')!;
    Object.defineProperty(a, 'setPointerCapture', { configurable: true, value: setCapture });
    Object.defineProperty(a, 'releasePointerCapture', { configurable: true, value: releaseCapture });
    Object.defineProperty(a, 'hasPointerCapture', { configurable: true, value: () => true });

    beginDragA();

    // 距起点 11px（Manhattan），越过 10px 拖动阈值。
    movePointer(91, 45);
    expect(setCapture).toHaveBeenCalledWith(1);
    expect(a.classList.contains('dragging')).toBe(true);

    act(() => {
      window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }));
    });
    expect(releaseCapture).toHaveBeenCalledWith(1);
    expect(a.classList.contains('dragging')).toBe(false);
  });
});
