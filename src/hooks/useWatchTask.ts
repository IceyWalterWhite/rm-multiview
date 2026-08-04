import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WatchProgress, WatchTier, ZoneCatalog } from '../types';
import { buildLoginUrl, fetchWatchProgress, normalizeWatchProgress } from '../data/watchTask';
import { RM_OFFICIAL_LIVE_URL, WATCH_PROGRESS_REFRESH_MIN_MS } from '../config';
import type { OfficialBridgeApi } from './useOfficialBridge';
import type { OfficialBridgeStatus } from '../net/officialBridge';

const NO_TIERS: WatchTier[] = [];

export type HeartbeatStatus = 'idle' | 'running' | 'error' | 'complete';

export interface WatchTaskState {
  loggedIn: boolean;
  accumulatedSeconds: number;
  earnedPellets: number;
  tiers: WatchTier[];
  officialUrl: string;
  loginUrl: string;
  bridgeStatus: OfficialBridgeStatus;
  heartbeatStatus: HeartbeatStatus;
  heartbeatError: string | null;
  retryHeartbeat: () => void;
}

export interface WatchTaskDeps {
  enabled?: boolean;
  fetchProgress?: () => Promise<WatchProgress>;
  backUrl?: string;
  refreshMinMs?: number;
  bridge?: Pick<OfficialBridgeApi, 'status' | 'request'>;
  catalog?: ZoneCatalog | null;
  mainPlaying?: boolean;
  heartbeatMs?: number;
}

const NO_DEPS: WatchTaskDeps = {};

function docVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

function currentHref(): string {
  return typeof window === 'undefined' ? '' : window.location.href;
}

function rewardsComplete(progress: WatchProgress | null): boolean {
  return Boolean(progress && progress.tiers.length > 0 && progress.tiers.every((tier) => tier.granted));
}

function heartbeatPayload(value: unknown): {
  accumulatedSeconds?: number;
  rewarded: boolean;
} {
  if (!value || typeof value !== 'object') return { rewarded: false };
  const data = value as Record<string, unknown>;
  return {
    accumulatedSeconds: typeof data.accumulatedSeconds === 'number' && Number.isFinite(data.accumulatedSeconds)
      ? Math.max(0, data.accumulatedSeconds)
      : undefined,
    rewarded: data.rewarded === true,
  };
}

export function useWatchTask(deps: WatchTaskDeps = NO_DEPS): WatchTaskState {
  const {
    enabled = true,
    fetchProgress = fetchWatchProgress,
    backUrl,
    refreshMinMs = WATCH_PROGRESS_REFRESH_MIN_MS,
    bridge,
    catalog = null,
    mainPlaying = false,
    heartbeatMs = 5_000,
  } = deps;
  const bridgeStatus = bridge?.status ?? 'missing';

  const [progress, setProgress] = useState<WatchProgress | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [visible, setVisible] = useState(docVisible);
  const [visibilityEpoch, setVisibilityEpoch] = useState(0);
  const [heartbeatState, setHeartbeatState] = useState<HeartbeatStatus>('idle');
  const [heartbeatError, setHeartbeatError] = useState<string | null>(null);
  const [halted, setHalted] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [loginUrl] = useState(() => buildLoginUrl(backUrl ?? currentHref()));

  const aliveRef = useRef(true);
  const lastLoadRef = useRef(0);
  const loadSequenceRef = useRef(0);
  const sourceRef = useRef({ fetchProgress, bridge, bridgeStatus });
  useEffect(() => { sourceRef.current = { fetchProgress, bridge, bridgeStatus }; });

  const load = useCallback(async (): Promise<WatchProgress | null> => {
    const sequence = ++loadSequenceRef.current;
    lastLoadRef.current = Date.now();
    try {
      const source = sourceRef.current;
      const next = source.bridgeStatus === 'ready' && source.bridge
        ? normalizeWatchProgress(await source.bridge.request('getWatchProgress', {}))
        : await source.fetchProgress();
      if (aliveRef.current && sequence === loadSequenceRef.current) {
        setProgress(next);
        setLoggedIn(true);
      }
      return next;
    } catch {
      if (aliveRef.current && sequence === loadSequenceRef.current) setLoggedIn(false);
      return null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    aliveRef.current = true;
    const onVisibility = () => {
      const next = docVisible();
      setVisible(next);
      if (next) setVisibilityEpoch((value) => value + 1);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      aliveRef.current = false;
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled]);

  const heartbeatEligible = Boolean(
    enabled
    && bridgeStatus === 'ready'
    && catalog?.zoneId
    && catalog.liveState === 1
    && catalog.matchState === 1
    && mainPlaying
    && visible,
  );

  // Read-only fallback for browsers without the userscript, and progress display while playback is inactive.
  // Active heartbeat sessions do their own mandatory refresh immediately before starting.
  useEffect(() => {
    if (!enabled || !visible || bridgeStatus === 'probing' || heartbeatEligible) return;
    if (Date.now() - lastLoadRef.current < refreshMinMs) return;
    void load();
  }, [enabled, visible, visibilityEpoch, bridgeStatus, heartbeatEligible, refreshMinMs, load]);

  useEffect(() => {
    if (!heartbeatEligible || !sourceRef.current.bridge || !catalog?.zoneId || halted) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;

    const schedule = () => {
      if (!cancelled) timer = setTimeout(() => void tick(), heartbeatMs);
    };

    const tick = async () => {
      try {
        const activeBridge = sourceRef.current.bridge;
        if (!activeBridge || sourceRef.current.bridgeStatus !== 'ready') return;
        const raw = await activeBridge.request('heartbeat', { zoneId: catalog.zoneId! });
        if (cancelled) return;
        failures = 0;
        const heartbeat = heartbeatPayload(raw);
        if (heartbeat.accumulatedSeconds !== undefined) {
          setProgress((current) => current ? { ...current, accumulatedSeconds: heartbeat.accumulatedSeconds! } : current);
        }
        if (heartbeat.rewarded) {
          const refreshed = await load();
          if (cancelled) return;
          if (rewardsComplete(refreshed)) {
            setHeartbeatState('complete');
            return;
          }
        }
        schedule();
      } catch (error) {
        if (cancelled) return;
        failures += 1;
        if (failures >= 3) {
          setHeartbeatError(error instanceof Error && error.message ? error.message : '观看计时连续失败');
          setHeartbeatState('error');
          setHalted(true);
          return;
        }
        schedule();
      }
    };

    const start = async () => {
      const synced = await load();
      if (cancelled || !synced) return;
      if (rewardsComplete(synced)) {
        setHeartbeatState('complete');
        return;
      }
      setHeartbeatError(null);
      setHeartbeatState('running');
      schedule();
    };
    void start();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [heartbeatEligible, visibilityEpoch, catalog?.zoneId, heartbeatMs, halted, load, retryToken]);

  const retryHeartbeat = useCallback(() => {
    setHeartbeatError(null);
    setHeartbeatState('idle');
    setHalted(false);
    setRetryToken((value) => value + 1);
  }, []);

  const shown = enabled ? progress : null;
  const complete = rewardsComplete(shown);
  const heartbeatStatus: HeartbeatStatus = complete
    ? 'complete'
    : heartbeatEligible
      ? heartbeatState
      : 'idle';

  return useMemo<WatchTaskState>(() => ({
    loggedIn: enabled && loggedIn,
    accumulatedSeconds: shown?.accumulatedSeconds ?? 0,
    earnedPellets: shown?.earnedPellets ?? 0,
    tiers: shown?.tiers ?? NO_TIERS,
    officialUrl: RM_OFFICIAL_LIVE_URL,
    loginUrl,
    bridgeStatus,
    heartbeatStatus,
    heartbeatError,
    retryHeartbeat,
  }), [enabled, loggedIn, shown, loginUrl, bridgeStatus, heartbeatStatus, heartbeatError, retryHeartbeat]);
}
