import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { MatchTitleBar } from './MatchTitleBar';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('MatchTitleBar', () => {
  it('re-measures overflow when the title container is resized', () => {
    let onResize: ResizeObserverCallback = () => {};
    let containerWidth = 500;
    const textWidth = 300;

    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: ResizeObserverCallback) {
          onResize = cb;
        }
        observe() { return undefined; }
        disconnect() { return undefined; }
        unobserve() { return undefined; }
      },
    );

    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('match-title') ? containerWidth : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('match-title__text') || this.classList.contains('match-title__seg')
        ? textWidth
        : 0;
    });

    render(<MatchTitleBar text="Long title" fallback="Fallback" />);
    expect(document.querySelector('.match-title__scroll')).toBeNull();

    containerWidth = 100;
    act(() => onResize([], {} as ResizeObserver));

    expect(document.querySelector('.match-title__scroll')).toBeInTheDocument();
  });
});
