import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';
import type { CatalogState } from './hooks/useCatalog';

const mockState = vi.hoisted(() => ({ current: { status: 'loading' } as CatalogState }));

vi.mock('./hooks/useCatalog', () => ({
  useCatalog: () => ({ state: mockState.current, refresh: vi.fn() }),
}));

describe('App', () => {
  // 2026-07-28 线上事故：官方开了「搭建直播」赛区（liveState=1 但 chatRoomId 为 null），
  // App 渲染 null 导致整站白屏。无聊天室必须降级显示画面，而非空白。
  it('renders the live stage with danmaku disabled when the live zone has no chat room', () => {
    mockState.current = {
      status: 'live',
      catalog: {
        zoneName: '搭建直播',
        chatRoomId: '',
        main: { id: 'm', role: '主视角', side: 'main', sources: [] },
        redViews: [],
        blueViews: [],
      },
    };
    const { container } = render(<App />);
    expect(container.firstChild).not.toBeNull();
    expect(screen.getByText('本场直播未开启弹幕')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '发送' })).not.toBeInTheDocument();
  });

  it('shows a loading indicator instead of a blank screen while catalog loads', () => {
    mockState.current = { status: 'loading' };
    render(<App />);
    expect(screen.getByText(/加载中/)).toBeInTheDocument();
  });
  it('shows a friendly error without the raw exception string', () => {
    mockState.current = { status: 'error', message: 'TypeError: Failed to fetch' };
    render(<App />);
    expect(screen.queryByText(/TypeError/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });
});
