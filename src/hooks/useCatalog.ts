import { useEffect, useMemo, useState } from 'react';
import type { ZoneCatalog } from '../types';
import { fetchCatalog, NoLiveZoneError } from '../data/catalog';
import { singleFlight } from '../singleFlight';

export type CatalogState =
  | { status: 'loading' }
  | { status: 'live'; catalog: ZoneCatalog }
  | { status: 'ended' }
  | { status: 'error'; message: string };

type Fetcher = () => Promise<ZoneCatalog>;

export function useCatalog(fetcher: Fetcher = fetchCatalog) {
  const [state, setState] = useState<CatalogState>({ status: 'loading' });

  // 签名过期重取：单飞，N 路 tile 同时过期只 fetch 一次。
  // 成功 → 换新签名(live)；无直播赛区 → ended(终态)；其它(网络抖动) → 保持当前 live，
  // 不把已在播的页面打成 error，tile 继续占位等待。
  const refresh = useMemo(
    () =>
      singleFlight(async () => {
        try {
          setState({ status: 'live', catalog: await fetcher() });
        } catch (e) {
          if (e instanceof NoLiveZoneError) setState({ status: 'ended' });
        }
      }),
    [fetcher],
  );

  // 初次加载：与 refresh 不同，初次失败需区分 ended / error 整屏终态。
  useEffect(() => {
    let alive = true;
    fetcher()
      .then((c) => { if (alive) setState({ status: 'live', catalog: c }); })
      .catch((e) => {
        if (!alive) return;
        setState(e instanceof NoLiveZoneError ? { status: 'ended' } : { status: 'error', message: String(e) });
      });
    return () => { alive = false; };
  }, [fetcher]);

  return { state, refresh };
}
