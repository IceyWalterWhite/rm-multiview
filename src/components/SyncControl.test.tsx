import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SyncControl } from './SyncControl';

const noop = () => {};

describe('SyncControl', () => {
  it('renders the sync toggle with its current state', () => {
    render(<SyncControl on onToggle={noop} trim={0} onTrim={noop} />);
    expect(screen.getByRole('button', { name: /时码同步/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens the trim panel on demand and applies slider input continuously', async () => {
    const onTrim = vi.fn();
    render(<SyncControl on onToggle={noop} trim={0} onTrim={onTrim} />);
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /微调/ }));
    const slider = screen.getByRole('slider', { name: /同步微调/ });
    fireEvent.change(slider, { target: { value: '1.5' } });
    expect(onTrim).toHaveBeenCalledWith(1.5);
  });

  it('resets the trim to zero', async () => {
    const onTrim = vi.fn();
    render(<SyncControl on onToggle={noop} trim={2.5} onTrim={onTrim} />);
    await userEvent.click(screen.getByRole('button', { name: /微调/ }));
    await userEvent.click(screen.getByRole('button', { name: /重置/ }));
    expect(onTrim).toHaveBeenCalledWith(0);
  });

  it('closes the panel with Escape', async () => {
    render(<SyncControl on onToggle={noop} trim={0} onTrim={noop} />);
    await userEvent.click(screen.getByRole('button', { name: /微调/ }));
    expect(screen.getByRole('slider')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('hides the trim affordance while sync is off', () => {
    render(<SyncControl on={false} onToggle={noop} trim={0} onTrim={noop} />);
    expect(screen.queryByRole('button', { name: /微调/ })).not.toBeInTheDocument();
  });

  // 偏移测歪后没有自愈路径：赛间侧路数字静音，校准整轮被质量门限拒绝，
  // 错值会挂到下一场开赛。手动重测是那时唯一的出路，所以它必须有明确反馈。
  describe('重新校准', () => {
    const openPanel = () => userEvent.click(screen.getByRole('button', { name: /微调/ }));

    it('没有这个能力时不摆按钮', async () => {
      render(<SyncControl on onToggle={noop} trim={0} onTrim={noop} />);
      await openPanel();
      expect(screen.queryByRole('button', { name: '重新校准' })).not.toBeInTheDocument();
    });

    it('点击触发重测并报出路数', async () => {
      const onRecalibrate = vi.fn().mockResolvedValue(7);
      render(<SyncControl on onToggle={noop} trim={0} onTrim={noop} onRecalibrate={onRecalibrate} />);
      await openPanel();
      await userEvent.click(screen.getByRole('button', { name: '重新校准' }));
      expect(onRecalibrate).toHaveBeenCalledOnce();
      expect(await screen.findByText('已重测 7 路')).toBeInTheDocument();
    });

    it('一路都没测到时说明原因，不报成故障', async () => {
      const onRecalibrate = vi.fn().mockResolvedValue(0);
      render(<SyncControl on onToggle={noop} trim={0} onTrim={noop} onRecalibrate={onRecalibrate} />);
      await openPanel();
      await userEvent.click(screen.getByRole('button', { name: '重新校准' }));
      expect(await screen.findByText(/无可用音频/)).toBeInTheDocument();
    });

    it('抛错也要有下文', async () => {
      const onRecalibrate = vi.fn().mockRejectedValue(new Error('boom'));
      render(<SyncControl on onToggle={noop} trim={0} onTrim={noop} onRecalibrate={onRecalibrate} />);
      await openPanel();
      await userEvent.click(screen.getByRole('button', { name: '重新校准' }));
      expect(await screen.findByText('校准失败')).toBeInTheDocument();
    });

    it('校准期间禁用，连点不会叠多轮', async () => {
      let finish: (n: number) => void = () => {};
      const onRecalibrate = vi.fn(() => new Promise<number>((r) => { finish = r; }));
      render(<SyncControl on onToggle={noop} trim={0} onTrim={noop} onRecalibrate={onRecalibrate} />);
      await openPanel();
      await userEvent.click(screen.getByRole('button', { name: '重新校准' }));

      const busy = await screen.findByRole('button', { name: '校准中…' });
      expect(busy).toBeDisabled();
      await userEvent.click(busy);
      expect(onRecalibrate).toHaveBeenCalledOnce();

      await act(async () => { finish(3); });
      expect(await screen.findByText('已重测 3 路')).toBeInTheDocument();
    });
  });
});
