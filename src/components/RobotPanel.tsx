import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { RobotStatus } from '../sandbox/types';

/**
 * 沙盘上点开机器人后浮在它上方的面板。
 *
 * **屏幕空间的 DOM，不是画在 WebGL 里的。** 于是它天然面向观看者（不随相机转），
 * 也能直接放 `<canvas>` 做实时预览、放真正可聚焦的按钮 —— 这三件事在 3D 里
 * 每一件都要另起炉灶。
 *
 * 位置由 {@link SandboxMap} 每帧写 `transform`（1:1，不加过渡，加了会拖影），
 * 本组件只管内容与开合动画。开合锚在引线根部：从机器人身上长出来，收回它身上去。
 */

/** 预览画布的像素尺寸。16:9，够看清"这一路正对着什么"，不必更大 */
const PREVIEW_W = 176;
const PREVIEW_H = 99;
/** 预览重绘间隔（ms）。~12 fps —— 这是个缩略图，不是第十一路直播 */
const PREVIEW_MS = 80;
/** 提示的存活时长 */
const HINT_MS = 2400;

export interface RobotPanelProps {
  /** 该路的流名（= data-view-id），实时预览按它找 `<video>` */
  viewId: string;
  /** 机位名，如「红方·英雄」 */
  name: string;
  team: 'red' | 'blue';
  hp: number | null;
  maxHp: number | null;
  status: RobotStatus;
  /** 该路是否已排在上方的机位网格里 */
  pinned: boolean;
  /** 网格里有没有选中「待替换」的那一格 */
  hasSelection: boolean;
  onPin: () => void;
  /** 鼠标进/出面板：进了就冻住跟随，不然机器人一动按钮就点不中 */
  onHoverChange: (hovering: boolean) => void;
  hostRef: RefObject<HTMLDivElement | null>;
}

/** 「固定到上方」：一格机位 + 一支箭指进去 */
function PinIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.2" y="1.2" width="12.6" height="6" rx="1.2" />
      <path d="M7.5 13.6V9.4M7.5 9.4 5.4 11.5M7.5 9.4l2.1 2.1" />
    </svg>
  );
}

function hpText(hp: number | null, maxHp: number | null, status: RobotStatus): string {
  if (status === 'dead') return '已阵亡';
  if (hp === null) return '血量读不到';
  return maxHp === null ? String(hp) : `${hp} / ${maxHp}`;
}

export function RobotPanel({
  viewId, name, team, hp, maxHp, status, pinned, hasSelection, onPin, onHoverChange, hostRef,
}: RobotPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasFrame, setHasFrame] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(hintTimer.current), []);

  // 实时预览：把那一路自己的 `<video>` 再 drawImage 一份。零额外带宽 ——
  // 流本来就在解码（排不进网格的也挂在屏外容器里），这里只是多画一次。
  useEffect(() => {
    if (pinned) return;
    const cv = canvasRef.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    let raf = 0;
    let last = 0;
    let ok = false;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < PREVIEW_MS) return;
      last = t;
      const video = document.querySelector<HTMLVideoElement>(
        `[data-view-id="${CSS.escape(viewId)}"] video`,
      );
      const live = !!video && video.readyState >= 2 && video.videoWidth > 0;
      // 只在通/断翻转时改 state，不然这个循环会把整棵树按 12 Hz 重渲一遍
      if (live !== ok) {
        ok = live;
        setHasFrame(live);
      }
      if (live) ctx.drawImage(video, 0, 0, cv.width, cv.height);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [viewId, pinned]);

  const say = useCallback((text: string) => {
    setHint(text);
    clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), HINT_MS);
  }, []);

  // 三态各有各的说法：置灰的两种原因必须能分辨，否则观众只知道"点不动"
  const blocked = pinned ? '已经在上面的机位网格里了' : hasSelection ? null : '请选择待替换的视角';

  return (
    <div className={`rp rp--${team}`} ref={hostRef}>
      <span className="rp__dot" aria-hidden="true" />
      <span className="rp__stem" aria-hidden="true" />
      <div className="rp__slot">
        <div
          className="rp__card"
          role="dialog"
          aria-label={`${name} 详情`}
          onPointerEnter={() => onHoverChange(true)}
          onPointerLeave={() => onHoverChange(false)}
        >
          <div className="rp__head">
            <span className="rp__name" title={name}>{name}</span>
            <button
              type="button"
              className={`rp__pin${blocked ? ' is-off' : ''}`}
              aria-disabled={blocked ? true : undefined}
              aria-label="固定到上方"
              title={blocked ?? '与选中的那一格交换位置'}
              onClick={() => (blocked ? say(blocked) : onPin())}
            >
              <PinIcon />
            </button>
          </div>

          <div className={`rp__hp${status === 'dead' ? ' is-dead' : ''}`}>
            <span className="rp__hp-label">血量</span>
            <span className="rp__hp-value">{hpText(hp, maxHp, status)}</span>
            {hp !== null && maxHp !== null && maxHp > 0 && (
              <span className="rp__hp-bar" aria-hidden="true">
                <span className="rp__hp-fill" style={{ width: `${Math.min(100, (hp / maxHp) * 100)}%` }} />
              </span>
            )}
          </div>

          {pinned ? (
            <div className="rp__preview rp__preview--pinned">已固定</div>
          ) : (
            <div className="rp__preview">
              <canvas ref={canvasRef} width={PREVIEW_W} height={PREVIEW_H} />
              {!hasFrame && <span className="rp__preview-note">这一路还没画面</span>}
            </div>
          )}

          {hint && <p className="rp__hint" role="status">{hint}</p>}
        </div>
      </div>
    </div>
  );
}
