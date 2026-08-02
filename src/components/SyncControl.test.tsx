import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
});
