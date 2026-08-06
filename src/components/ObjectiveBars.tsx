import { useEffect, useRef, type RefObject } from 'react';
import { OBJECTIVE_MAX_HP, OBJECTIVE_SITES } from '../sandbox/fieldMap';
import type { FusedObjectives } from '../sandbox/objectiveFusion';
import type { SandboxScene } from '../sandbox/render/scene';

/**
 * 四个战略目标的血条，浮在沙盘上各自的基地/前哨站正上方。
 *
 * 血量本来只在角落的状态行里以数字出现 —— 那是「能查到」，不是「看得见」。
 * 攻防的所有意义都挂在这四个数上，把它们钉回目标本体，观众才能一眼看出
 * 现在是谁在被打。
 *
 * 位置每帧由 `projectField` 算，写进 DOM 的 transform，不进 React ——
 * 与 {@link RobotPanel} 同一套做法。
 */

interface Site {
  key: keyof FusedObjectives;
  label: string;
  team: 'red' | 'blue';
  max: number;
  /** 血条离地高度（米）：要浮在建筑顶上，不能被它自己挡住 */
  height: number;
}

/** 基地本体连护甲约 1.2 m 高，前哨站塔身更高一些；各留一点抬头量 */
const SITES: Site[] = [
  { key: 'redBase', label: '红方基地', team: 'red', max: OBJECTIVE_MAX_HP.base, height: 2.2 },
  { key: 'blueBase', label: '蓝方基地', team: 'blue', max: OBJECTIVE_MAX_HP.base, height: 2.2 },
  { key: 'redOutpost', label: '红方前哨', team: 'red', max: OBJECTIVE_MAX_HP.outpost, height: 2.0 },
  { key: 'blueOutpost', label: '蓝方前哨', team: 'blue', max: OBJECTIVE_MAX_HP.outpost, height: 2.0 },
];

interface Props {
  objectives: FusedObjectives | null;
  scene: RefObject<SandboxScene | null>;
}

export function ObjectiveBars({ objectives, scene }: Props) {
  const hosts = useRef(new Map<string, HTMLDivElement | null>());

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const s = scene.current;
      if (!s) return;
      for (const site of SITES) {
        const el = hosts.current.get(site.key);
        if (!el) continue;
        const at = OBJECTIVE_SITES[site.key];
        const p = s.projectField(at.x, at.y, site.height);
        if (!p) {
          el.style.visibility = 'hidden';
          continue;
        }
        el.style.visibility = '';
        el.style.transform = `translate3d(${Math.round(p.x)}px, ${Math.round(p.y)}px, 0)`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [scene]);

  return (
    <>
      {SITES.map((site) => {
        const hp = objectives?.[site.key] ?? null;
        // null 与 0 是两件完全不同的事：读不到 vs 已被击毁。绝不用 0 顶替 null。
        const dead = hp === 0;
        const unknown = hp === null;
        const pct = unknown ? 0 : Math.min(100, Math.max(0, (hp / site.max) * 100));
        return (
          <div
            key={site.key}
            className={`ob ob--${site.team}${unknown ? ' is-unknown' : ''}${dead ? ' is-dead' : ''}`}
            ref={(el) => { hosts.current.set(site.key, el); }}
            aria-hidden="true"
          >
            <div className="ob__box">
              <span className="ob__num">{unknown ? '—' : dead ? '已击毁' : hp}</span>
              <span className="ob__track">
                <span className="ob__fill" style={{ width: `${pct}%` }} />
              </span>
            </div>
            <span className="ob__stem" />
          </div>
        );
      })}
      {/* 屏幕阅读器读这一份：上面那四个是纯视觉的空间标注，念坐标没有意义 */}
      <p className="sr-only">
        {SITES.map((s) => {
          const hp = objectives?.[s.key] ?? null;
          return `${s.label} ${hp === null ? '血量未知' : hp === 0 ? '已击毁' : `${hp} 点`}`;
        }).join('，')}
      </p>
    </>
  );
}
