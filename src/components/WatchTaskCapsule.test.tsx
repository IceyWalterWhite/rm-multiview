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
  it('degrades to a login link when the helper is ready and only the login is missing', () => {
    render(<WatchTaskCapsule {...base} loggedIn={false} />);
    const link = screen.getByRole('link', { name: /登录领弹丸/ });
    expect(link).toHaveAttribute('href', base.loginUrl);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps one capsule only: without the script it expands instead of jumping to login', async () => {
    render(<WatchTaskCapsule {...base} loggedIn={false} bridgeStatus="missing" />);
    // 顶层只有「登录领弹丸」这一颗，没有第二颗「一键安装直播助手」胶囊
    expect(screen.queryByRole('link', { name: /一键安装直播助手/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /登录领弹丸/ }));
    expect(screen.getByRole('link', { name: /一键安装直播助手/ })).toHaveAttribute('href', base.installUrl);
    expect(screen.getByText(/登录 Cookie 始终留在本地/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /登录 RoboMaster 账号/ })).toHaveAttribute('href', base.loginUrl);
  });

  it('still expands while the probe is unresolved, so a script-less viewer sees the install path', async () => {
    // 探测超时 8 秒，没装脚本的人整段时间都待在 probing —— 这时若按「跳登录」处理，
    // 最该看到安装说明的人恰好看不到。
    render(<WatchTaskCapsule {...base} loggedIn={false} bridgeStatus="probing" />);
    await userEvent.click(screen.getByRole('button', { name: /登录领弹丸/ }));
    expect(screen.getByText(/正在检测直播助手/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /一键安装直播助手/ })).toBeInTheDocument();
  });

  it('moves the installation entry into the panel for a logged-in viewer as well', async () => {
    render(<WatchTaskCapsule {...base} bridgeStatus="missing" />);
    expect(screen.queryByRole('link', { name: /\u4e00\u952e\u5b89\u88c5\u76f4\u64ad\u52a9\u624b/ })).not.toBeInTheDocument();
    const capsule = screen.getByRole('button');
    expect(capsule).toHaveTextContent('15');

    await userEvent.click(capsule);
    expect(screen.getByRole('link', { name: /\u4e00\u952e\u5b89\u88c5\u76f4\u64ad\u52a9\u624b/ })).toHaveAttribute('href', base.installUrl);
    // \u5df2\u767b\u5f55\u5c31\u4e0d\u518d\u91cd\u590d\u63a8\u767b\u5f55\u5165\u53e3
    expect(screen.queryByRole('link', { name: /\u767b\u5f55 RoboMaster \u8d26\u53f7/ })).not.toBeInTheDocument();
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

  it('shows the privacy boundary as fine print under the install action', async () => {
    render(<WatchTaskCapsule {...base} bridgeStatus="missing" />);
    await userEvent.click(screen.getByRole('button', { name: /弹丸/ }));
    const hint = screen.getByText('所有请求均和 RoboMaster 官网接口交互，登录 Cookie 始终留在本地。');
    // 提示性小字与主句（watch-panel__sum）必须是两个层级，不能混用同一样式
    expect(hint).toHaveClass('watch-panel__hint');
    expect(screen.getByRole('link', { name: /一键安装直播助手/ })).toHaveAttribute('href', base.installUrl);
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
