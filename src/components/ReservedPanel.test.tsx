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
    expect(screen.getByTitle('RM天梯榜')).not.toBeVisible();

    const open = screen.getByRole('link', { name: /打开/ });
    expect(open).toHaveAttribute('href', SCHEDULE);
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('switches the embedded site (and the open target) when the other tab is clicked', async () => {
    render(<ReservedPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'RM天梯榜' }));

    expect(screen.getByTitle('RM天梯榜')).toBeVisible();
    expect(screen.getByTitle('华南虎赛程分析软件')).not.toBeVisible();
    expect(screen.getByRole('link', { name: /打开/ })).toHaveAttribute('href', LADDER);
  });
});
