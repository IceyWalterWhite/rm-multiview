// 自实现的最小动效内核：项目不引入动画库，弹簧与动效偏好订阅都在这里。
import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '../a11y';

/** 订阅系统动效偏好：用户中途改设置时组件即时跟随（只读一次会永远停在旧值） */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  }, []);
  return reduced;
}

const SUB_STEP = 1 / 120;  // 固定子步长积分：掉帧时数值不会发散
const MAX_FRAME = 1 / 20;  // 后台标签页回前台的巨大 dt 截断，防止一帧跳飞

/**
 * 临界阻尼弹簧补间（默认 damping 1.0 / response 0.4，对应 Apple 的「移动/重定位」参数）。
 *
 * 为什么不是 CSS transition：数据是 5 秒一次轮询，会跳变。transition 每次都从「新起点」
 * 重新计时，新数据插进来时会看到顿挫甚至回跳；弹簧永远从当前呈现值与当前速度继续，
 * 跳变被吸收成连续运动。response 不是「时长」——弹簧没有固定时长，落位时间由参数涌现。
 *
 * @param response 逼近目标的快慢（秒），越小越利落
 * @param damping  阻尼比，1.0 为临界阻尼（无过冲）
 */
export function useSpringValue(target: number, response = 0.4, damping = 1): number {
  const reduced = useReducedMotion();
  const staticMode = reduced || typeof requestAnimationFrame === 'undefined';
  const [shown, setShown] = useState(target);
  const state = useRef({ x: target, v: 0 });
  const goal = useRef(target);
  const raf = useRef<number | null>(null);
  const last = useRef(0);

  useEffect(() => {
    goal.current = target;
    if (staticMode) {
      // 中途打开「减少动效」时必须掐掉在飞的那一帧循环，否则它会继续覆写 shown，
      // 用户改了设置却看见数字仍在补间
      if (raf.current !== null) { cancelAnimationFrame(raf.current); raf.current = null; }
      state.current = { x: target, v: 0 };
      return;
    }
    // 已在飞行中：只换目标，从当前位置与速度续走（可打断、不回跳）
    if (raf.current !== null) return;
    last.current = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last.current) / 1000, MAX_FRAME);
      last.current = now;
      const s = state.current;
      const w = (Math.PI * 2) / response;
      const steps = Math.max(1, Math.ceil(dt / SUB_STEP));
      const h = dt / steps;
      for (let i = 0; i < steps; i += 1) {
        const a = -w * w * (s.x - goal.current) - 2 * damping * w * s.v;
        s.v += a * h;
        s.x += s.v * h;
      }
      // 票数是整数，落到半票以内即视为到位，收针避免永远跑 rAF
      const settled = Math.abs(s.x - goal.current) < 0.5 && Math.abs(s.v) < 1;
      if (settled) {
        s.x = goal.current;
        s.v = 0;
        raf.current = null;
      } else {
        raf.current = requestAnimationFrame(tick);
      }
      setShown(s.x);
    };
    raf.current = requestAnimationFrame(tick);
  }, [target, response, damping, staticMode]);

  useEffect(() => () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
  }, []);

  return staticMode ? target : shown;
}
