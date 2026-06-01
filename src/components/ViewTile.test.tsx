import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ViewTile } from './ViewTile';
import type { StreamView } from '../types';

const view: StreamView = { id: 'fight2026001', role: '红方英雄第一视角', side: 'red',
  sources: [{ label: '540p', src: 'https://x/fight2026001_hd.m3u8', res: 'low' }] };

describe('ViewTile', () => {
  it('toggles enlarged class and calls onToggle', async () => {
    const onToggle = vi.fn();
    render(<ViewTile view={view} quality="540p" enlarged={false} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('button', { name: /红方英雄/ }));
    expect(onToggle).toHaveBeenCalledWith('fight2026001');
  });
  it('applies enlarged class when enlarged', () => {
    render(<ViewTile view={view} quality="540p" enlarged onToggle={() => {}} />);
    expect(screen.getByRole('button', { name: /红方英雄/ })).toHaveClass('enlarged');
  });
});
