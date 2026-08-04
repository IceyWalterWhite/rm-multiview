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
    render(<ViewTile view={view} quality="540p" stack={null} onToggle={onToggle} />);
    const tile = screen.getByRole('button', { name: /红方英雄/ });
    expect(tile).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(tile);
    expect(onToggle).toHaveBeenCalledWith('fight2026001');
  });
  it('applies enlarged class when enlarged', () => {
    render(<ViewTile view={view} quality="540p" stack={0} onToggle={() => {}} />);
    const tile = screen.getByRole('button', { name: /红方英雄/ });
    expect(tile).toHaveClass('enlarged');
    expect(tile).toHaveAttribute('aria-pressed', 'true');
  });
  // 层级序号走 CSS 变量，遮挡判定靠 data-view-id 把 DOM 和机位对上
  it('exposes stack order and view id to CSS/geometry', () => {
    render(<ViewTile view={view} quality="540p" stack={3} onToggle={() => {}} />);
    const tile = screen.getByRole('button', { name: /红方英雄/ });
    expect(tile).toHaveAttribute('data-view-id', 'fight2026001');
    expect(tile.style.getPropertyValue('--stack')).toBe('3');
  });
});
