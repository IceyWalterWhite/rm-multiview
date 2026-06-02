import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { useHlsPlayer } from './useHlsPlayer';

const hlsMock = vi.hoisted(() => {
  type Handler = (event: string, data?: unknown) => void;
  class MockHls {
    static Events = {
      MANIFEST_PARSED: 'hlsManifestParsed',
      FRAG_BUFFERED: 'hlsFragBuffered',
      ERROR: 'hlsError',
    };
    static ErrorTypes = {
      NETWORK_ERROR: 'networkError',
      MEDIA_ERROR: 'mediaError',
    };
    static isSupported = vi.fn(() => true);

    handlers = new Map<string, Handler[]>();
    loadSource = vi.fn();
    attachMedia = vi.fn();
    startLoad = vi.fn();
    stopLoad = vi.fn();
    recoverMediaError = vi.fn();
    destroy = vi.fn();

    constructor() {
      hlsMock.instances.push(this);
    }

    on(event: string, handler: Handler) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    }

    emit(event: string, data?: unknown) {
      for (const handler of this.handlers.get(event) ?? []) handler(event, data);
    }
  }

  return {
    MockHls,
    instances: [] as MockHls[],
  };
});

vi.mock('hls.js', () => ({ default: hlsMock.MockHls }));

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  Object.defineProperty(document, 'hidden', { configurable: true, value: state === 'hidden' });
}

function dispatchVisibilityChange(state: DocumentVisibilityState) {
  setVisibility(state);
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

function Harness({
  src = 'https://example.test/live.m3u8',
  onExpired = () => {},
  keepAliveWhenHidden = false,
}: {
  src?: string;
  onExpired?: () => void;
  keepAliveWhenHidden?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const { error } = useHlsPlayer(ref, src, onExpired, { keepAliveWhenHidden });
  return (
    <>
      <video data-testid="video" ref={ref} />
      <span data-testid="state">{error ? 'error' : 'ok'}</span>
    </>
  );
}

describe('useHlsPlayer', () => {
  let playSpy: ReturnType<typeof vi.spyOn>;
  let pauseSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    hlsMock.instances.length = 0;
    setVisibility('visible');
    playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stops loading while hidden and wakes the stream when visible again without refreshing signatures', () => {
    const onExpired = vi.fn();
    render(<Harness onExpired={onExpired} />);
    const hls = hlsMock.instances[0];

    act(() => {
      hls.emit(hlsMock.MockHls.Events.FRAG_BUFFERED);
    });
    dispatchVisibilityChange('hidden');
    expect(hls.stopLoad).toHaveBeenCalled();
    expect(pauseSpy).toHaveBeenCalled();
    expect(screen.getByTestId('state')).toHaveTextContent('ok');

    dispatchVisibilityChange('visible');
    expect(onExpired).not.toHaveBeenCalled();
    expect(hls.startLoad).toHaveBeenCalledWith(-1);
    expect(playSpy).toHaveBeenCalled();
  });

  it('does not stop a side stream while its first load is still in progress', () => {
    render(<Harness />);
    const hls = hlsMock.instances[0];

    dispatchVisibilityChange('hidden');

    expect(hls.stopLoad).not.toHaveBeenCalled();
    expect(pauseSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('state')).toHaveTextContent('ok');
  });

  it('keeps the main stream loading while hidden when requested', () => {
    render(<Harness keepAliveWhenHidden />);
    const hls = hlsMock.instances[0];

    dispatchVisibilityChange('hidden');

    expect(hls.stopLoad).not.toHaveBeenCalled();
    expect(pauseSpy).not.toHaveBeenCalled();
    expect(playSpy).toHaveBeenCalled();
    expect(screen.getByTestId('state')).toHaveTextContent('ok');
  });

  it('continues signature refresh handling for a kept-alive hidden stream', () => {
    const onExpired = vi.fn();
    render(<Harness keepAliveWhenHidden onExpired={onExpired} />);
    const hls = hlsMock.instances[0];

    dispatchVisibilityChange('hidden');
    act(() => {
      hls.emit(hlsMock.MockHls.Events.ERROR, {
        fatal: true,
        type: hlsMock.MockHls.ErrorTypes.NETWORK_ERROR,
        response: { code: 403 },
      });
    });

    expect(hls.stopLoad).not.toHaveBeenCalled();
    expect(onExpired).toHaveBeenCalled();
  });

  it('does not restart a kept-alive main stream when returning visible', () => {
    const onExpired = vi.fn();
    render(<Harness keepAliveWhenHidden onExpired={onExpired} />);
    const hls = hlsMock.instances[0];

    dispatchVisibilityChange('hidden');
    dispatchVisibilityChange('visible');

    expect(hls.stopLoad).not.toHaveBeenCalled();
    expect(hls.startLoad).not.toHaveBeenCalled();
    expect(onExpired).not.toHaveBeenCalled();
    expect(playSpy).toHaveBeenCalled();
  });

  it('does not show a retry overlay for fatal network errors raised in a hidden tab', () => {
    render(<Harness />);
    const hls = hlsMock.instances[0];

    act(() => {
      hls.emit(hlsMock.MockHls.Events.FRAG_BUFFERED);
    });
    dispatchVisibilityChange('hidden');
    act(() => {
      hls.emit(hlsMock.MockHls.Events.ERROR, {
        fatal: true,
        type: hlsMock.MockHls.ErrorTypes.NETWORK_ERROR,
        response: { code: 0 },
      });
    });

    expect(hls.stopLoad).toHaveBeenCalled();
    expect(screen.getByTestId('state')).toHaveTextContent('ok');
  });
});
