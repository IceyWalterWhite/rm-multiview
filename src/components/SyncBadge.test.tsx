import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { SyncBadge, type StatusSource } from './SyncBadge';
import type { StreamStatus } from '../sync/engine';

function fakeSource(initial: StreamStatus, live: boolean | null = true) {
  let status = initial;
  let matchLive = live;
  const listeners = new Set<() => void>();
  const source: StatusSource = {
    subscribeChange: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    statusOf: () => status,
    isMatchLive: () => matchLive,
  };
  const notify = () => act(() => listeners.forEach((fn) => fn()));
  return {
    source,
    set(next: StreamStatus) {
      status = next;
      notify();
    },
    setLive(next: boolean | null) {
      matchLive = next;
      notify();
    },
  };
}

describe('SyncBadge', () => {
  it('renders nothing while synced or off', () => {
    const { source } = fakeSource({ error: null, mode: 'off' });
    const { container, rerender } = render(<SyncBadge source={source} id="s1" />);
    expect(container).toBeEmptyDOMElement();
    const synced = fakeSource({ error: 0, mode: 'synced' });
    rerender(<SyncBadge source={synced.source} id="s1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the signed offset while adjusting and hides after convergence', () => {
    const f = fakeSource({ error: -2.3, mode: 'adjusting' });
    const { container } = render(<SyncBadge source={f.source} id="s1" />);
    expect(screen.getByText(/−2\.3s/)).toBeInTheDocument();
    f.set({ error: 0, mode: 'synced' });
    expect(container).toBeEmptyDOMElement();
  });

  it('labels the stalled-buffer state without implying the match has not started', () => {
    const f = fakeSource({ error: -6, mode: 'edge' });
    render(<SyncBadge source={f.source} id="s1" />);
    expect(screen.getByText('缓冲中')).toBeInTheDocument();
    expect(screen.queryByText(/等待直播/)).not.toBeInTheDocument();
  });

  // 赛间：流照常在推垫片，引擎照常测出误差，但观众不该看见一排「同步 −2.5s」
  it('stays silent between matches even while the engine is still adjusting', () => {
    const f = fakeSource({ error: -2.5, mode: 'adjusting' }, false);
    const { container } = render(<SyncBadge source={f.source} id="s1" />);
    expect(container).toBeEmptyDOMElement();
    f.setLive(true);
    expect(screen.getByText(/−2\.5s/)).toBeInTheDocument();
    f.setLive(false);
    expect(container).toBeEmptyDOMElement();
  });

  it('stays silent when the live state is unknown (probe unavailable)', () => {
    const f = fakeSource({ error: -2.5, mode: 'adjusting' }, null);
    const { container } = render(<SyncBadge source={f.source} id="s1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('treats a source without the probe as unknown rather than live', () => {
    // getSnapshot 必须引用稳定，否则 useSyncExternalStore 会认定状态一直在变而无限重渲染
    // ——这正是 engine 用 statusCache 缓存 StreamStatus 的原因
    const status: StreamStatus = { error: -2.5, mode: 'adjusting' };
    const source: StatusSource = {
      subscribeChange: () => () => {},
      statusOf: () => status,
    };
    const { container } = render(<SyncBadge source={source} id="s1" />);
    expect(container).toBeEmptyDOMElement();
  });
});
