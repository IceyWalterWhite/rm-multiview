import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { useHlsPlayer, type SyncBinding } from './useHlsPlayer';
import { SyncEngine } from '../sync/engine';

const hlsMock = vi.hoisted(() => {
  type Handler = (event: string, data?: unknown) => void;
  class MockHls {
    static Events = {
      MANIFEST_PARSED: 'hlsManifestParsed',
      FRAG_BUFFERED: 'hlsFragBuffered',
      FRAG_CHANGED: 'hlsFragChanged',
      ERROR: 'hlsError',
    };
    static ErrorTypes = {
      NETWORK_ERROR: 'networkError',
      MEDIA_ERROR: 'mediaError',
    };
    static isSupported = vi.fn(() => true);
    static DefaultConfig = {
      loader: class {
        load(context: unknown, _config: unknown, callbacks: unknown) {
          hlsMock.loaderLoads.push({ context, callbacks });
        }
        destroy() {}
      },
    };

    handlers = new Map<string, Handler[]>();
    loadSource = vi.fn();
    attachMedia = vi.fn();
    startLoad = vi.fn();
    stopLoad = vi.fn();
    recoverMediaError = vi.fn();
    destroy = vi.fn();
    config: Record<string, unknown>;

    constructor(config: Record<string, unknown> = {}) {
      this.config = config;
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
    loaderLoads: [] as { context: unknown; callbacks: unknown }[],
  };
});

vi.mock('hls.js', () => ({ default: hlsMock.MockHls }));

// hls.js 是动态 import 的：等一个微任务让实例创建完成
async function getHls() {
  await act(async () => { await Promise.resolve(); });
  const hls = hlsMock.instances[0];
  expect(hls).toBeDefined();
  return hls;
}

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
  sync,
}: {
  src?: string;
  onExpired?: () => void;
  keepAliveWhenHidden?: boolean;
  sync?: SyncBinding;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const { error } = useHlsPlayer(ref, src, onExpired, { keepAliveWhenHidden, sync });
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

  it('stops loading while hidden and wakes the stream when visible again without refreshing signatures', async () => {
    const onExpired = vi.fn();
    render(<Harness onExpired={onExpired} />);
    const hls = await getHls();

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

  it('does not stop a side stream while its first load is still in progress', async () => {
    render(<Harness />);
    const hls = await getHls();

    dispatchVisibilityChange('hidden');

    expect(hls.stopLoad).not.toHaveBeenCalled();
    expect(pauseSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('state')).toHaveTextContent('ok');
  });

  it('keeps the main stream loading while hidden when requested', async () => {
    render(<Harness keepAliveWhenHidden />);
    const hls = await getHls();

    dispatchVisibilityChange('hidden');

    expect(hls.stopLoad).not.toHaveBeenCalled();
    expect(pauseSpy).not.toHaveBeenCalled();
    expect(playSpy).toHaveBeenCalled();
    expect(screen.getByTestId('state')).toHaveTextContent('ok');
  });

  it('continues signature refresh handling for a kept-alive hidden stream', async () => {
    const onExpired = vi.fn();
    render(<Harness keepAliveWhenHidden onExpired={onExpired} />);
    const hls = await getHls();

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

  it('does not restart a kept-alive main stream when returning visible', async () => {
    const onExpired = vi.fn();
    render(<Harness keepAliveWhenHidden onExpired={onExpired} />);
    const hls = await getHls();

    dispatchVisibilityChange('hidden');
    dispatchVisibilityChange('visible');

    expect(hls.stopLoad).not.toHaveBeenCalled();
    expect(hls.startLoad).not.toHaveBeenCalled();
    expect(onExpired).not.toHaveBeenCalled();
    expect(playSpy).toHaveBeenCalled();
  });

  it('registers with the sync engine and feeds FRAG_CHANGED name samples', async () => {
    const engine = new SyncEngine();
    const register = vi.spyOn(engine, 'register');
    const onFrag = vi.spyOn(engine, 'onFrag');
    render(<Harness sync={{ engine, id: 'fight001', isMain: false, tier: '540p' }} />);
    const hls = await getHls();

    expect(register).toHaveBeenCalledWith(
      'fight001',
      expect.objectContaining({ isMain: false, tier: '540p' }),
    );
    act(() => {
      hls.emit(hlsMock.MockHls.Events.FRAG_CHANGED, {
        frag: { url: 'https://x/robomaster/a/1785593205_100.ts?auth_key=1', start: 42.5 },
      });
    });
    expect(onFrag).toHaveBeenCalledWith('fight001', { wallSec: 1785593205, fragStart: 42.5 });
  });

  it('ignores fragments whose URL carries no name timestamp', async () => {
    const engine = new SyncEngine();
    const onFrag = vi.spyOn(engine, 'onFrag');
    render(<Harness sync={{ engine, id: 'v', isMain: false, tier: '540p' }} />);
    const hls = await getHls();

    act(() => {
      hls.emit(hlsMock.MockHls.Events.FRAG_CHANGED, { frag: { url: 'chunk1.ts', start: 1 } });
    });
    expect(onFrag).not.toHaveBeenCalled();
  });

  it('installs a tee fragment loader that pushes bytes into the engine', async () => {
    hlsMock.loaderLoads.length = 0;
    const engine = new SyncEngine();
    const pushBytes = vi.spyOn(engine, 'pushBytes');
    render(<Harness sync={{ engine, id: 'v1', isMain: false, tier: '540p' }} />);
    const hls = await getHls();

    const TeeLoader = hls.config.fLoader as new (c: unknown) => {
      load(ctx: unknown, cfg: unknown, cb: unknown): void;
    };
    expect(TeeLoader).toBeDefined();

    // 走一次完整链：TeeLoader.load → 基类记录包装后的 callbacks → 模拟分片到达
    const loader = new TeeLoader({});
    const ctx = { url: 'https://x/a/1785593205_7.ts' };
    loader.load(ctx, {}, { onSuccess: () => {} });
    const wrapped = hlsMock.loaderLoads[0].callbacks as {
      onSuccess: (r: { data: ArrayBuffer }, s: unknown, c: unknown) => void;
    };
    const buf = new ArrayBuffer(16);
    wrapped.onSuccess({ data: buf }, {}, ctx);

    expect(pushBytes).toHaveBeenCalledWith('v1', buf, 'https://x/a/1785593205_7.ts');
  });

  it('does not install a tee loader without a sync binding', async () => {
    render(<Harness />);
    const hls = await getHls();
    expect(hls.config.fLoader).toBeUndefined();
  });

  it('unregisters from the sync engine on teardown', async () => {
    const engine = new SyncEngine();
    const unregister = vi.fn();
    vi.spyOn(engine, 'register').mockReturnValue(unregister);
    const { unmount } = render(<Harness sync={{ engine, id: 'v', isMain: true, tier: '1080p' }} />);
    await getHls();

    unmount();
    expect(unregister).toHaveBeenCalled();
  });

  it('prefers hls.js over native HLS when MSE is available (Chrome 150+ reports native HLS)', async () => {
    // Chrome 150 起 canPlayType('application/vnd.apple.mpegurl') 返回 'maybe'：
    // 若原生分支优先，同步引擎/缓冲配置在现代 Chrome 上会整体失效
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
    Object.defineProperty(globalThis, 'MediaSource', {
      configurable: true,
      value: { isTypeSupported: () => true },
    });
    try {
      render(<Harness />);
      const hls = await getHls(); // MSE 可用 → 必须走 hls.js
      expect(hls.loadSource).toHaveBeenCalled();
    } finally {
      delete (globalThis as Record<string, unknown>).MediaSource;
    }
  });

  it('falls back to native HLS when MSE is unavailable (iOS Safari)', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
    render(<Harness src="https://example.test/native.m3u8" />);
    await act(async () => { await Promise.resolve(); });
    expect(hlsMock.instances.length).toBe(0);
    expect(screen.getByTestId<HTMLVideoElement>('video').src).toBe('https://example.test/native.m3u8');
  });

  it('does not show a retry overlay for fatal network errors raised in a hidden tab', async () => {
    render(<Harness />);
    const hls = await getHls();

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
