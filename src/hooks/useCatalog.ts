import { useCallback, useEffect, useRef, useState } from 'react';
import type { ZoneCatalog } from '../types';
import { fetchCatalog, NoLiveZoneError } from '../data/catalog';

export type CatalogState =
  | { status: 'loading' }
  | { status: 'live'; catalog: ZoneCatalog }
  | { status: 'ended' }
  | { status: 'error'; message: string };

type Fetcher = () => Promise<ZoneCatalog>;

const REFRESH_RETRY_BASE_MS = 500;
const REFRESH_RETRY_MAX_MS = 10000;
// 无直播不是终态：比赛随时可能开播。ended 态下低频轮询 live_game_info（很小的 JSON），
// 拉到 live 自动切入——挂机等开播的用户不需要手动刷新。
const ENDED_POLL_MS = 60_000;
// 11 路播放器的签名过期事件因轮询相位错开数秒到达：第一次 refresh 已换来新签名，
// 冷却窗内的后续过期回调都是旧事件，再 fetch 只会又一轮全量销毁重建。
const REFRESH_COOLDOWN_MS = 15_000;

function retryDelayMs(attempt: number): number {
  return Math.min(REFRESH_RETRY_MAX_MS, REFRESH_RETRY_BASE_MS * 2 ** attempt);
}

export function useCatalog(fetcher: Fetcher = fetchCatalog) {
  const [state, setState] = useState<CatalogState>({ status: 'loading' });
  const [retryAttempt, setRetryAttempt] = useState<number | null>(null);
  const lastSuccessAtRef = useRef(0);
  const refreshFlightRef = useRef<Promise<void> | null>(null);

  const resetRefreshRetry = useCallback(() => setRetryAttempt(null), []);

  const scheduleRefreshRetry = useCallback(() => {
    setRetryAttempt((cur) => cur ?? 0);
  }, []);

  // 签名过期重取：单飞，N 路 tile 同时过期只 fetch 一次。
  // 成功 → 换新签名(live)；无直播赛区 → ended(终态)；其它(网络抖动) → 保持当前 live，
  // 并退避重试，避免播放器卡在旧的过期签名 URL。
  // 逻辑放 useCallback（回调不在 render 期执行，可碰 ref/Date.now），
  // useMemo 工厂只做纯的 singleFlight 包装，满足 react-hooks/purity。
  const refreshImpl = useCallback(async () => {
    if (Date.now() - lastSuccessAtRef.current < REFRESH_COOLDOWN_MS) return;
    try {
      setState({ status: 'live', catalog: await fetcher() });
      lastSuccessAtRef.current = Date.now();
      resetRefreshRetry();
    } catch (e) {
      if (e instanceof NoLiveZoneError) {
        lastSuccessAtRef.current = Date.now(); // 「确认没直播」也是一次成功响应
        resetRefreshRetry();
        // 保引用：ended→ended 不产生新 state 对象，轮询期间不空转重渲染
        setState((cur) => (cur.status === 'ended' ? cur : { status: 'ended' }));
        return;
      }
      scheduleRefreshRetry(); // 网络错不记成功时间，退避重试不受冷却阻挡
    }
  }, [fetcher, resetRefreshRetry, scheduleRefreshRetry]);
  const refresh = useCallback(() => {
    if (refreshFlightRef.current) return refreshFlightRef.current;
    const flight = refreshImpl().finally(() => {
      if (refreshFlightRef.current === flight) refreshFlightRef.current = null;
    });
    refreshFlightRef.current = flight;
    return flight;
  }, [refreshImpl]);

  useEffect(() => {
    if (retryAttempt === null) return;
    const id = setTimeout(() => {
      void refresh();
      setRetryAttempt((cur) => (cur === null ? null : cur + 1));
    }, retryDelayMs(retryAttempt));
    return () => clearTimeout(id);
  }, [refresh, retryAttempt]);

  // ended 态轮询开播；页面在后台跳过（省流量），回到前台立即补查一次。
  useEffect(() => {
    if (state.status !== 'ended') return;
    const poll = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void refresh();
    };
    const id = setInterval(poll, ENDED_POLL_MS);
    document.addEventListener('visibilitychange', poll);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [state.status, refresh]);

  // 初次加载：与 refresh 不同，初次失败需区分 ended / error 整屏终态。
  useEffect(() => {
    let alive = true;
    fetcher()
      .then((c) => {
        if (!alive) return;
        lastSuccessAtRef.current = Date.now();
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
