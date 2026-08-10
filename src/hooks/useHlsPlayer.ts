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

// 主视角起播前的空等时长。上面的 liveSyncDuration:12 只有侧路吃得下：hls.js 会把它截到 playlist
// 总时长（dist/hls.js:33761 `min = edge − totalduration`），主视角 3 片×2s=6s 当场被砍成 6，
// 侧路 3 片×5s=15s 毫发无伤——配置层先天就差 6 秒，这段等待补的正是这个差额。
// 只能停着等：CDN 只留 6 秒历史，往回 seek 没货；「播着等」同样没用，播放位置与直播边缘同速前进，
// 两者距离恒定，播多久都不会更落后。等满后主视角落后边缘 ~13.5s，侧路目标随之为 13.5 − 4.5 ≈ 9s，
// 大于 5s 的分片周期，存货才经得起同步往前推。
// 2026-08-06 现网三组对照：不等时侧路卡顿 64.5 次/分、全程 1.04 倍速且误差永不收敛（主视角 0 次），
// 把主视角基准后移 4.5s 后降到 9.3 次/分、误差 0~0.1。同日实测主视角暂停 6 秒期间 currentTime
// 漂移 0.0000（60 次采样）、readyState 全程 4、hls.js 零位置调整告警——buffer 满时
// synchronizeToLiveEdge 的 `!withinSlidingWindow && readyState < 4` 不成立，不会被拉回边缘。
const STARTUP_DELAY_MS = 6_000;

// 空等攒出的落后量不是永久的（2026-08-07 实测两次）：一旦发生 BUFFER_STALL，hls.js 的
// synchronizeToLiveEdge 会把主视角整段拉回贴边（13.4→7.9、12→5.8），而 1080p 的 CDN 滑窗
// 只有 6 秒，被拉回后旧内容已不存在，「播着追」物理上不可能——唯一的回法是再停 6 秒重新攒。
// 于是把起播空等升级成运行时自愈：FRAG_CHANGED 上探测主视角落后量，低于安全线就重新 hold。
// 安全线 10s：正常态 ~13.5s（裕量 3.5s 吃得下名字钟 1s 分辨率的抖动），回拉后 ~6-8s 必触发；
// 侧路要安全需要 lag_main − offset(~4) ≥ 7，即 lag_main ≥ 11，10 是它的下沿。
// 冷却 60s 防振荡：CDN 持续糟糕反复 stall 时，最坏也只每分钟冻一次。
const REHOLD_BELOW_LAG = 10;
const REHOLD_COOLDOWN_MS = 60_000;

// 回拉的对因治疗：主视角在 lag≈13.5s 的体位下，播放位置永远在自己 6 秒 CDN 滑窗之外，
// hls.js 视之为异常态——readyState 掉到 4 以下的任何瞬间，synchronizeToLiveEdge 都会把
// 位置整段没收回贴边（2026-08-07 实测 13.4→7.9，下午高码率场次里发生得「挺平常」）。
// 全局 maxBufferLength:8 意味着任何超过 8 秒的供片抖动都会击穿 readyState。主视角单独
// 加厚：30s 上限让 hls.js 把到 edge 为止的全部已发布片都囤下（实际可攒 ~13.5s 存货），
// 抖动容忍从 8s 升到 13s+，回拉失去触发条件，自愈 hold 退居断网级兜底。
// 代价只有主视角一路的内存（1080p 多囤几秒，约 +15~25MB）；带宽零增量——片总量不变，
// 只是提前下载。侧路不加：它们的痛点是「跳不回去」而非「被拉走」，白囤 10 路×20MB。
const MAIN_BUFFER_CONFIG = { maxBufferLength: 30, maxMaxBufferLength: 40 };

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
  // 空等那 6 秒主视角是纯黑屏，不给话说就跟播挂了没区别
  const [starting, setStarting] = useState(false);
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
    setStarting(false);

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
            ...(sync.isMain ? MAIN_BUFFER_CONFIG : null),
            fLoader: makeTeeLoader(
              Hls.DefaultConfig.loader as never,
              (url, data) => sync.engine.pushBytes(sync.id, data, url),
            ) as never,
          }
        : HLS_CONFIG;
      const hls = new Hls(config);

      // 判据是 sync.isMain 而不是「本路还没起播过」：每 new 一个 Hls 实例都必然重新落在 edge−6，
      // 不重等就前功尽弃；而普通断线自愈走的是 hls.startLoad() 原地恢复，根本不经过这段代码，
      // 所以不会有「每次重连都黑 6 秒」。（顺带：此处写 !hasStartedRef.current 等于没写——
      // effect 开头就把它清成 false，异步分支跑到这里时它恒为 true。）
      // 侧路一个都不许跟着延迟：它们本就起播在 edge−12，再退 6 秒同步就得往前推 9 秒，
      // 而 maxBufferLength:8 让它们压根跳不回来。
      let holding = sync?.isMain === true;
      let holdTimer: ReturnType<typeof setTimeout> | null = null;
      // 自愈 hold 的冷却锚点。初值 0 = 起播那次 hold 之前不受冷却约束（本来也轮不到自愈触发）
      let lastReleaseAt = 0;
      const clearHoldTimer = () => {
        if (holdTimer === null) return;
        clearTimeout(holdTimer);
        holdTimer = null;
      };
      const releaseHold = () => {
        holding = false;
        lastReleaseAt = Date.now();
        clearHoldTimer();
        setStarting(false);
        if (!isPageHidden() || keepAliveWhenHidden || !hasStartedRef.current) playVideo(video);
      };
      // canplay 与 play 谁先到算谁。只认 play 不保险：主视角的 muted 由外部传入，未静音时
      // 浏览器的自动播放策略可能直接拒绝，play 事件永不触发，定时器就永远起不来。
      // canplay（首帧可播）不看自动播放许可，是「本该开播的那一刻」的可靠代理。
      const onHoldTick = () => {
        if (!holding) return;
        video.pause(); // 计时期间 autoPlay / MSE 每次偷跑都在这里被按回去
        if (holdTimer !== null) return;
        setStarting(true);
        holdTimer = setTimeout(() => {
          holdTimer = null;
          releaseHold();
        }, STARTUP_DELAY_MS);
      };
      if (holding) {
        // 必须赶在 attachMedia 之前挂上：VideoPlayer 的 <video autoPlay> 会在数据就绪时自作主张开播，
        // 光「不主动调 play()」拦不住它，晚一步注册就可能被抢跑。
        video.addEventListener('canplay', onHoldTick);
        video.addEventListener('play', onHoldTick);
      }

      hls.loadSource(src);
      hls.attachMedia(video);

      let unregisterSync: (() => void) | null = null;
      if (sync) {
        unregisterSync = sync.engine.register(sync.id, { video, isMain: sync.isMain, tier: sync.tier });
        hls.on(Hls.Events.FRAG_CHANGED, (_e, data) => {
          const frag = (data as { frag?: { url?: string; start?: number } }).frag;
          if (!frag?.url || typeof frag.start !== 'number') return;
          const name = parseFragName(frag.url);
          if (!name) return;
          sync.engine.onFrag(sync.id, { wallSec: name.wallSec, fragStart: frag.start });
          // 运行时自愈：stall 后被 synchronizeToLiveEdge 拉回贴边的主视角，落后量在这里
          // 被逮住并重新攒起。单样本名字钟（±1s）够用——阈值离正常态有 3.5s 裕量，
          // 且 1080p 每 2s 就有下一发样本纠错，误触还有 60s 冷却兜底。
          // 主视角暂停中（页面隐藏等）不触发：lag 读数会随暂停无限增长，无意义。
          if (
            sync.isMain &&
            !holding &&
            !video.paused &&
            Date.now() - lastReleaseAt > REHOLD_COOLDOWN_MS &&
            Date.now() / 1000 - (name.wallSec - frag.start + video.currentTime) < REHOLD_BELOW_LAG
          ) {
            holding = true;
            onHoldTick(); // 直接踢：video 已在播，不会再有 canplay 来代劳
          }
        });
      }
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (holding) return; // 计时未满就开播 = 白等，落后量当场缩回 6 秒
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
        holding = false;
        clearHoldTimer();
        video.removeEventListener('canplay', onHoldTick);
        video.removeEventListener('play', onHoldTick);
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

  // starting 只由 hls.js 分支的主视角空等置起；原生兜底路径与不带 sync 的场景恒为 false
  return { error, starting };
}
