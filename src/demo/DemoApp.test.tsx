import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DemoApp from './DemoApp';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('DemoApp', () => {
  it('renders the complete live-page demo with one popularity bar', () => {
    const { container } = render(<DemoApp state="live" />);

    expect(screen.getByRole('region', { name: '直播视角' })).toBeInTheDocument();
    expect(container.querySelector('.chat-section')).toBeInTheDocument();
    expect(container.querySelectorAll('.demo-feed')).toHaveLength(11);
    expect(container.querySelectorAll('.cheer')).toHaveLength(1);
    expect(container.querySelector('.demo-switcher')).toBeNull();
  });

  it('simulates incoming votes on the popularity bar', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));

    render(<DemoApp state="live" />);
    expect(screen.getByText('2,628')).toBeInTheDocument();
    expect(screen.getByText('2,397')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(3000); });

    expect(screen.getByText('2,636')).toBeInTheDocument();
    expect(screen.getByText('2,402')).toBeInTheDocument();
    expect(screen.getByText('+8')).toBeInTheDocument();
    expect(screen.getByText('+5')).toBeInTheDocument();
  });
});
