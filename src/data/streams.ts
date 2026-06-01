import type { StreamView } from '../types';
import type { QualityLabel } from '../config';

export function srcForQuality(view: StreamView, quality: QualityLabel): string | undefined {
  return (view.sources.find((s) => s.label === quality) ?? view.sources[0])?.src;
}

// hls.js fatal NETWORK_ERROR carries the HTTP status of the failed manifest/segment
// load. 401/403 ⇒ the URL's auth_key has expired ⇒ caller must re-fetch a fresh
// signed catalog. Anything else is a transient blip → retry the same URL in place.
export function isSignatureExpiry(httpStatus: number | undefined): boolean {
  return httpStatus === 401 || httpStatus === 403;
}
