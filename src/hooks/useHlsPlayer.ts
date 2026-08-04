import { useEffect, useRef, useState } from 'react';
import { isSignatureExpiry } from '../data/streams';
import { parseFragName } from '../sync/nameClock';
import { makeTeeLoader } from '../sync/teeLoader';
import type { SyncEngine } from '../sync/engine';

// 11 路同播：收紧缓冲，降低内存/解码压力；主视角可后台保活，侧视角首帧后由 hidden 逻辑接管。
const HLS_CONFIG = {
  lowLatencyMode: false,
  backBufferLength: 10,
  maxBufferLength: 8,
  maxMaxBufferLength: 20,
  // 按「秒」统一各路直播边缘距离。此前按分片个数（liveSyncDurationCount:3）：
  // 1080p 2s 片停在边缘后 ~6s、540p 5s 片停在 ~15s，光配置就错开 ~10s（时码同步的最大误差源）
  liveSyncDuration: 12,
  capLevelToPlayerSize: true, // 若源是多码率 master playlist，小窗不拉满高码率
};

/** 时码同步注册信息：engine 引用稳定，随 hls 生命周期注册/注销 */
export interface SyncBinding {
  engine: SyncEngine;
  id: string;
  isMain: boolean;
  tier: string;
}

function isPageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function playVideo(video: HTMLVideoElement): void {
  video.play().catch(() => {});
}

// 原生兜底路径的重连节奏。11 路会因同一次网络抖动/窗口重排一起失败，
// 若同时重启就是一次自制的惊群——本机实测可用带宽仅够喂饱约 4 路，
// 齐刷刷 11 个并发请求只会让刚恢复的流再次饿死。故退避必须带抖动。
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export function reconnectDelayMs(attempt: number, rand: () => number = Math.random): number {
  const backoff = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt);
  // 全抖动（AWS full jitter）：11 路把重启散布到 [0, backoff) 而非挤在同一刻
  return Math.round(backoff * rand());
}

interface HlsPlayerOptions {
  keepAliveWhenHidden?: boolean;
  sync?: SyncBinding;
}

export function useHlsPlayer(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  src: string | undefined,
  onSignatureExpired?: () => void,
  options: HlsPlayerOptions = {},
) {
  const keepAliveWhenHidden = options.keepAliveWhenHidden ?? false;
  const [error, setError] = useState(false);
  const hasStartedRef = useRef(false);
  // 最新回调放 ref，避免把 onSignatureExpired 放进 effect 依赖（否则父级每次渲染都重建 11 路 hls）
  const onExpiredRef = useRef(onSignatureExpired);
  useEffect(() => { onExpiredRef.current = onSignatureExpired; }, [onSignatureExpired]);
  // sync 对象每次渲染都是新字面量：同 ref 模式挡在 effect 依赖之外；
  // 注册发生在 hls 创建时（id/tier 变化必然伴随 src 变化 → effect 本就重跑）
  const syncRef = useRef(options.sync);
  useEffect(() => { syncRef.current = options.sync; }, [options.sync]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    hasStartedRef.current = false;
    setError(false);

    // 原生 HLS 兜底（拿不到 HTTP 状态码，错误只能粗粒度处理；时码同步在此路径不可用）
    const setupNative = (): (() => void) => {
      video.src = src;
      playVideo(video);

      // 断线自愈：原生 <video> 没有 hls.js 那样的重连状态机。error 之后 networkState
      // 落到 NETWORK_NO_SOURCE 即资源选择算法的终态，浏览器永不自行重试——只有 load()
      // 能重启它。2026-08-04 现网实测：卡死那一路 src 一字未改，仅 load() 即恢复推进。
      let retryTimer: ReturnType<typeof setTimeout> | null = null;
      let attempt = 0;
      const clearRetry = () => {
        if (retryTimer === null) return;
        clearTimeout(retryTimer);
        retryTimer = null;
      };
      const scheduleReconnect = () => {
        if (retryTimer !== null) return; // 已排队；重复的 error 不该叠成紧循环
        retryTimer = setTimeout(() => {
          retryTimer = null;
          if (isPageHidden() && !keepAliveWhenHidden) return; // 后台不抢带宽，回前台再救
          video.load();
          playVideo(video);
        }, reconnectDelayMs(attempt++));
      };

      const onVisibilityChange = () => {
        if (isPageHidden()) {
          if (keepAliveWhenHidden) {
            playVideo(video);
            return;
          }
          if (!hasStartedRef.current) return;
          setError(false);
          clearRetry();
          video.pause();
          return;
        }
        // 回到前台且这一路是坏的：立刻救，不必等退避——用户正盯着它
        if (video.error) {
          clearRetry();
          attempt = 0;
          video.load();
          playVideo(video);
          return;
        }
        setError(false);
        if (!keepAliveWhenHidden && hasStartedRef.current) video.load();
        playVideo(video);
      };
      const onErr = () => {
        if (isPageHidden() && !keepAliveWhenHidden && hasStartedRef.current) {
          setError(false);
          return;
        }
        setError(true);
        // 原生路径读不到 HTTP 状态码，分不清「签名过期」还是「网络抖动」，两条路一起走：
        // 换签名（真过期的话新 src 会重建本 effect），同时自己重启兜底——
        // 后者不可省：refresh 有 15s 冷却窗，且签名没过期时拿回的 src 一模一样，
        // effect 依赖不变便不会重跑，没人 load() 这一路就永远停在「重连中…」。
        onExpiredRef.current?.();
        scheduleReconnect();
      };
      const onPlaying = () => {
        hasStartedRef.current = true;
        attempt = 0; // 真的恢复了，退避归零
        setError(false);
      };
      document.addEventListener('visibilitychange', onVisibilityChange);
      video.addEventListener('error', onErr);
      video.addEventListener('playing', onPlaying);
      return () => {
        clearRetry();
        document.removeEventListener('visibilitychange', onVisibilityChange);
        video.removeEventListener('error', onErr);
        video.removeEventListener('playing', onPlaying);
        video.removeAttribute('src'); video.load();
      };
    };

    // 分支顺序是生产级约束：Chrome 150 起桌面 Chromium 的 canPlayType 对 HLS 也报 'maybe'
    // （''|'maybe'|'probably' 里 'maybe' 同样 truthy），「原生优先」会让 hls.js 的缓冲配置、
    // 错误分类与时码同步在现代 Chrome 上整体旁路。故 MSE 可用一律走 hls.js，原生只兜底无 MSE
    // 的环境；ManagedMediaSource（iOS 17.1+）计入 MSE —— hls.js 支持它，新 iOS 也拿到完整能力。
    const mseAvailable =
      typeof MediaSource !== 'undefined' ||
      typeof (globalThis as { ManagedMediaSource?: unknown }).ManagedMediaSource !== 'undefined';
    if (!mseAvailable && video.canPlayType('application/vnd.apple.mpegurl')) {
      return setupNative();
    }

    // hls.js（约 530KB）按需动态加载：不进首包，无 MSE 的环境（上面已 return）永不下载。
    // effect 清理可能发生在加载完成前：用 cancelled 标志 + teardown 槽处理竞态。
    let cancelled = false;
    let teardown: (() => void) | null = null;
    void (async () => {
      const { default: Hls } = await import('hls.js');
      if (cancelled) return;
      if (!Hls.isSupported()) {
        // MSE 存在但 hls.js 判定不可用的边缘环境：还有原生能力就退回原生
        if (video.canPlayType('application/vnd.apple.mpegurl')) teardown = setupNative();
        return;
      }
      // 时码同步：注册本路并从 FRAG_CHANGED 持续喂名字钟样本（分片名 = {unix秒}_{seq}.ts）；
      // fLoader tee 把播放器正在下载的分片字节转给校准器（零额外带宽）
      const sync = syncRef.current;
      const config = sync
        ? {
            ...HLS_CONFIG,
            fLoader: makeTeeLoader(
              Hls.DefaultConfig.loader as never,
              (url, data) => sync.engine.pushBytes(sync.id, data, url),
            ) as never,
          }
        : HLS_CONFIG;
      const hls = new Hls(config);
      hls.loadSource(src);
      hls.attachMedia(video);

      let unregisterSync: (() => void) | null = null;
      if (sync) {
        unregisterSync = sync.engine.register(sync.id, { video, isMain: sync.isMain, tier: sync.tier });
        hls.on(Hls.Events.FRAG_CHANGED, (_e, data) => {
          const frag = (data as { frag?: { url?: string; start?: number } }).frag;
          if (!frag?.url || typeof frag.start !== 'number') return;
          const name = parseFragName(frag.url);
          if (name) sync.engine.onFrag(sync.id, { wallSec: name.wallSec, fragStart: frag.start });
        });
      }
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (!isPageHidden() || keepAliveWhenHidden || !hasStartedRef.current) playVideo(video);
      });

      // 换签名未必成行：refresh 有 15s 冷却窗，且签名没真过期时拿回的 src 一模一样，
      // effect 依赖不变就不会重建这条流。而 fatal 之后 hls.js 已停止加载，
      // 不自己拉一把就会永远停在「重连中…」——与原生路径同款死锁，同样要留自救路。
      let expiryTimer: ReturnType<typeof setTimeout> | null = null;
      let expiryAttempt = 0;
      const clearExpiryRetry = () => {
        if (expiryTimer === null) return;
        clearTimeout(expiryTimer);
        expiryTimer = null;
      };
      const scheduleExpiryFallback = () => {
        if (expiryTimer !== null) return;
        expiryTimer = setTimeout(() => {
          expiryTimer = null;
          if (isPageHidden() && !keepAliveWhenHidden) return;
          hls.startLoad();
          playVideo(video);
        }, reconnectDelayMs(expiryAttempt++));
      };

      // 恢复成功（分片入缓冲 / 视频在播）→ 清掉「信号中断·重连中」占位。
      // 关键：直播靠 startLoad 恢复时不会再触发 MANIFEST_PARSED，必须用这俩信号清占位，否则会卡住。
      const onRecovered = () => {
        hasStartedRef.current = true;
        expiryAttempt = 0;
        clearExpiryRetry();
        setError(false);
      };
      hls.on(Hls.Events.FRAG_BUFFERED, onRecovered);
      video.addEventListener('playing', onRecovered);

      const resume = () => {
        setError(false);
        if (video.error) hls.recoverMediaError();
        hls.startLoad(-1);
        playVideo(video);
      };

      const onVisibilityChange = () => {
        if (isPageHidden()) {
          if (keepAliveWhenHidden) {
            playVideo(video);
            return;
          }
          if (!hasStartedRef.current) return;
          setError(false);
          video.pause();
          hls.stopLoad();
          return;
        }
        if (keepAliveWhenHidden) {
          setError(false);
          playVideo(video);
        } else if (!hasStartedRef.current) {
          playVideo(video);
        } else {
          resume();
        }
      };
      document.addEventListener('visibilitychange', onVisibilityChange);
      if (isPageHidden() && !keepAliveWhenHidden && hasStartedRef.current) {
        video.pause();
        hls.stopLoad();
      }

      // 重连：网络错误持续 startLoad 重试（hls.js 内部带退避），直到流恢复；
      // 403/401 = 签名过期 → 重取新鲜签名换源重建；媒体/其它致命错误 → recoverMediaError。
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (isPageHidden() && !keepAliveWhenHidden && hasStartedRef.current) {
          setError(false);
          hls.stopLoad();
          return;
        }
        setError(true);
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          if (isSignatureExpiry(data.response?.code)) {
            onExpiredRef.current?.();
            scheduleExpiryFallback(); // 换签名没来 / src 没变时的自救
          } else hls.startLoad();
        } else {
          hls.recoverMediaError();
        }
      });

      teardown = () => {
        clearExpiryRetry();
        document.removeEventListener('visibilitychange', onVisibilityChange);
        video.removeEventListener('playing', onRecovered);
        unregisterSync?.();
        hls.destroy();
      };
    })();

    return () => {
      cancelled = true;
      teardown?.();
      teardown = null;
    };
  }, [videoRef, src, keepAliveWhenHidden]); // src 变化（换清晰度 / 换签名）→ 重建

  return { error };
}
