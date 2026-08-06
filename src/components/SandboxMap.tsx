import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ZoneCatalog } from '../types';
import { SANDBOX_FIELD_GLB } from '../config';
import { useSandbox } from '../hooks/useSandbox';
import type { SandboxRobot, SandboxSnapshot } from '../sandbox/fleet';
import type { SandboxScene } from '../sandbox/render/scene';
import { ObjectiveBars } from './ObjectiveBars';
import { RobotPanel } from './RobotPanel';

/**
 * 3D 沙盘。只存在于 grid 布局的右下区，wings（默认布局）下完全不渲染。
 *
 * **只在进入视口后才开工。** 场地模型 7.6 MiB，加上十路取像素与检测，
 * 对没切到 grid 的观众是纯粹的浪费。three.js 与场景代码也是这时才动态 import，
 * 不进首屏包（three 一个人就有首屏包三倍大）。于是「切到 grid 才下 7.6 MiB」
 * 这条由组件自身保证，不依赖调用方记得做懒加载。
 *
 * 沙盘同时是**视角控制器**：点机器人开面板，把那一路换到上方的机位网格里。
 */

/** 双击判定窗口（ms）。单击开合面板要等它走完 —— 用户已确认接受这点延迟 */
const DOUBLE_MS = 300;
/** 按下到抬起挪超过这么多像素就算拖相机，不算点击 */
const CLICK_SLOP = 6;
/** 面板卡片与画布边缘的最小间距 */
const EDGE_PAD = 8;

interface Props {
  catalog: ZoneCatalog;
  /** 当前排在上方机位网格里的路（其余挂在屏外解码）。用来判断「已固定」 */
  shownIds: readonly string[];
  /** 网格里选中的那一格；null = 没选 */
  selected: string | null;
  /** 把某一路换到选中的那一格去 */
  onPin: (viewId: string) => void;
}

export function SandboxMap({ catalog, shownIds, selected, onPin }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<SandboxScene | null>(null);
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [openId, setOpenId] = useState<string | null>(null);

  // 滚进视口才启动。IntersectionObserver 的阈值取 0 —— 露出一点就开始加载，
  // 等用户真正看到时模型已经在了。
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setVisible(true);
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // three.js + 场景：动态 import，只有真要用时才拉这 600 KB
  useEffect(() => {
    if (!visible || !canvasRef.current) return;
    let disposed = false;
    setStatus('loading');
    import('../sandbox/render/scene')
      .then(({ createScene }) => {
        if (disposed || !canvasRef.current) return;
        const scene = createScene(canvasRef.current, SANDBOX_FIELD_GLB);
        sceneRef.current = scene;
        const box = canvasRef.current.getBoundingClientRect();
        scene.resize(box.width, box.height);
        return scene.fieldLoaded.then(() => {
          if (!disposed) setStatus('ready');
        });
      })
      .catch((e) => {
        console.error('[sandbox] 渲染层加载失败', e);
        if (!disposed) setStatus('failed');
      });
    return () => {
      disposed = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [visible]);

  // 画布尺寸跟着容器走
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const box = el.getBoundingClientRect();
      sceneRef.current?.resize(box.width, box.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** 开发期假车队接管中。真快照这时不能再往渲染层写，见下面 __rmSandboxFake 的注释 */
  const faking = useRef(false);

  // 位姿直达渲染层，不进 React state —— 3 Hz 重渲染整棵树没有必要
  const onSnapshot = useCallback((s: SandboxSnapshot) => {
    if (import.meta.env.DEV && faking.current) return;
    sceneRef.current?.update(s.robots);
    // 开发期把最新快照挂到 window 上：视觉识别的问题在截图上看不出来
    // （两台车叠在一起、坐标差一两米、朝向反了都长得很像「对的」），
    // 必须能把数字拿出来核对。生产构建里这行会被 DCE 掉。
    if (import.meta.env.DEV) {
      (window as unknown as { __rmSandbox?: SandboxSnapshot }).__rmSandbox = s;
    }
  }, []);
  const { snapshot: sampled, sampleMs, tainted } = useSandbox(catalog, visible, onSnapshot);

  /**
   * 开发期的假车队。没有直播时十路全是占位色块，识别侧一个位置都产不出，
   * 于是沙盘上的一切（标记、拾取、面板几何）都无从验收 —— 而这些恰恰是
   * 「不看一眼就不知道对不对」的部分。console 里 `__rmSandboxFake(snapshot)`
   * 灌一份进来即可，传 null 还原。生产构建里 effect 整支被 DCE。
   *
   * 灌进来后要**掐断真快照**：采样循环照跑不误，而没有 `<video>` 时它每一轮都
   * 判定十路全都 pose=null，330 ms 后就把假车队全部隐藏 —— 表现是「灌了没反应」。
   */
  const [fake, setFake] = useState<SandboxSnapshot | null>(null);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as Record<string, unknown>;
    w.__rmSandboxFake = (s: SandboxSnapshot | null) => {
      faking.current = s !== null;
      setFake(s);
      if (s) sceneRef.current?.update(s.robots);
    };
    // 拾取与面板定位都是「算错了也长得像对的」的东西，得能把坐标读出来核对
    w.__rmSandboxScene = () => sceneRef.current;
    return () => {
      delete w.__rmSandboxFake;
      delete w.__rmSandboxScene;
    };
  }, []);
  const snapshot = fake ?? sampled;

  // ---------- 点机器人：单击开合面板，双击换视角 ----------
  const panelRef = useRef<HTMLDivElement>(null);
  const frozen = useRef(false);
  const press = useRef<{ x: number; y: number } | null>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(clickTimer.current), []);

  const hit = useCallback((e: ReactPointerEvent | MouseEvent): string | null => {
    const scene = sceneRef.current;
    const cv = canvasRef.current;
    if (!scene || !cv) return null;
    const box = cv.getBoundingClientRect();
    return scene.pickAt(e.clientX - box.left, e.clientY - box.top);
  }, []);

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    press.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onClick = useCallback((e: React.MouseEvent) => {
    const from = press.current;
    press.current = null;
    // 拖相机也会以 click 收尾（按下抬起都在画布上），位移一大就不是点击
    if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) > CLICK_SLOP) return;
    const id = hit(e.nativeEvent);
    clearTimeout(clickTimer.current);
    if (!id) {
      setOpenId(null); // 点空地收起
      return;
    }
    // 等双击判定走完再开合 —— 双击是「换视角」，不该先闪一下面板
    clickTimer.current = setTimeout(() => {
      setOpenId((cur) => (cur === id ? null : id));
    }, DOUBLE_MS);
  }, [hit]);

  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    clearTimeout(clickTimer.current);
    const id = hit(e.nativeEvent);
    if (!id) return;
    setOpenId(id);
    if (selected && !shownIds.includes(id)) onPin(id);
  }, [hit, onPin, selected, shownIds]);

  // Esc 收起 —— 任何状态都要有键盘退路。对话框开着时 Esc 属于对话框，不越权抢
  useEffect(() => {
    if (!openId) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      setOpenId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openId]);

  // ---------- 面板跟随 ----------
  // 每帧写 transform，不进 React：机器人 3 Hz 更新一次目标、渲染层每帧插值，
  // 面板要贴着它就只能同频跟。鼠标停在面板上时冻住 —— 不冻的话按钮会从指针下跑掉。
  useEffect(() => {
    if (!openId) return;
    let raf = 0;
    let below = false;
    let cardW = 0;
    let cardH = 0;
    const follow = () => {
      raf = requestAnimationFrame(follow);
      const host = panelRef.current;
      const scene = sceneRef.current;
      const wrap = wrapRef.current;
      if (!host || !scene || !wrap || frozen.current) return;
      const p = scene.screenPosOf(openId);
      if (!p) {
        host.style.visibility = 'hidden';
        return;
      }
      host.style.visibility = '';
      host.style.transform = `translate3d(${Math.round(p.x)}px, ${Math.round(p.y)}px, 0)`;
      // 卡片尺寸量一次就够（内容高度只在血量/提示变化时才变，差几像素不影响夹取）
      const card = host.querySelector<HTMLElement>('.rp__card');
      if (card && (cardW === 0 || cardH === 0)) {
        cardW = card.offsetWidth;
        cardH = card.offsetHeight;
      }
      if (cardW > 0) {
        const half = cardW / 2;
        const lo = EDGE_PAD + half;
        const hi = Math.max(lo, wrap.clientWidth - EDGE_PAD - half);
        host.style.setProperty('--rp-shift', `${Math.round(Math.min(Math.max(p.x, lo), hi) - p.x)}px`);
      }
      // 上方放不下就翻到下方 —— 但只在下方**更宽裕**时才翻：沙盘只有三百多像素高，
      // 两边都放不下是常态，这时硬翻会从"上面被切一点"变成"下面被切更多"。
      // 只在翻转时写 class，不是每帧都碰 DOM。
      const roomAbove = p.y - EDGE_PAD;
      const roomBelow = wrap.clientHeight - p.y - EDGE_PAD;
      const wantBelow = cardH > 0 && roomAbove < cardH + 22 && roomBelow > roomAbove;
      if (wantBelow !== below) {
        below = wantBelow;
        host.classList.toggle('is-below', below);
      }
    };
    raf = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(raf);
  }, [openId]);

  const located = snapshot?.located ?? 0;
  const total = snapshot?.robots.length ?? 0;
  const obj = snapshot?.objectives;

  const roleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of [...catalog.redViews, ...catalog.blueViews]) m.set(v.id, v.role);
    return m;
  }, [catalog.redViews, catalog.blueViews]);

  const open: SandboxRobot | null = openId
    ? (snapshot?.robots.find((r) => r.id === openId) ?? null)
    : null;

  const handlePin = useCallback(() => {
    if (openId) onPin(openId);
  }, [openId, onPin]);
  const handleHover = useCallback((hovering: boolean) => { frozen.current = hovering; }, []);

  return (
    <div className="sandbox" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="sandbox-canvas"
        onPointerDown={onPointerDown}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
      />
      {status !== 'ready' && (
        <div className="sandbox-cover">
          {status === 'failed' ? '沙盘加载失败' : '沙盘加载中…'}
        </div>
      )}
      {status === 'ready' && <ObjectiveBars objectives={obj ?? null} scene={sceneRef} />}
      {open && (
        <RobotPanel
          key={open.id}
          viewId={open.id}
          name={roleById.get(open.id) ?? `${open.team === 'red' ? '红方' : '蓝方'} ${open.num} 号`}
          team={open.team}
          hp={open.hp}
          maxHp={open.maxHp}
          status={open.status}
          pinned={shownIds.includes(open.id)}
          hasSelection={selected !== null}
          onPin={handlePin}
          onHoverChange={handleHover}
          hostRef={panelRef}
        />
      )}
      {/* 状态文字，不是控件带 —— 观赛体验里唯一该出现在画面上的是状态本身。
          四个战略目标血量已经钉在各自的基地/前哨上（见 ObjectiveBars），
          这里不再重复一遍：同一个数字在小小一块沙盘上出现两次纯属噪音，
          而且角落里那份还说不清哪个数对应哪座建筑。 */}
      <div className="sandbox-status">
        <span>
          定位 {located}/{total}
        </span>
        {sampleMs > 0 && <span className="dim">{sampleMs.toFixed(0)}ms/轮</span>}
        {tainted.length > 0 && <span className="warn">{tainted.length} 路取像素失败</span>}
      </div>
    </div>
  );
}
