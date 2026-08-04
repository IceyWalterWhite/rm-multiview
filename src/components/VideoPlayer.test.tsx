import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VideoPlayer } from './VideoPlayer';

describe('VideoPlayer demo source', () => {
  it('renders a local demo feed instead of a video element', () => {
    const { container } = render(<VideoPlayer src="demo:主视角" className="main-video" />);

    expect(container.querySelector('.demo-feed')).toBeInTheDocument();
    expect(container.querySelector('video')).toBeNull();
  });
});

describe('VideoPlayer playback state', () => {
  it('reports play, pause, and ended transitions from the real video element', () => {
    const onPlayingChange = vi.fn();
    const { container } = render(
      <VideoPlayer src="https://example.test/live.m3u8" onPlayingChange={onPlayingChange} />,
    );
    const video = container.querySelector('video');
    expect(video).not.toBeNull();

    fireEvent.play(video!);
    fireEvent.pause(video!);
    fireEvent.ended(video!);

    expect(onPlayingChange.mock.calls).toEqual([[true], [false], [false]]);
  });
});
