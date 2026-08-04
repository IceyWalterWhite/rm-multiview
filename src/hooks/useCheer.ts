import { useEffect, useMemo, useRef, useState } from 'react';
import { CHEER_INFO_POLL_MS, CHEER_TARGET_POLL_MS } from '../config';
import { CheerProxyError, fetchCheerInfo } from '../data/cheer';
import { fetchCheerTarget } from '../data/match';
import type { CheerInfo, CheerTarget, ZoneCatalog } from '../types';

export interface CheerState {
  redVotes: number;
  blueVotes: number;
  redLabel: string;
  blueLabel: string;
  visible: boolean;
  error: string | null;
}

export interface CheerDeps {
  enabled?: boolean;
  fetchTarget?: (zoneName: string) => Promise<CheerTarget | null>;
  fetchInfo?: (target: CheerTarget) => Promise<CheerInfo>;
  targetPollMs?: number;
  infoPollMs?: number;
}

interface TargetSnapshot {
  zoneName: string;
  value: CheerTarget | null;
  loaded: boolean;
}

interface InfoSnapshot {
  key: string;
  value: CheerInfo | null;
}

function targetKey(target: CheerTarget | null): string {
  return target ? `${target.matchId}:${target.redTeamId}:${target.blueTeamId}` : '';
}

function sameTarget(left: CheerTarget | null, right: CheerTarget | null): boolean {
  return targetKey(left) === targetKey(right)
    && left?.redLabel === right?.redLabel
    && left?.blueLabel === right?.blueLabel;
}

export function useCheer(catalog: ZoneCatalog | null, deps: CheerDeps = {}): CheerState {
  const {
    enabled = true,
    fetchTarget = fetchCheerTarget,
    fetchInfo = fetchCheerInfo,
    targetPollMs = CHEER_TARGET_POLL_MS,
    infoPollMs = CHEER_INFO_POLL_MS,
  } = deps;
  const zoneName = enabled ? (catalog?.zoneName ?? '') : '';
  const functionsRef = useRef({ fetchTarget, fetchInfo });
  useEffect(() => { functionsRef.current = { fetchTarget, fetchInfo }; });

  const [targetSnapshot, setTargetSnapshot] = useState<TargetSnapshot>({
    zoneName: '', value: null, loaded: false,
  });
  const [infoSnapshot, setInfoSnapshot] = useState<InfoSnapshot>({ key: '', value: null });
  const [errorSnapshot, setErrorSnapshot] = useState<{ key: string; value: string | null }>({
    key: '', value: null,
  });
  const [proxyMissing, setProxyMissing] = useState(false);

  const target = targetSnapshot.zoneName === zoneName ? targetSnapshot.value : null;
  const key = targetKey(target);
  const info = infoSnapshot.key === key ? infoSnapshot.value : null;
  const error = errorSnapshot.key === key ? errorSnapshot.value : null;

  useEffect(() => {
    if (!zoneName) return;
    let active = true;
    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const value = await functionsRef.current.fetchTarget(zoneName);
        if (!active) return;
        setTargetSnapshot((current) => current.zoneName === zoneName && current.loaded
          && sameTarget(current.value, value)
          ? current
          : { zoneName, value, loaded: true });
      } catch {
        if (active) setTargetSnapshot((current) => current.zoneName === zoneName
          ? { ...current, loaded: true }
          : { zoneName, value: null, loaded: true });
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), targetPollMs);
    return () => { active = false; clearInterval(timer); };
  }, [zoneName, targetPollMs]);

  useEffect(() => {
    if (!target || !key || proxyMissing) return;
    let active = true;
    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const value = await functionsRef.current.fetchInfo(target);
        if (!active) return;
        setInfoSnapshot({ key, value });
        setErrorSnapshot({ key, value: null });
      } catch (caught) {
        if (!active) return;
        if (caught instanceof CheerProxyError && caught.status === 404) {
          setProxyMissing(true);
          return;
        }
        setErrorSnapshot({ key, value: '人气值暂时读不到' });
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), infoPollMs);
    return () => { active = false; clearInterval(timer); };
  }, [target, key, infoPollMs, proxyMissing]);

  return useMemo(() => ({
    redVotes: info?.redVotes ?? 0,
    blueVotes: info?.blueVotes ?? 0,
    redLabel: target?.redLabel ?? '',
    blueLabel: target?.blueLabel ?? '',
    visible: target !== null && info !== null,
    error,
  }), [info, target, error]);
}
