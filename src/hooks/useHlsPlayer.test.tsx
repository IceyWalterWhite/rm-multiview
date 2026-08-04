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
