import { useCallback, useEffect, useRef, useState } from 'react';
import { CHEER_BUBBLES, CHEER_VS_CLAMP, CHEER_VS_ICON } from '../config';
import { useSpringValue } from './motion';

export interface CheerBarProps {
  redVotes: number;
  blueVotes: number;
  redLabel: string;
  blueLabel: string;
  canVote: boolean;
  onVote?: (side: 'red' | 'blue') => void;
  /** 官方直播页：助威只能在那边发生 */
  officialUrl: string;
  error?: string | null;
}

const CHIP_MS = 2200;
const PULSE_MS = 500;

type Delta = { count: number; icon: string | null };

function formatVotes(n: number): string {
  return Math.max(0, Math.round(n)).toLocaleString('zh-CN');
}

export function CheerBar({
  redVotes, blueVotes, redLabel, blueLabel, canVote, onVote, error,
}: CheerBarProps) {
  const redShown = useSpringValue(redVotes);
  const blueShown = useSpringValue(blueVotes);
  const total = redShown + blueShown;
  const redPct = total > 0 ? (redShown / total) * 100 : 50;
  const seamPct = Math.min(Math.max(redPct, CHEER_VS_CLAMP.min), CHEER_VS_CLAMP.max);

  const [delta, setDelta] = useState<Record<'red' | 'blue', Delta>>({
    red: { count: 0, icon: null },
    blue: { count: 0, icon: null },
  });
  const [pulse, setPulse] = useState(false);
  const prev = useRef({ red: redVotes, blue: blueVotes });
  const kind = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const later = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(() => { timers.current.delete(t); fn(); }, ms);
    timers.current.add(t);
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => { pending.forEach(clearTimeout); pending.clear(); };
  }, []);

  useEffect(() => {
    const dr = redVotes - prev.current.red;
    const db = blueVotes - prev.current.blue;
    prev.current = { red: redVotes, blue: blueVotes };
    if (dr <= 0 && db <= 0) return;

    const iconIndex = kind.current++ % 3;
    setDelta({
      red: { count: Math.max(0, dr), icon: dr > 0 ? CHEER_BUBBLES.red[iconIndex] : null },
      blue: { count: Math.max(0, db), icon: db > 0 ? CHEER_BUBBLES.blue[iconIndex] : null },
    });
    later(() => setDelta({ red: { count: 0, icon: null }, blue: { count: 0, icon: null } }), CHIP_MS);

    setPulse(true);
    later(() => setPulse(false), PULSE_MS);
  }, [redVotes, blueVotes, later]);

  const voteButton = (side: 'red' | 'blue') => (
    <button
      type="button"
      className={`cheer-vote cheer-vote--${side}`}
      aria-label={`为${side === 'red' ? redLabel : blueLabel}助威`}
      onClick={() => onVote?.(side)}
    >
      助威
    </button>
  );

  const chip = (side: 'red' | 'blue') => {
    const { count, icon } = delta[side];
    return (
      <span className={`cheer__chip cheer__chip--${side}${count > 0 ? ' is-on' : ''}`} aria-hidden="true">
        {icon && <img className="cheer__chip-icon" src={icon} alt="" />}
        {count > 0 ? `+${count}` : ''}
      </span>
    );
  };

  return (
    <div className="cheer" role="group" aria-label="人气助威">
      <span className="sr-only">
        红方 {redLabel} {redVotes} 票，蓝方 {blueLabel} {blueVotes} 票
      </span>

      <div className="cheer__head">
        <div className="cheer__team cheer__team--red">
          <span className="cheer__name" title={redLabel}>{redLabel}</span>
          <span className="cheer__votes" aria-hidden="true">{formatVotes(redShown)}</span>
          {chip('red')}
          {canVote && voteButton('red')}
        </div>
        <span className="cheer__gap" aria-hidden="true" />
        <div className="cheer__team cheer__team--blue">
          {canVote && voteButton('blue')}
          {chip('blue')}
          <span className="cheer__votes" aria-hidden="true">{formatVotes(blueShown)}</span>
          <span className="cheer__name" title={blueLabel}>{blueLabel}</span>
        </div>
      </div>

      {error && <span className="cheer-error" role="alert">{error}</span>}

      <div className="cheer__track">
        <span className="cheer__fill cheer__fill--red" style={{ width: `${redPct}%` }} aria-hidden="true" />
        <span className="cheer__fill cheer__fill--blue" style={{ width: `${100 - redPct}%` }} aria-hidden="true" />
        <span className={`cheer__vs${pulse ? ' is-pulse' : ''}`} style={{ left: `${seamPct}%` }} aria-hidden="true">
          <img src={CHEER_VS_ICON} alt="" />
        </span>
      </div>
    </div>
  );
}
