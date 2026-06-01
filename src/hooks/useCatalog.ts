import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ZoneCatalog } from '../types';
import { fetchCatalog, NoLiveZoneError } from '../data/catalog';
import { singleFlight } from '../singleFlight';

export type CatalogState =
  | { status: 'loading' }
  | { status: 'live'; catalog: ZoneCatalog }
  | { status: 'ended' }
  | { status: 'error'; message: string };

type Fetcher = () => Promise<ZoneCatalog>;

const REFRESH_RETRY_BASE_MS = 500;
const REFRESH_RETRY_MAX_MS = 10000;

function retryDelayMs(attempt: number): number {
  return Math.min(REFRESH_RETRY_MAX_MS, REFRESH_RETRY_BASE_MS * 2 ** attempt);
}

export function useCatalog(fetcher: Fetcher = fetchCatalog) {
  const [state, setState] = useState<CatalogState>({ status: 'loading' });
  const [retryAttempt, setRetryAttempt] = useState<number | null>(null);

  const resetRefreshRetry = useCallback(() => setRetryAttempt(null), []);

  const scheduleRefreshRetry = useCallback(() => {
    setRetryAttempt((cur) => cur ?? 0);
  }, []);

  // 签名过期重取：单飞，N 路 tile 同时过期只 fetch 一次。
  // 成功 → 换新签名(live)；无直播赛区 → ended(终态)；其它(网络抖动) → 保持当前 live，
  // 并退避重试，避免播放器卡在旧的过期签名 URL。
  const refresh = useMemo(
    () =>
      singleFlight(async () => {
        try {
          setState({ status: 'live', catalog: await fetcher() });
          resetRefreshRetry();
        } catch (e) {
          if (e instanceof NoLiveZoneError) {
            resetRefreshRetry();
            setState({ status: 'ended' });
            return;
          }
          scheduleRefreshRetry();
        }
      }),
    [fetcher, resetRefreshRetry, scheduleRefreshRetry],
  );

  useEffect(() => {
    if (retryAttempt === null) return;
    const id = setTimeout(() => {
      void refresh();
      setRetryAttempt((cur) => (cur === null ? null : cur + 1));
    }, retryDelayMs(retryAttempt));
    return () => clearTimeout(id);
  }, [refresh, retryAttempt]);

  // 初次加载：与 refresh 不同，初次失败需区分 ended / error 整屏终态。
  useEffect(() => {
    let alive = true;
    fetcher()
      .then((c) => {
        if (!alive) return;
        resetRefreshRetry();
        setState({ status: 'live', catalog: c });
      })
      .catch((e) => {
        if (!alive) return;
        setState(e instanceof NoLiveZoneError ? { status: 'ended' } : { status: 'error', message: String(e) });
      });
    return () => { alive = false; resetRefreshRetry(); };
  }, [fetcher, resetRefreshRetry]);

  return { state, refresh };
}
