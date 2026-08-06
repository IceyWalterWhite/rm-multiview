import { useEffect, useMemo, useRef, useState } from 'react';
import type { ZoneCatalog } from '../types';
import { SANDBOX_TICK_MS } from '../config';
import { createFleet, rosterKey, type FleetMember, type SandboxSnapshot } from '../sandbox/fleet';
import { identifyRole } from '../sandbox/roles';
import { createSampler, type SampleTarget } from '../sandbox/sampler';

/**
 * 沙盘的采样循环：把正在播的十路画面变成一份全场状态。
 *
 * 位置：这是识别侧唯一的 React 接线。取像素、检测、汇聚全在 src/sandbox 里，
 * 与框架无关；本 hook 只负责「什么时候跑」「video 元素在哪」这两件事。
 *
 * **视频元素靠 DOM 查询拿，不走 ref。** 十路 `<video>` 在 memo 过的 VideoPlayer 里，
 * 把 ref 一层层透传上来会击穿那些 memo（弹幕每批都重渲染 Live，机位不该跟着重渲）。
 * `data-view-id` 本来就是为跨组件按机位找 DOM 准备的（useEnlarged.readGeometries 同样这么干）。
 */

export interface SandboxState {
  snapshot: SandboxSnapshot | null;
  /** 上一轮取像素耗时（ms），用来判断这台机器扛不扛得住 */
  sampleMs: number;
  /** 画布被污染的机位。非空说明「强制走 hls.js」的修复失效了 */
  tainted: string[];
}

function membersOf(catalog: ZoneCatalog): FleetMember[] {
  const out: FleetMember[] = [];
  for (const v of [...catalog.redViews, ...catalog.blueViews]) {
    const id = identifyRole(v.role);
    // 认不出身份的机位（合集、主视角）不进沙盘。猜错会把 A 车画到 B 车头上。
    if (id) out.push({ id: v.id, team: id.team, num: id.num, kind: id.kind });
  }
  return out;
}

/**
 * @param onSnapshot 每一轮的结果。渲染层直接吃它，**不经过 React state** ——
 *   3 Hz 的整棵树重渲染没有必要，而且会把弹幕那边一起拖下水。
 */
export function useSandbox(
  catalog: ZoneCatalog | null,
  enabled: boolean,
  onSnapshot: (s: SandboxSnapshot) => void,
): SandboxState {
  const members = useMemo(() => (catalog ? membersOf(catalog) : []), [catalog]);
  // 重建采样链的唯一理由是**名单变了**，不是 catalog 换了个对象。理由见 rosterKey 的注释。
  const roster = useMemo(() => rosterKey(members), [members]);
  const [state, setState] = useState<SandboxState>({ snapshot: null, sampleMs: 0, tainted: [] });

  // 下面两个 ref 都必须在 effect 里赋值 —— 渲染期写 ref 在并发渲染下会被丢弃或重复执行。
  // 声明顺序即执行顺序：这两条先跑，采样那条才能读到最新值。
  const membersRef = useRef(members);
  useEffect(() => {
    membersRef.current = members;
  }, [members]);
  // 回调每轮都可能是新引用；放 ref 里，免得它变一次就重建整条采样链
  const cb = useRef(onSnapshot);
  useEffect(() => {
    cb.current = onSnapshot;
  }, [onSnapshot]);

  useEffect(() => {
    const members = membersRef.current;
    if (!enabled || members.length === 0) return;
    const sampler = createSampler();
    const fleet = createFleet(members);
    let stop = false;
    // 状态行 1 Hz 更新即可；位姿走 onSnapshot 直达渲染层，不进 React
    let lastPublish = 0;

    const tick = () => {
      if (stop) return;
      const targets: SampleTarget[] = [];
      for (const m of members) {
        // 不限定容器类名：wings 的 .view-tile、grid 的 .sg-tile、以及 grid 里
        // 排不进网格而挂在屏外的那几路，都带 data-view-id，一个选择器全覆盖
        const video = document.querySelector<HTMLVideoElement>(
          `[data-view-id="${CSS.escape(m.id)}"] video`,
        );
        if (video) targets.push({ id: m.id, video, kind: m.kind });
      }
      const snapshot = fleet.observe(performance.now(), sampler.grab(targets));
      cb.current(snapshot);
      const now = performance.now();
      if (now - lastPublish > 1000) {
        lastPublish = now;
        setState({ snapshot, sampleMs: sampler.stats.lastMs, tainted: sampler.stats.tainted });
      }
    };

    const timer = setInterval(tick, SANDBOX_TICK_MS);
    tick();
    return () => {
      stop = true;
      clearInterval(timer);
      sampler.dispose();
    };
    // members 走 ref：它每次签名刷新都是新数组，但内容不变时不该重建（见 rosterKey）
  }, [enabled, roster]);

  return state;
}
