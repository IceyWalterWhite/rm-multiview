import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReservedPanel } from './ReservedPanel';

const SCHEDULE = 'https://schedule.scutbot.cn/';
const LADDER = 'https://www.micdz.cn/RM_LADDER/';

describe('ReservedPanel', () => {
  it('embeds the schedule site by default; open button targets it in a new tab', () => {
    render(<ReservedPanel />);
    expect(screen.getByTitle('华南虎赛程分析软件')).toBeVisible();

    const open = screen.getByRole('link', { name: /打开/ });
    expect(open).toHaveAttribute('href', SCHEDULE);
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('does not eager-load the non-active sites on first paint', () => {
    render(<ReservedPanel />);
    // Only the active iframe is mounted — the other third-party sites must not be requested yet.
    expect(screen.queryByTitle('RM天梯榜')).toBeNull();
    expect(screen.queryByTitle('RM斗蛐蛐')).toBeNull();
  });

  it('switches the embedded site (and the open target) when the other tab is clicked', async () => {
    render(<ReservedPanel />);
    await userEvent.click(screen.getByRole('tab', { name: 'RM天梯榜' }));

    expect(screen.getByTitle('RM天梯榜')).toBeVisible();
    expect(screen.getByTitle('华南虎赛程分析软件')).not.toBeVisible();
    expect(screen.getByRole('link', { name: /打开/ })).toHaveAttribute('href', LADDER);
  });

  it('keeps a visited site mounted after switching away (no reload on return)', async () => {
    render(<ReservedPanel />);
    await userEvent.click(screen.getByRole('tab', { name: 'RM天梯榜' }));
    await userEvent.click(screen.getByRole('tab', { name: '华南虎赛程分析软件' }));

    // Back on the schedule, but the ladder iframe stays mounted (hidden) so returning won't reload it.
    expect(screen.getByTitle('华南虎赛程分析软件')).toBeVisible();
    const ladder = screen.getByTitle('RM天梯榜');
    expect(ladder).toBeInTheDocument();
    expect(ladder).not.toBeVisible();
  });
});
