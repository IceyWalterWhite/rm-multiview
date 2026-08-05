import type { WatchProgress, WatchTier } from '../types';
import { RM_LOGIN_OAUTH_URL, WATCH_PROGRESS_URL } from '../config';
import { postSaas, toNum } from './saas';

interface TierPayload {
  tier?: unknown;
  thresholdSeconds?: unknown;
  amount?: unknown;
  granted?: unknown;
}
interface ProgressPayload {
  accumulatedSeconds?: unknown;
  tiers?: unknown;
}

/**
 * 归一化观看进度，口径照抄官方：按 tier 升序累加 amount，得到"到该档为止的累计弹丸数"。
 * 接口只给每档的增量(amount)，累计值是客户端算的——这里改口径会和官网页面对不上。
 * 线上实测的三档：420s/500、600s/1000、1800s/3000 → 7/10/30 分钟，累计 500/1500/4500。
 */
export function normalizeWatchProgress(data: unknown): WatchProgress {
  const d = (data ?? {}) as ProgressPayload;
  const raw: TierPayload[] = Array.isArray(d.tiers) ? (d.tiers as TierPayload[]) : [];
  const sorted = [...raw].sort((a, b) => toNum(a?.tier) - toNum(b?.tier));

  let running = 0;
  const tiers: WatchTier[] = sorted.map((t) => {
    const increment = toNum(t?.amount);
    running += increment;
    const seconds = toNum(t?.thresholdSeconds);
    return {
      id: toNum(t?.tier),
      minutes: Math.round(seconds / 60),
      seconds,
      pellets: running,
      increment,
      granted: !!t?.granted,
    };
  });

  // 已到手 = 最后一个 granted 档位的累计值（官方口径；理论上不会跳档发放）
  let earnedPellets = 0;
  for (const t of tiers) if (t.granted) earnedPellets = t.pellets;

  return { accumulatedSeconds: toNum(d.accumulatedSeconds), tiers, earnedPellets };
}

/** 页面未检测到直播助手时的只读兼容路径；脚本就绪后会改走固定 getWatchProgress 动作。 */
export async function fetchWatchProgress(): Promise<WatchProgress> {
  return normalizeWatchProgress(await postSaas(WATCH_PROGRESS_URL, {}));
}

/** DJI SSO 登录入口，登录后回跳 backUrl（通常是当前页 URL） */
export function buildLoginUrl(backUrl: string): string {
  return `${RM_LOGIN_OAUTH_URL}?backurl=${encodeURIComponent(backUrl)}&locale=zh_CN`;
}
