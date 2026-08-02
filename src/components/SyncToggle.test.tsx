import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SyncToggle } from './SyncToggle';

describe('SyncToggle', () => {
  it('reflects the on state via aria-pressed', () => {
    const { rerender } = render(<SyncToggle on onToggle={() => {}} />);
    expect(screen.getByRole('button', { name: /时码同步/ })).toHaveAttribute('aria-pressed', 'true');
    rerender(<SyncToggle on={false} onToggle={() => {}} />);
    expect(screen.getByRole('button', { name: /时码同步/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('fires onToggle when clicked', async () => {
    const onToggle = vi.fn();
    render(<SyncToggle on onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('button', { name: /时码同步/ }));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
