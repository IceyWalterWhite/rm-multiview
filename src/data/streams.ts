import type { StreamView, QualitySource } from '../types';
import type { QualityLabel } from '../config';

// 返回整个源：调用方需要真实档位 label（缺档回退时 label ≠ 请求的 quality，
// 时码同步的 tier 常量必须按实际播放的源计）
export function sourceForQuality(view: StreamView, quality: QualityLabel): QualitySource | undefined {
  return view.sources.find((s) => s.label === quality) ?? view.sources[0];
}

export function srcForQuality(view: StreamView, quality: QualityLabel): string | undefined {
  return sourceForQuality(view, quality)?.src;
}

// hls.js fatal NETWORK_ERROR carries the HTTP status of the failed manifest/segment
// load. 401/403 ⇒ the URL's auth_key has expired ⇒ caller must re-fetch a fresh
// signed catalog. Anything else is a transient blip → retry the same URL in place.
export function isSignatureExpiry(httpStatus: number | undefined): boolean {
  return httpStatus === 401 || httpStatus === 403;
}
