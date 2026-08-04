import { useCallback, useEffect, useRef, useState } from 'react';
import type { OfficialBridgeStatus } from '../net/officialBridge';
import type { HeartbeatStatus } from '../hooks/useWatchTask';
import { formatWatchDuration } from '../watchDuration';

// 纯展示组件：进度、档位、奖励事件全部由上层（useWatchTask）注入，这里不做任何取数与计时。
export interface WatchTaskTier {
  id: number;
  minutes: number;
  seconds: number;
  /** 达成该档后的累计弹丸 */
  pellets: number;
  /** 该档本身发放的弹丸 */
  increment: number;
  granted: boolean;
}

export interface WatchTaskCapsuleProps {
  loggedIn: boolean;
  accumulatedSeconds: number;
  earnedPellets: number;
  tiers: WatchTaskTier[];
  /** 官方登录入口（members/oauth） */
  loginUrl: string;
  /** 官方直播页：时长实际累计的地方 */
  officialUrl: string;
  /** 可直接交给 Tampermonkey 安装的 userscript。 */
  installUrl: string;
  bridgeStatus: OfficialBridgeStatus;
  heartbeatStatus: HeartbeatStatus;
  heartbeatError: string | null;
  onRetryHeartbeat: () => void;
}

export function WatchTaskCapsule({
  loggedIn,
  accumulatedSeconds,
  earnedPellets,
  tiers,
  loginUrl,
  officialUrl,
  installUrl,
  bridgeStatus,
  heartbeatStatus,
  heartbeatError,
  onRetryHeartbeat,
}: WatchTaskCapsuleProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dlgRef = useRef<HTMLDialogElement>(null);

  // 常驻挂载 + open 驱动开合，关闭动画（allow-discrete）才播得完（沿用 IdentityEditor 的做法）
  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      dlg.showModal();
      anchorToTrigger(dlg, btnRef.current);
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  if (!loggedIn && bridgeStatus === 'missing') {
    return (
      <a className="watch-capsule watch-capsule--login" href={installUrl} target="_blank" rel="noopener noreferrer">
        <i className="pellet-dot" aria-hidden="true" />一键安装直播助手
      </a>
    );
  }

  if (!loggedIn) {
    // 未登录：整颗胶囊退化成外链，不假装有进度
    return (
      <a className="watch-capsule watch-capsule--login" href={loginUrl} target="_blank" rel="noopener noreferrer">
        <i className="pellet-dot" aria-hidden="true" />登录领弹丸
      </a>
    );
  }

  const nextIndex = tiers.findIndex((t) => !t.granted);

  return (
    <span className="watch-wrap">
      <button
        ref={btnRef}
        type="button"
        className="watch-capsule"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <i className="pellet-dot" aria-hidden="true" />
        <span className="watch-capsule__count">{earnedPellets}</span>
        <span className="watch-capsule__unit">弹丸</span>
        <span className="watch-capsule__sep" aria-hidden="true">·</span>
        <span className="watch-capsule__time">{formatWatchDuration(accumulatedSeconds, true)}</span>
      </button>

      <dialog
        ref={dlgRef}
        className="watch-dialog"
        onClose={close}
        onClick={(e) => { if (e.target === dlgRef.current) close(); }}
      >
        <div className="watch-panel">
          <h3 className="watch-panel__title">观看时长 · 弹丸</h3>
          <p className="watch-panel__sum">
            已获得 <b>{earnedPellets}</b> 弹丸 · 累计观看 {formatWatchDuration(accumulatedSeconds)}
          </p>
          <ol className="watch-tiers">
            {tiers.map((t, i) => (
              <li key={t.id} className={`watch-tier${t.granted ? ' is-done' : ''}${i === nextIndex ? ' is-next' : ''}`}>
                <span className="watch-tier__mark" aria-hidden="true">{t.granted ? '✓' : '○'}</span>
                <span className="watch-tier__time">观看 {t.minutes} 分钟</span>
                <span className="watch-tier__gain">+{t.increment}</span>
                <span className="watch-tier__state">
                  {t.granted ? '已获得' : `还差 ${formatWatchDuration(t.seconds - accumulatedSeconds, true)}`}
                </span>
                {i === nextIndex && (
                  <span className="watch-tier__bar" aria-hidden="true">
                    <span
                      className="watch-tier__bar-fill"
                      style={{ width: `${tierProgressPct(tiers, i, accumulatedSeconds)}%` }}
                    />
                  </span>
                )}
              </li>
            ))}
          </ol>
          {heartbeatStatus === 'error' && (
            <p className="watch-panel__note" role="alert">
              {heartbeatError ?? '观看计时已停止'}。
              <button type="button" className="send-btn" onClick={onRetryHeartbeat}>重试观看计时</button>
            </p>
          )}
          {bridgeStatus === 'missing' ? (
            <p className="watch-panel__note">
              未检测到直播助手，本站不能累计观看时长；上方仍是官网已有进度。
              <a href={installUrl} target="_blank" rel="noopener noreferrer">一键安装直播助手</a>
              ，或前往<a href={officialUrl} target="_blank" rel="noopener noreferrer">官网直播页</a>观看。
            </p>
          ) : (
            <p className="watch-panel__note">
              {heartbeatStatus === 'complete'
                ? '观看奖励已全部完成。'
                : heartbeatStatus === 'running'
                  ? '直播助手正在同步官方观看计时；切后台、暂停或比赛结束会立即停止。'
                  : '正式比赛中播放主视角并保持页面在前台，直播助手才会开始计时。'}
              数据与奖励均来自 <a href={officialUrl} target="_blank" rel="noopener noreferrer">RoboMaster 官网</a>。
            </p>
          )}
        </div>
      </dialog>
    </span>
  );
}

/** 当前档的完成度：从上一档阈值算起，避免每档都从 0 重新爬 */
function tierProgressPct(tiers: WatchTaskTier[], index: number, seconds: number): number {
  const from = index > 0 ? tiers[index - 1].seconds : 0;
  const to = tiers[index].seconds;
  if (!(to > from)) return 0;
  return Math.min(100, Math.max(0, ((seconds - from) / (to - from)) * 100));
}

/** 浮层锚到触发它的胶囊：从哪儿出来，回哪儿去（transform-origin 指向胶囊中心） */
function anchorToTrigger(dlg: HTMLDialogElement, trigger: HTMLElement | null) {
  if (!trigger || typeof trigger.getBoundingClientRect !== 'function') return;
  const r = trigger.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return; // 未布局（jsdom）时不写死坐标
  const w = dlg.offsetWidth || 0;
  const margin = 8;
  const left = Math.min(Math.max(margin, r.left), Math.max(margin, window.innerWidth - w - margin));
  dlg.style.left = `${left}px`;
  dlg.style.top = 'auto';
  dlg.style.bottom = `${Math.max(margin, window.innerHeight - r.top + margin)}px`;
  const originX = Math.min(Math.max(r.left + r.width / 2 - left, 12), Math.max(12, w - 12));
  dlg.style.transformOrigin = `${originX}px 100%`;
}
