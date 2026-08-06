import { useEffect, useRef, type RefObject } from 'react';
import { OBJECTIVE_MAX_HP, OBJECTIVE_SITES, OBJECTIVE_TOP_H } from '../sandbox/fieldMap';
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
  /** 建筑最高点离主行驶面的高度（米）——血条浮在它之上 */
  top: number;
}

const SITES: Site[] = [
  { key: 'redBase', label: '红方基地', team: 'red', max: OBJECTIVE_MAX_HP.base, top: OBJECTIVE_TOP_H.base },
  { key: 'blueBase', label: '蓝方基地', team: 'blue', max: OBJECTIVE_MAX_HP.base, top: OBJECTIVE_TOP_H.base },
  { key: 'redOutpost', label: '红方前哨', team: 'red', max: OBJECTIVE_MAX_HP.outpost, top: OBJECTIVE_TOP_H.outpost },
  { key: 'blueOutpost', label: '蓝方前哨', team: 'blue', max: OBJECTIVE_MAX_HP.outpost, top: OBJECTIVE_TOP_H.outpost },
];

/**
 * 缩放基准：`基准 px/m = 画布宽 / 这个数`。
 *
 * 实测「整场刚好装下」时画布宽正好覆盖 36.1 m，取比它小的数，等于把整条缩放曲线
 * 整体下压 —— 装下那一档 k≈0.83（方框比原来小一圈），往外缩时也更早触到下限。
 * 与沙盘容器多大无关：拉大窗口时沙盘和血条一起变大、比例不变，只有真的滚轮缩放 k 才动。
 */
const FIT_SPAN_M = 30;
/** 缩放上下限：太小读不出数字，太大糊住半个场地 */
const MIN_SCALE = 0.62;
const MAX_SCALE = 2.6;

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
      // 每帧读一次容器宽（只写 transform 不会让它失效，这一读不触发重排）
      const wrapW = hosts.current.get(SITES[0].key)?.parentElement?.clientWidth ?? 0;
      const refPxPerM = wrapW > 0 ? wrapW / FIT_SPAN_M : 0;
      for (const site of SITES) {
        const el = hosts.current.get(site.key);
        if (!el) continue;
        const at = OBJECTIVE_SITES[site.key];
        // 横向取底面中心、纵向取建筑顶：把「抬高」拆成两个分量，只保留竖直那一半。
        // 整点一起抬会横向漂 —— 相机是斜视的，越靠画面边缘漂得越多（实测抬 1.1 m，
        // 中间的前哨只漂 4px，贴场边的基地漂了 20px，血条就飘到基地外面去了）。
        // 那是正确的透视，但对一个「贴在建筑上的标签」来说是错的：
        // 观众读的是它落在哪个像素上，不是它在三维里悬在哪。
        const foot = s.projectField(at.x, at.y, 0);
        const top = s.projectField(at.x, at.y, site.top);
        // 缩放跟着沙盘走：量「场地上 1 米现在等于几个像素」。
        // 取横向的一米而不是竖向：竖向那一段在俯视下被压得很扁，且随相机俯仰变化，
        // 那样一转视角血条就自己胀缩了 —— 而观众只是转了个角度，没有放大。
        const east = s.projectField(at.x + 1, at.y, 0);
        if (!foot || !top || !east) {
          el.style.visibility = 'hidden';
          continue;
        }
        el.style.visibility = '';
        el.style.transform = `translate3d(${Math.round(foot.x)}px, ${Math.round(top.y)}px, 0)`;
        const pxPerM = Math.hypot(east.x - foot.x, east.y - foot.y);
        const k = refPxPerM > 0
          ? Math.min(MAX_SCALE, Math.max(MIN_SCALE, pxPerM / refPxPerM))
          : 1;
        el.style.setProperty('--ob-scale', k.toFixed(3));
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
