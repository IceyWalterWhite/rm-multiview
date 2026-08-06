import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import type { CatalogState } from './hooks/useCatalog';

const mockState = vi.hoisted(() => ({ current: { status: 'loading' } as CatalogState }));
const mockCheer = vi.hoisted(() => ({
  current: {
    redVotes: 2628,
    blueVotes: 2397,
    redLabel: 'A大学 Alpha',
    blueLabel: 'B大学 Beta',
    visible: true,
    error: null as string | null,
  },
}));

const mockWatchTask = vi.hoisted(() => ({
  current: {
    loggedIn: false,
    accumulatedSeconds: 0,
    earnedPellets: 0,
    tiers: [],
    officialUrl: 'https://www.robomaster.com/live',
    loginUrl: 'https://www.robomaster.com/api/members/oauth',
    bridgeStatus: 'missing' as const,
    heartbeatStatus: 'idle' as const,
    heartbeatError: null,
    retryHeartbeat: vi.fn(),
  },
}));

vi.mock('./hooks/useCatalog', () => ({
  useCatalog: () => ({ state: mockState.current, refresh: vi.fn() }),
}));

vi.mock('./hooks/useCheer', () => ({
  useCheer: () => mockCheer.current,
}));

vi.mock('./hooks/useWatchTask', () => ({
  useWatchTask: () => mockWatchTask.current,
}));

vi.mock('./hooks/useOfficialBridge', () => ({
  useOfficialBridge: () => ({ status: 'missing', request: vi.fn(), retry: vi.fn() }),
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
    expect(screen.getByRole('group', { name: '人气助威' })).toBeInTheDocument();
    expect(screen.getByText('A大学 Alpha')).toBeInTheDocument();
    expect(screen.getByText('B大学 Beta')).toBeInTheDocument();
    expect(screen.getByText('2,628')).toBeInTheDocument();
    expect(screen.getByText('2,397')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '发送' })).not.toBeInTheDocument();
  });

  it('does not mount an empty popularity bar without a current official match', () => {
    mockCheer.current.visible = false;
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

    render(<App />);
    expect(screen.queryByRole('group', { name: '人气助威' })).not.toBeInTheDocument();
    mockCheer.current.visible = true;
  });

  it('mounts the official bridge setup entry in the live app', async () => {
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
    // 底栏只有这一颗胶囊；装脚本的入口收在它展开的面板里，不在栏上另占一格
    expect(container.querySelector('.watch-capsule')).not.toBeNull();
    expect(screen.queryByRole('link', { name: '一键安装直播助手' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /登录领弹丸/ }));
    expect(screen.getByRole('link', { name: '一键安装直播助手' })).toHaveAttribute('href', '/rmlive-companion.user.js');
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
