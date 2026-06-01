import { useEffect, useState } from 'react';
import type { MatchTitle } from '../types';
import { fetchMatchTitle } from '../data/match';

const POLL_MS = 20000;

type Fetcher = (zoneName: string) => Promise<MatchTitle | null>;

/**
 * 拉取并轮询当前赛区赛事标题。成功（含 null=无比赛）即更新；
 * 网络出错则保留上次好值，避免比赛间隙闪烁。切赛区时先清空。
 * @param fetcher 须为稳定引用（模块级函数或 useMemo/useCallback）；传内联函数会导致每次渲染重启轮询。
 */
export function useMatchTitle(
  zoneName: string,
  fetcher: Fetcher = fetchMatchTitle,
  pollMs: number = POLL_MS,
): MatchTitle | null {
  const [title, setTitle] = useState<MatchTitle | null>(null);

  useEffect(() => {
    let alive = true;
    setTitle(null); // 切赛区先清空，避免串味（稳态下本 effect 只在挂载时跑一次）
    const tick = async () => {
      try {
        const t = await fetcher(zoneName);
        if (alive) setTitle(t); // 成功：有值则用，null 则回兜底
      } catch {
        /* 网络错误：保留上次好值 */
      }
    };
    tick();
    const id = setInterval(tick, pollMs);
    return () => { alive = false; clearInterval(id); };
  }, [zoneName, fetcher, pollMs]);

  return title;
}
