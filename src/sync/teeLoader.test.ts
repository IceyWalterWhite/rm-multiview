import { describe, it, expect, vi } from 'vitest';
import { makeTeeLoader } from './teeLoader';

// 模拟 hls.js 的 loader 基类与回调协议
interface FakeCallbacks {
  onSuccess: (response: { data: ArrayBuffer }, stats: unknown, context: unknown, network?: unknown) => void;
}

class FakeBase {
  static loads: { context: unknown; callbacks: FakeCallbacks }[] = [];
  load(context: unknown, _config: unknown, callbacks: FakeCallbacks) {
    FakeBase.loads.push({ context, callbacks });
  }
  destroy() {}
}

describe('makeTeeLoader', () => {
  it('tees fragment bytes to the sink and still forwards to the original callback', () => {
    FakeBase.loads.length = 0;
    const onBytes = vi.fn();
    const Tee = makeTeeLoader(FakeBase as never, onBytes);
    const loader = new Tee({});

    const orig = vi.fn();
    const ctx = { url: 'https://x/a/1785593205_1.ts?k=1', frag: {} };
    loader.load(ctx, {}, { onSuccess: orig });

    const buf = new ArrayBuffer(8);
    FakeBase.loads[0].callbacks.onSuccess({ data: buf }, { total: 8 }, ctx);

    expect(onBytes).toHaveBeenCalledWith('https://x/a/1785593205_1.ts?k=1', buf);
    expect(orig).toHaveBeenCalledOnce();
  });

  it('does not break the load chain when the sink throws', () => {
    FakeBase.loads.length = 0;
    const Tee = makeTeeLoader(FakeBase as never, () => {
      throw new Error('sink boom');
    });
    const loader = new Tee({});
    const orig = vi.fn();
    const ctx = { url: 'https://x/a/1785593205_1.ts', frag: {} };
    loader.load(ctx, {}, { onSuccess: orig });
    FakeBase.loads[0].callbacks.onSuccess({ data: new ArrayBuffer(1) }, {}, ctx);
    expect(orig).toHaveBeenCalledOnce();
  });
});
