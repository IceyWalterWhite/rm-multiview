import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { SyncBadge, type StatusSource } from './SyncBadge';
import type { StreamStatus } from '../sync/engine';

function fakeSource(initial: StreamStatus) {
  let status = initial;
  const listeners = new Set<() => void>();
  const source: StatusSource = {
    subscribeChange: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    statusOf: () => status,
  };
  return {
    source,
    set(next: StreamStatus) {
      status = next;
      act(() => listeners.forEach((fn) => fn()));
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

  it('labels the live-edge wait state', () => {
    const f = fakeSource({ error: -6, mode: 'edge' });
    render(<SyncBadge source={f.source} id="s1" />);
    expect(screen.getByText(/等待直播/)).toBeInTheDocument();
  });
});
