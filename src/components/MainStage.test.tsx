import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MainStage } from './MainStage';
import type { StreamView } from '../types';

const main: StreamView = { id: 'm', role: '主视角', side: 'main', sources: [] };

const baseProps = { main, quality: '1080p' as const, titleFallback: '主视角', matchTitle: null, messages: [] };

describe('MainStage', () => {
  it('shows the danmaku overlay when switched on', () => {
    render(<MainStage {...baseProps} showDanmaku />);
    expect(document.querySelector('.dm-overlay')).not.toBeNull();
  });

  it('hides the danmaku overlay when switched off', () => {
    render(<MainStage {...baseProps} showDanmaku={false} />);
    expect(document.querySelector('.dm-overlay')).toBeNull();
  });

  it('forwards main video play state to the caller', () => {
    const onPlayingChange = vi.fn();
    const { container } = render(
      <MainStage
        {...baseProps}
        showDanmaku={false}
        onPlayingChange={onPlayingChange}
      />,
    );

    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    fireEvent.play(video!);
    fireEvent.pause(video!);
    expect(onPlayingChange.mock.calls).toEqual([[true], [false]]);
  });
});
