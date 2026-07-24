import { useEffect, useRef, useState } from 'react';
import { isSignatureExpiry } from '../data/streams';

// 11 路同播：收紧缓冲，降低内存/解码压力；主视角可后台保活，侧视角首帧后由 hidden 逻辑接管。
const HLS_CONFIG = {
  lowLatencyMode: false,
  backBufferLength: 10,
  maxBufferLength: 8,
  maxMaxBufferLength: 20,
  liveSyncDurationCount: 3,
  capLevelToPlayerSize: true, // 若源是多码率 master playlist，小窗不拉满高码率
};

function isPageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function playVideo(video: HTMLVideoElement): void {
  video.play().catch(() => {});
}

interface HlsPlayerOptions {
  keepAliveWhenHidden?: boolean;
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

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    hasStartedRef.current = false;
    setError(false);

    // Safari 原生 HLS（拿不到 HTTP 状态码，错误只能粗粒度处理）
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      playVideo(video);
      const onVisibilityChange = () => {
        if (isPageHidden()) {
          if (keepAliveWhenHidden) {
            playVideo(video);
            return;
          }
          if (!hasStartedRef.current) return;
          setError(false);
          video.pause();
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
        onExpiredRef.current?.();
      }; // 多为签名过期 → 重取
      const onPlaying = () => {
        hasStartedRef.current = true;
        setError(false);
      };
      document.addEventListener('visibilitychange', onVisibilityChange);
      video.addEventListener('error', onErr);
      video.addEventListener('playing', onPlaying);
      return () => {
        document.removeEventListener('visibilitychange', onVisibilityChange);
        video.removeEventListener('error', onErr);
        video.removeEventListener('playing', onPlaying);
        video.removeAttribute('src'); video.load();
      };
    }

    // hls.js（约 530KB）按需动态加载：不进首包，Safari（上面已 return）永不下载。
    // effect 清理可能发生在加载完成前：用 cancelled 标志 + teardown 槽处理竞态。
    let cancelled = false;
    let teardown: (() => void) | null = null;
    void (async () => {
      const { default: Hls } = await import('hls.js');
      if (cancelled || !Hls.isSupported()) return;
      const hls = new Hls(HLS_CONFIG);
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (!isPageHidden() || keepAliveWhenHidden || !hasStartedRef.current) playVideo(video);
      });

      // 恢复成功（分片入缓冲 / 视频在播）→ 清掉「信号中断·重连中」占位。
      // 关键：直播靠 startLoad 恢复时不会再触发 MANIFEST_PARSED，必须用这俩信号清占位，否则会卡住。
      const onRecovered = () => {
        hasStartedRef.current = true;
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
          if (isSignatureExpiry(data.response?.code)) onExpiredRef.current?.();
          else hls.startLoad();
        } else {
          hls.recoverMediaError();
        }
      });

      teardown = () => {
        document.removeEventListener('visibilitychange', onVisibilityChange);
        video.removeEventListener('playing', onRecovered);
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
