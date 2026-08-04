import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WatchTaskCapsule, type WatchTaskTier } from './WatchTaskCapsule';
import { formatWatchDuration } from '../watchDuration';

const tiers: WatchTaskTier[] = [
  { id: 1, minutes: 10, seconds: 600, pellets: 1, increment: 1, granted: true },
  { id: 2, minutes: 30, seconds: 1800, pellets: 3, increment: 2, granted: false },
  { id: 3, minutes: 60, seconds: 3600, pellets: 6, increment: 3, granted: false },
];

const base = {
  loggedIn: true,
  accumulatedSeconds: 900,
  earnedPellets: 1,
  tiers,
  loginUrl: 'https://www.robomaster.com/login',
  officialUrl: 'https://www.robomaster.com/zh-CN/live',
  installUrl: '/rmlive-companion.user.js',
  bridgeStatus: 'ready' as const,
  heartbeatStatus: 'running' as const,
  heartbeatError: null,
  onRetryHeartbeat: vi.fn(),
};

describe('formatWatchDuration', () => {
  it('drops seconds in compact form so the capsule width does not jitter', () => {
    expect(formatWatchDuration(900, true)).toBe('15 分');
    expect(formatWatchDuration(30, true)).toBe('不足 1 分');
    expect(formatWatchDuration(3900, true)).toBe('1 小时 5 分');
    expect(formatWatchDuration(900)).toBe('15 分 00 秒');
  });
});

describe('WatchTaskCapsule', () => {
  it('degrades to a login link when not logged in', () => {
    render(<WatchTaskCapsule {...base} loggedIn={false} />);
    const link = screen.getByRole('link', { name: /登录领弹丸/ });
    expect(link).toHaveAttribute('href', base.loginUrl);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers one-click userscript installation when the bridge is missing', () => {
    render(<WatchTaskCapsule {...base} loggedIn={false} bridgeStatus="missing" />);
    expect(screen.getByRole('link', { name: /一键安装直播助手/ })).toHaveAttribute('href', base.installUrl);
    expect(screen.queryByRole('link', { name: /登录领弹丸/ })).not.toBeInTheDocument();
  });

  it('shows the earned pellets and accumulated time on the capsule', () => {
    render(<WatchTaskCapsule {...base} />);
    const capsule = screen.getByRole('button');
    expect(capsule).toHaveTextContent('1');
    expect(capsule).toHaveTextContent('15 分');
    expect(capsule).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens an anchored dialog listing granted and pending tiers', async () => {
    render(<WatchTaskCapsule {...base} />);
    await userEvent.click(screen.getByRole('button', { name: /弹丸/ }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('观看 10 分钟')).toBeInTheDocument();
    expect(screen.getByText('已获得')).toBeInTheDocument();
    // 未达成的档显示还差多少，而不是只写「未达成」
    expect(screen.getByText('还差 15 分')).toBeInTheDocument();
    expect(screen.getByText('还差 45 分')).toBeInTheDocument();
  });

  it('closes again on the dialog close event (Esc path)', async () => {
    render(<WatchTaskCapsule {...base} />);
    const capsule = screen.getByRole('button', { name: /弹丸/ });
    await userEvent.click(capsule);
    expect(capsule).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(capsule);
    expect(capsule).toHaveAttribute('aria-expanded', 'false');
  });

  it('states that a missing script cannot accumulate time but keeps showing synced progress', async () => {
    render(<WatchTaskCapsule {...base} bridgeStatus="missing" />);
    await userEvent.click(screen.getByRole('button', { name: /弹丸/ }));
    expect(screen.getByText(/本站不能累计/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /一键安装直播助手/ })).toHaveAttribute('href', base.installUrl);
    expect(screen.getByRole('link', { name: /官网直播页/ })).toHaveAttribute('href', base.officialUrl);
  });

  it('shows a non-reloading retry after heartbeat failures', async () => {
    const onRetryHeartbeat = vi.fn();
    render(<WatchTaskCapsule
      {...base}
      heartbeatStatus="error"
      heartbeatError="官方心跳暂时不可用"
      onRetryHeartbeat={onRetryHeartbeat}
    />);
    await userEvent.click(screen.getByRole('button', { name: /弹丸/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('官方心跳暂时不可用');
    await userEvent.click(screen.getByRole('button', { name: /重试观看计时/ }));
    expect(onRetryHeartbeat).toHaveBeenCalledTimes(1);
  });
});
