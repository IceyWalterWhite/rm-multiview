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
  const { error, starting } = useHlsPlayer(ref, src, onExpired, { keepAliveWhenHidden, sync });
  return (
    <>
      <video data-testid="video" ref={ref} />
      <span data-testid="state">{error ? 'error' : 'ok'}</span>
      <span data-testid="starting">{starting ? 'starting' : 'idle'}</span>
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

// 2026-08-04 现网实测的线上事故：resize 后某一路 <video> 报 error(code=4)/networkState=3，
// 之后 56s 内 currentTime 一格未动、「信号中断·重连中…」永不消失。实测仅调 load()（src 一字未改）
// 即刻恢复 → 说明签名是好的，缺的只是「重启资源选择算法」这一步。
describe('useHlsPlayer — 原生 HLS 兜底路径的断线自愈', () => {
  let playSpy: ReturnType<typeof vi.spyOn>;
  let loadSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    hlsMock.instances.length = 0;
    setVisibility('visible');
    playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    loadSpy = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    // Chrome 150+ 与 Safari 同样返回 'maybe'（''|'maybe'|'probably' 里 'maybe' 也是 truthy）
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
    // 退避带抖动（生产上用来把 11 路散开）；测试固定取中点，否则断言会间歇性翻红
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('picks hls.js over native HLS whenever MSE exists (Chrome 150 reports maybe)', async () => {
    vi.stubGlobal('MediaSource', class {});
    try {
      render(<Harness />);
      await act(async () => { await Promise.resolve(); });
      // 走了 hls.js → 才有缓冲配置、签名重连、时码同步
      expect(hlsMock.instances).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('counts ManagedMediaSource (iOS 17.1+) as MSE so new iOS also gets hls.js', async () => {
    vi.stubGlobal('ManagedMediaSource', class {});
    try {
      render(<Harness />);
      await act(async () => { await Promise.resolve(); });
      expect(hlsMock.instances).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('restarts the element after a fatal media error instead of stranding it forever', async () => {
    vi.useFakeTimers();
    render(<Harness />); // 无 MSE（jsdom 默认）+ canPlayType='maybe' → 原生兜底分支
    const video = screen.getByTestId('video');
    expect(hlsMock.instances).toHaveLength(0);
    loadSpy.mockClear();
    playSpy.mockClear();

    act(() => { video.dispatchEvent(new Event('error')); });
    expect(screen.getByTestId('state')).toHaveTextContent('error');

    // NETWORK_NO_SOURCE 是资源选择算法的终态，浏览器永不自愈：必须由我们重启
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(loadSpy).toHaveBeenCalled();
    expect(playSpy).toHaveBeenCalled();
  });

  it('keeps retrying a stream that fails again mid-recovery', async () => {
    vi.useFakeTimers();
    render(<Harness />);
    const video = screen.getByTestId('video');
    loadSpy.mockClear();

    act(() => { video.dispatchEvent(new Event('error')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    const afterFirst = loadSpy.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    // 重启后又断（弱网常态）→ 必须继续救，不能一次放弃
    act(() => { video.dispatchEvent(new Event('error')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(loadSpy.mock.calls.length).toBeGreaterThan(afterFirst);
  });

  it('backs off instead of hammering load() in a tight loop', async () => {
    vi.useFakeTimers();
    render(<Harness />);
    const video = screen.getByTestId('video');
    loadSpy.mockClear();

    // 持续失败 2 分钟：退避必须让重启次数保持在个位数，
    // 否则 11 路同时狂刷会把本就吃紧的带宽彻底压垮（见 bandwidth-starves-11-streams）
    for (let i = 0; i < 12; i++) {
      act(() => { video.dispatchEvent(new Event('error')); });
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    }
    expect(loadSpy.mock.calls.length).toBeLessThan(10);
  });

  it('does not strand a stream whose signature refresh never lands', async () => {
    // hls.js 路径的同款死锁：403 只 refresh 不 startLoad。若 refresh 撞上 15s 冷却窗、
    // 或签名其实没过期（拿回的 src 一模一样 → effect 不重建），这条流就再没人碰。
    vi.stubGlobal('MediaSource', class {});
    vi.useFakeTimers();
    try {
      const onExpired = vi.fn();
      render(<Harness onExpired={onExpired} />);
      await act(async () => { await Promise.resolve(); });
      const hls = hlsMock.instances[0];
      expect(hls).toBeDefined();

      act(() => {
        hls.emit(hlsMock.MockHls.Events.ERROR, {
          fatal: true,
          type: hlsMock.MockHls.ErrorTypes.NETWORK_ERROR,
          response: { code: 403 },
        });
      });
      expect(onExpired).toHaveBeenCalled();
      expect(hls.startLoad).not.toHaveBeenCalled(); // 先给 refresh 机会换签名

      // refresh 没换来新 src（冷却窗/签名没真过期）→ 必须自己拉起来
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(hls.startLoad).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('clears the retry overlay once playback actually resumes', async () => {
    vi.useFakeTimers();
    render(<Harness />);
    const video = screen.getByTestId('video');

    act(() => { video.dispatchEvent(new Event('error')); });
    expect(screen.getByTestId('state')).toHaveTextContent('error');

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    act(() => { video.dispatchEvent(new Event('playing')); });
    expect(screen.getByTestId('state')).toHaveTextContent('ok');
  });
});

// 2026-08-06 现网定案的「主视角起播空等 6 秒」。HLS_CONFIG.liveSyncDuration:12 只有侧路吃得下：
// hls.js 按 playlist 总时长截断（dist/hls.js:33761 `min = edge − totalduration`），主视角 3 片×2s
// 当场砍成 6，侧路 3 片×5s 毫发无伤——配置层先天差 6 秒。同步再按 offset 把侧路推近直播边缘后
// 存货只剩 2.3s，而侧路分片是 5s 一个 → 触底断粮 → 变速档越追越亏的病态极限环（实测 64.5 次/分，
// 主视角 0 次）。空等把主视角落后量补到 ~13.5s，侧路目标随之 ~9s > 5s 分片周期，存货才经得起推。
describe('useHlsPlayer — 主视角起播前的 6 秒空等', () => {
  let playSpy: ReturnType<typeof vi.spyOn>;
  let pauseSpy: ReturnType<typeof vi.spyOn>;

  const mainSync = (): SyncBinding =>
    ({ engine: new SyncEngine(), id: 'main', isMain: true, tier: '1080p' });

  beforeEach(() => {
    hlsMock.instances.length = 0;
    setVisibility('visible');
    playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers(); // 假时钟绝不能漏给同文件其它用例
    vi.restoreAllMocks();
  });

  it('keeps the main stream silent until the 6s are up, MANIFEST_PARSED notwithstanding', async () => {
    render(<Harness sync={mainSync()} />);
    const hls = await getHls();
    const video = screen.getByTestId('video');

    // 清单解析完就开播 = 白等，落后量当场缩回 6 秒
    act(() => { hls.emit(hlsMock.MockHls.Events.MANIFEST_PARSED); });
    expect(playSpy).not.toHaveBeenCalled();

    act(() => { video.dispatchEvent(new Event('canplay')); }); // 计时从「本该开播的那一刻」起算
    await act(async () => { await vi.advanceTimersByTimeAsync(5_999); });
    expect(playSpy).not.toHaveBeenCalled(); // 差一毫秒都不放行

    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(playSpy).toHaveBeenCalled();
  });

  it('pushes <video autoPlay> back down when it starts on its own, without restarting the clock', async () => {
    render(<Harness sync={mainSync()} />);
    await getHls();
    const video = screen.getByTestId('video');
    pauseSpy.mockClear();

    // autoPlay 会在数据就绪时自作主张开播，「不主动调 play()」拦不住它
    act(() => { video.dispatchEvent(new Event('play')); });
    expect(pauseSpy).toHaveBeenCalled();
    expect(playSpy).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    act(() => { video.dispatchEvent(new Event('play')); }); // 中途又偷跑一次
    expect(playSpy).not.toHaveBeenCalled();

    // 偷跑不该把计时器推倒重来：起点后满 6 秒即放行，一次
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it('starts the clock on canplay alone when autoplay is denied and play never fires', async () => {
    // 主视角的 muted 由外部传入：未静音时浏览器自动播放策略可能直接拒绝，play 事件永不触发。
    // 只认 play 的话定时器永远起不来，主视角就是一块永久黑屏。
    playSpy.mockImplementation(() => Promise.reject(new Error('NotAllowedError')));
    render(<Harness sync={mainSync()} />);
    await getHls();
    const video = screen.getByTestId('video');

    act(() => { video.dispatchEvent(new Event('canplay')); });
    expect(playSpy).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(playSpy).toHaveBeenCalled(); // 被拒的 play 由 playVideo 吞掉，不该冒成未处理拒绝
  });

  it('never delays a side stream — its 8s buffer could not survive another 6s of lag', async () => {
    const engine = new SyncEngine();
    render(<Harness sync={{ engine, id: 'side', isMain: false, tier: '540p' }} />);
    const hls = await getHls();
    const video = screen.getByTestId('video');

    act(() => { hls.emit(hlsMock.MockHls.Events.MANIFEST_PARSED); });
    expect(playSpy).toHaveBeenCalled();
    expect(screen.getByTestId('starting')).toHaveTextContent('idle');

    // 侧路本就起播在 edge−12，再退 6 秒同步得往前推 9 秒，而 maxBufferLength:8 让它跳不回来
    act(() => { video.dispatchEvent(new Event('play')); });
    expect(pauseSpy).not.toHaveBeenCalled();
  });

  it('plays straight away when there is no sync binding to delay for', async () => {
    render(<Harness />);
    const hls = await getHls();

    act(() => { hls.emit(hlsMock.MockHls.Events.MANIFEST_PARSED); });
    expect(playSpy).toHaveBeenCalled();
    expect(pauseSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('starting')).toHaveTextContent('idle');
  });

  // 空等攒出的落后量会被 stall 后的 synchronizeToLiveEdge 整段吐回（2026-08-07 实测
  // 13.4→7.9），1080p 滑窗只有 6s 回不去——运行时自愈：FRAG_CHANGED 上发现主视角
  // 落后量低于安全线就重新 hold 6s。冻屏观感与首次起播完全一致（同一套「准备中…」）。
  describe('运行时自愈 hold', () => {
    const fragAt = (lagSec: number, video: HTMLMediaElement) => ({
      frag: {
        url: `${Math.floor(Date.now() / 1000 - lagSec - video.currentTime)}_100.ts`,
        start: 0,
      },
    });
    const finishStartupHold = async (video: HTMLElement) => {
      act(() => { video.dispatchEvent(new Event('canplay')); });
      await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
      // 播放中：自愈判据要求 !paused，而 jsdom 的 paused 恒为 true
      Object.defineProperty(video, 'paused', { value: false, configurable: true });
    };

    it('re-holds for 6s when the main lag collapses after a stall pullback', async () => {
      render(<Harness sync={mainSync()} />);
      const hls = await getHls();
      const video = screen.getByTestId('video') as HTMLMediaElement;
      await finishStartupHold(video);
      expect(playSpy).toHaveBeenCalledTimes(1);
      pauseSpy.mockClear();

      await act(async () => { await vi.advanceTimersByTimeAsync(61_000); }); // 过冷却
      act(() => { hls.emit(hlsMock.MockHls.Events.FRAG_CHANGED, fragAt(5, video)); });
      expect(pauseSpy).toHaveBeenCalled(); // 重新按停
      expect(screen.getByTestId('starting')).toHaveTextContent('starting');

      await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
      expect(playSpy).toHaveBeenCalledTimes(2); // 攒满 6 秒重新放行
      expect(screen.getByTestId('starting')).toHaveTextContent('idle');
    });

    it('respects the cooldown so a rough CDN cannot freeze the view more than once a minute', async () => {
      render(<Harness sync={mainSync()} />);
      const hls = await getHls();
      const video = screen.getByTestId('video') as HTMLMediaElement;
      await finishStartupHold(video);
      pauseSpy.mockClear();

      // release 刚过 30s：还在冷却窗内，哪怕 lag 已经塌了也不动
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      act(() => { hls.emit(hlsMock.MockHls.Events.FRAG_CHANGED, fragAt(5, video)); });
      expect(pauseSpy).not.toHaveBeenCalled();
    });

    it('leaves a healthy main stream alone', async () => {
      render(<Harness sync={mainSync()} />);
      const hls = await getHls();
      const video = screen.getByTestId('video') as HTMLMediaElement;
      await finishStartupHold(video);
      pauseSpy.mockClear();

      await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
      act(() => { hls.emit(hlsMock.MockHls.Events.FRAG_CHANGED, fragAt(13.5, video)); });
      expect(pauseSpy).not.toHaveBeenCalled();
    });

    it('never re-holds a paused main view — its lag reading grows meaninglessly while paused', async () => {
      render(<Harness sync={mainSync()} />);
      const hls = await getHls();
      const video = screen.getByTestId('video') as HTMLMediaElement;
      // 不调 finishStartupHold：保持 jsdom 默认 paused=true 模拟暂停中
      act(() => { video.dispatchEvent(new Event('canplay')); });
      await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
      pauseSpy.mockClear();

      await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
      act(() => { hls.emit(hlsMock.MockHls.Events.FRAG_CHANGED, fragAt(5, video)); });
      expect(pauseSpy).not.toHaveBeenCalled();
    });

    it('never re-holds a side stream regardless of its lag', async () => {
      const engine = new SyncEngine();
      render(<Harness sync={{ engine, id: 'side', isMain: false, tier: '540p' }} />);
      const hls = await getHls();
      const video = screen.getByTestId('video') as HTMLMediaElement;
      Object.defineProperty(video, 'paused', { value: false, configurable: true });
      pauseSpy.mockClear();

      await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
      act(() => { hls.emit(hlsMock.MockHls.Events.FRAG_CHANGED, fragAt(3, video)); });
      expect(pauseSpy).not.toHaveBeenCalled();
    });
  });

  it('drops the pending hold on unmount instead of poking a detached element', async () => {
    const { unmount } = render(<Harness sync={mainSync()} />);
    await getHls();
    const video = screen.getByTestId('video');

    act(() => { video.dispatchEvent(new Event('canplay')); });
    unmount();
    playSpy.mockClear();
    pauseSpy.mockClear();

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(playSpy).not.toHaveBeenCalled();

    // 监听也得摘干净，否则卸载后的 canplay 还会打在这个元素上
    act(() => { video.dispatchEvent(new Event('canplay')); });
    expect(pauseSpy).not.toHaveBeenCalled();
  });

  it('flags starting for exactly the extra 6s so the black screen has a caption', async () => {
    render(<Harness sync={mainSync()} />);
    await getHls();
    const video = screen.getByTestId('video');

    // 实例创建到首帧之间本就是普通加载态（侧路也有），「准备中…」不该抢先盖上去
    expect(screen.getByTestId('starting')).toHaveTextContent('idle');

    act(() => { video.dispatchEvent(new Event('canplay')); });
    expect(screen.getByTestId('starting')).toHaveTextContent('starting');
    expect(screen.getByTestId('state')).toHaveTextContent('ok');

    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(screen.getByTestId('starting')).toHaveTextContent('idle');
    expect(playSpy).toHaveBeenCalled();
  });
});
