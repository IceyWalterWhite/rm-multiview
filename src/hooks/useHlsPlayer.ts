import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { isSignatureExpiry } from '../data/streams';

// 11 路同播：收紧缓冲，降低内存/解码压力。后台不暂停——直播持续播放。
const HLS_CONFIG = {
  lowLatencyMode: false,
  backBufferLength: 10,
  maxBufferLength: 8,
  maxMaxBufferLength: 20,
  liveSyncDurationCount: 3,
};

export function useHlsPlayer(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  src: string | undefined,
  onSignatureExpired?: () => void,
) {
  const [error, setError] = useState(false);
  // 最新回调放 ref，避免把 onSignatureExpired 放进 effect 依赖（否则父级每次渲染都重建 11 路 hls）
  const onExpiredRef = useRef(onSignatureExpired);
  useEffect(() => { onExpiredRef.current = onSignatureExpired; }, [onSignatureExpired]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    setError(false);

    // Safari 原生 HLS（拿不到 HTTP 状态码，错误只能粗粒度处理）
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      video.play().catch(() => {});
      const onErr = () => { setError(true); onExpiredRef.current?.(); }; // 多为签名过期 → 重取
      const onPlaying = () => setError(false);
      video.addEventListener('error', onErr);
      video.addEventListener('playing', onPlaying);
      return () => {
        video.removeEventListener('error', onErr);
        video.removeEventListener('playing', onPlaying);
        video.removeAttribute('src'); video.load();
      };
    }

    if (!Hls.isSupported()) return;
    const hls = new Hls(HLS_CONFIG);
    hls.loadSource(src);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));

    // 恢复成功（分片入缓冲 / 视频在播）→ 清掉「信号中断·重连中」占位。
    // 关键：直播靠 startLoad 恢复时不会再触发 MANIFEST_PARSED，必须用这俩信号清占位，否则会卡住。
    const onRecovered = () => setError(false);
    hls.on(Hls.Events.FRAG_BUFFERED, onRecovered);
    video.addEventListener('playing', onRecovered);

    // 重连：网络错误持续 startLoad 重试（hls.js 内部带退避），直到流恢复；
    // 403/401 = 签名过期 → 重取新鲜签名换源重建；媒体/其它致命错误 → recoverMediaError。
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      setError(true);
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        if (isSignatureExpiry(data.response?.code)) onExpiredRef.current?.();
        else hls.startLoad();
      } else {
        hls.recoverMediaError();
      }
    });

    return () => {
      video.removeEventListener('playing', onRecovered);
      hls.destroy();
    };
  }, [videoRef, src]); // src 变化（换清晰度 / 换签名）→ 重建

  return { error };
}
