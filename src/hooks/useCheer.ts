import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CheerInfo, CheerTarget, ZoneCatalog } from '../types';
import { CheerProxyError, fetchCheerInfo, normalizeCheerInfo } from '../data/cheer';
import { fetchCheerTarget } from '../data/match';
import { CHEER_INFO_POLL_MS, CHEER_TARGET_POLL_MS, RM_OFFICIAL_LIVE_URL } from '../config';
import type { OfficialBridgeApi } from './useOfficialBridge';

export type CheerSide = 'red' | 'blue';

export interface CheerState {
  redVotes: number;
  blueVotes: number;
  redLabel: string;
  blueLabel: string;
  canVote: boolean;
  vote: (side: CheerSide) => void;
  visible: boolean;
  officialUrl: string;
  error: string | null;
}

export interface CheerDeps {
  enabled?: boolean;
  fetchTarget?: (zoneName: string) => Promise<CheerTarget | null>;
  fetchInfo?: (target: CheerTarget) => Promise<CheerInfo>;
  targetPollMs?: number;
  infoPollMs?: number;
  bridge?: Pick<OfficialBridgeApi, 'status' | 'request'>;
  loggedIn?: boolean;
  voteFlushMs?: number;
}

const NO_DEPS: CheerDeps = {};
const READ_FAILED = '人气值暂时读不到';
const VOTE_FAILED = '投票失败';
const noopVote = () => {};
const DISABLED: CheerState = {
  redVotes: 0,
  blueVotes: 0,
  redLabel: '',
  blueLabel: '',
  canVote: false,
  vote: noopVote,
  visible: false,
  officialUrl: RM_OFFICIAL_LIVE_URL,
  error: null,
};

interface TargetSnapshot {
  zoneName: string;
  value: CheerTarget | null;
}

interface InfoSnapshot {
  key: string;
  value: CheerInfo | null;
}

interface ErrorSnapshot {
  key: string;
  value: string | null;
}

interface OptimisticSnapshot {
  key: string;
  red: number;
  blue: number;
}

interface VoteBatch {
  key: string;
  target: CheerTarget;
  count: number;
  timer: ReturnType<typeof setTimeout>;
}

function sameTarget(a: CheerTarget | null, b: CheerTarget | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.matchId === b.matchId && a.redTeamId === b.redTeamId && a.blueTeamId === b.blueTeamId;
}

function targetKey(target: CheerTarget | null): string {
  return target ? `${target.matchId}:${target.redTeamId}:${target.blueTeamId}` : '';
}

function voteResponse(value: unknown): CheerInfo | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.redVotes !== 'number' || typeof candidate.blueVotes !== 'number') return null;
  return normalizeCheerInfo(candidate);
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? `${VOTE_FAILED}：${error.message}` : VOTE_FAILED;
}

export function useCheer(catalog: ZoneCatalog | null, deps: CheerDeps = NO_DEPS): CheerState {
  const {
    enabled = true,
    fetchTarget = fetchCheerTarget,
    fetchInfo = fetchCheerInfo,
    targetPollMs = CHEER_TARGET_POLL_MS,
    infoPollMs = CHEER_INFO_POLL_MS,
    bridge,
    loggedIn = false,
    voteFlushMs = 5_000,
  } = deps;
  const zoneName = enabled ? (catalog?.zoneName ?? '') : '';

  const [targetSnapshot, setTargetSnapshot] = useState<TargetSnapshot>({ zoneName: '', value: null });
  const [infoSnapshot, setInfoSnapshot] = useState<InfoSnapshot>({ key: '', value: null });
  const [errorSnapshot, setErrorSnapshot] = useState<ErrorSnapshot>({ key: '', value: null });
  const [optimistic, setOptimistic] = useState<OptimisticSnapshot>({ key: '', red: 0, blue: 0 });
  const [proxyMissing, setProxyMissing] = useState(false);
  const batchesRef = useRef<Record<CheerSide, VoteBatch | null>>({ red: null, blue: null });
  const fnsRef = useRef({ fetchTarget, fetchInfo });
  useEffect(() => { fnsRef.current = { fetchTarget, fetchInfo }; });

  const target = targetSnapshot.zoneName === zoneName ? targetSnapshot.value : null;
  const key = targetKey(target);
  const info = infoSnapshot.key === key ? infoSnapshot.value : null;
  const error = errorSnapshot.key === key ? errorSnapshot.value : null;

  useEffect(() => {
    if (!zoneName) return;
    let alive = true;
    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const value = await fnsRef.current.fetchTarget(zoneName);
        if (!alive) return;
        setTargetSnapshot((current) => (
          current.zoneName === zoneName && sameTarget(current.value, value)
            ? current
            : { zoneName, value }
        ));
      } catch {
        // Keep the last target through transient network failures.
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), targetPollMs);
    return () => { alive = false; clearInterval(timer); };
  }, [zoneName, targetPollMs]);

  useEffect(() => {
    if (!target || !key || proxyMissing) return;
    let alive = true;
    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const value = await fnsRef.current.fetchInfo(target);
        if (!alive) return;
        setInfoSnapshot({ key, value });
        setErrorSnapshot({ key, value: null });
      } catch (caught) {
        if (!alive) return;
        if (caught instanceof CheerProxyError && caught.status === 404) {
          setProxyMissing(true);
          return;
        }
        setErrorSnapshot({ key, value: READ_FAILED });
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), infoPollMs);
    return () => { alive = false; clearInterval(timer); };
  }, [target, key, infoPollMs, proxyMissing]);

  // 能否投票以官方 cheer/info 的 voteEnabled 为准，**不看** live_game_info 的 commonConfig.openVote。
  // 两者是不同的东西：openVote 是官方 PC 前端自己的显示开关（他们据此隐藏助威条），
  // voteEnabled 是投票接口对这一场次的实际答复。2026-08-05 全国赛决赛期间实测二者不一致——
  // openVote=0 而 voteEnabled=true，且票数每 10 秒真实增长数十票（投票通道明确活着）。
  // 把 openVote 当门槛会让我们在官方仍在计票时错误地禁掉投票，故只保留接口侧的权威判断。
  const canVote = Boolean(
    enabled
    && bridge?.status === 'ready'
    && loggedIn
    && catalog?.liveState === 1
    && catalog.matchState === 1
    && target
    && info?.voteEnabled,
  );
  const runtimeRef = useRef({ canVote, key });
  useEffect(() => { runtimeRef.current = { canVote, key }; }, [canVote, key]);

  const removeOptimistic = useCallback((batch: VoteBatch, side: CheerSide) => {
    setOptimistic((current) => {
      if (current.key !== batch.key) return current;
      return {
        ...current,
        [side]: Math.max(0, current[side] - batch.count),
      };
    });
  }, []);

  const flush = useCallback(async (side: CheerSide, batch: VoteBatch) => {
    if (!bridge || !runtimeRef.current.canVote || runtimeRef.current.key !== batch.key) {
      removeOptimistic(batch, side);
      return;
    }
    try {
      const data = await bridge.request('vote', {
        matchId: batch.target.matchId,
        teamId: side === 'red' ? batch.target.redTeamId : batch.target.blueTeamId,
        count: batch.count,
      });
      const official = voteResponse(data);
      if (official) setInfoSnapshot({ key: batch.key, value: official });
      else setInfoSnapshot({ key: batch.key, value: await fnsRef.current.fetchInfo(batch.target) });
      setErrorSnapshot({ key: batch.key, value: null });
    } catch (caught) {
      try {
        setInfoSnapshot({ key: batch.key, value: await fnsRef.current.fetchInfo(batch.target) });
      } catch {
        // The optimistic delta is still removed below; keep the last known official totals.
      }
      setErrorSnapshot({ key: batch.key, value: errorMessage(caught) });
    } finally {
      removeOptimistic(batch, side);
    }
  }, [bridge, removeOptimistic]);

  const vote = useCallback((side: CheerSide) => {
    if (!canVote || !target || !key) return;
    const current = batchesRef.current[side];
    if (current && current.key === key) {
      if (current.count >= 100) return;
      current.count += 1;
    } else {
      if (current) clearTimeout(current.timer);
      const batch = {
        key,
        target,
        count: 1,
        timer: 0 as unknown as ReturnType<typeof setTimeout>,
      };
      batch.timer = setTimeout(() => {
        if (batchesRef.current[side] === batch) batchesRef.current[side] = null;
        void flush(side, batch);
      }, voteFlushMs);
      batchesRef.current[side] = batch;
    }
    setOptimistic((value) => ({
      key,
      red: value.key === key ? value.red + (side === 'red' ? 1 : 0) : (side === 'red' ? 1 : 0),
      blue: value.key === key ? value.blue + (side === 'blue' ? 1 : 0) : (side === 'blue' ? 1 : 0),
    }));
  }, [canVote, target, key, flush, voteFlushMs]);

  useEffect(() => {
    const batches = batchesRef.current;
    return () => {
      if (batches.red) clearTimeout(batches.red.timer);
      if (batches.blue) clearTimeout(batches.blue.timer);
    };
  }, []);

  return useMemo<CheerState>(() => {
    if (!enabled) return DISABLED;
    const delta = optimistic.key === key && canVote ? optimistic : { red: 0, blue: 0 };
    return {
      redVotes: (info?.redVotes ?? 0) + delta.red,
      blueVotes: (info?.blueVotes ?? 0) + delta.blue,
      redLabel: target?.redLabel ?? '',
      blueLabel: target?.blueLabel ?? '',
      canVote,
      vote,
      visible: target !== null && info !== null,
      officialUrl: RM_OFFICIAL_LIVE_URL,
      error,
    };
  }, [enabled, info, optimistic, key, canVote, vote, target, error]);
}
