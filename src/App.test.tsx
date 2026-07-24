import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';
import type { CatalogState } from './hooks/useCatalog';

const mockState = vi.hoisted(() => ({ current: { status: 'loading' } as CatalogState }));

vi.mock('./hooks/useCatalog', () => ({
  useCatalog: () => ({ state: mockState.current, refresh: vi.fn() }),
}));

describe('App', () => {
  it('shows a loading indicator instead of a blank screen while catalog loads', () => {
    mockState.current = { status: 'loading' };
    render(<App />);
    expect(screen.getByText(/加载中/)).toBeInTheDocument();
  });
  it('shows a friendly error without the raw exception string', () => {
    mockState.current = { status: 'error', message: 'TypeError: Failed to fetch' };
    render(<App />);
    expect(screen.queryByText(/TypeError/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });
});
