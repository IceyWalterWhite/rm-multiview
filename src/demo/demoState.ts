/** @deprecated The full fake-live demo no longer has display states. */
export type DemoState = 'live' | 'offline' | 'loading' | 'error';

/** @deprecated Retained only for legacy full-demo URLs and future redesign work. */
// "?demo" / "?demo=1" 等未知取值一律当 live（最常用的预览目标）。
export function resolveDemoState(value: string): DemoState {
  return value === 'offline' || value === 'loading' || value === 'error' ? value : 'live';
}
