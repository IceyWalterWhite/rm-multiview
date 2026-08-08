import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StageGrid } from './StageGrid';
import type { StreamView } from '../types';

const view: StreamView = {
  id: 'fight2026001',
  role: '红方英雄第一视角',
  side: 'red',
  sources: [],
};

describe('StageGrid', () => {
  it('keeps the stream name accessible without painting it over the video', () => {
    const { container } = render(
      <StageGrid
        views={[view]}
        order={[view.id]}
        onReorder={vi.fn()}
        selected={null}
        onSelect={vi.fn()}
        quality="540p"
        mainSlot={<div>主视角</div>}
        sandboxSlot={() => <div>沙盘</div>}
      />,
    );

    expect(screen.getByRole('button', { name: '红方英雄第一视角' })).toBeInTheDocument();
    expect(container.querySelector('.sg-tile-name')).not.toBeInTheDocument();
    expect(screen.queryByText('红方英雄第一视角')).not.toBeInTheDocument();
  });
});
