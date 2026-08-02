// hls.js 自定义 fragment loader：把播放器正在下载的分片字节 tee 一份给校准器。
// 零额外带宽——素材是播放的副产品。fLoader 只用于 fragment 请求（playlist 走 pLoader），
// 所以这里到达的 data 一定是 TS 分片字节。
type LoaderCallbacks = {
  onSuccess: (response: { data: ArrayBuffer }, stats: unknown, context: unknown, network?: unknown) => void;
} & Record<string, unknown>;

interface LoaderLike {
  load(context: unknown, config: unknown, callbacks: LoaderCallbacks): void;
  destroy?(): void;
}

type LoaderCtor = new (config: unknown) => LoaderLike;

export function makeTeeLoader(Base: LoaderCtor, onBytes: (url: string, data: ArrayBuffer) => void): LoaderCtor {
  return class TeeLoader extends Base {
    load(context: unknown, config: unknown, callbacks: LoaderCallbacks): void {
      const url = (context as { url?: unknown }).url;
      const orig = callbacks.onSuccess;
      const wrapped: LoaderCallbacks = {
        ...callbacks,
        onSuccess: (response, stats, ctx, network) => {
          if (typeof url === 'string' && response?.data instanceof ArrayBuffer) {
            try {
              onBytes(url, response.data);
            } catch {
              // tee 失败绝不影响播放链路
            }
          }
          orig(response, stats, ctx, network);
        },
      };
      super.load(context, config, wrapped);
    }
  };
}
