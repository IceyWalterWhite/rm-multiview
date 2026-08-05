import { useCallback, useEffect, useRef, useState } from 'react';
import type { ZoneCatalog } from '../types';
import { SANDBOX_FIELD_GLB } from '../config';
import { useSandbox } from '../hooks/useSandbox';
import type { SandboxSnapshot } from '../sandbox/fleet';
import type { SandboxScene } from '../sandbox/render/scene';

/**
 * 3D 沙盘。
 *
 * 位置在第二屏（社区工具区），不在观赛屏上 —— 观赛屏不放平铺控件带。
 *
 * **只在滚进视口后才开工。** 场地模型 7.6 MiB，加上十路取像素与检测，
 * 对没打算看沙盘的观众是纯粹的浪费。three.js 与场景代码也是这时才动态 import，
 * 不进首屏包（首屏包目前 219 KB，three 一个人就有它三倍大）。
 */

interface Props {
  catalog: ZoneCatalog;
}

export function SandboxMap({ catalog }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<SandboxScene | null>(null);
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');

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

  // 位姿直达渲染层，不进 React state —— 3 Hz 重渲染整棵树没有必要
  const onSnapshot = useCallback((s: SandboxSnapshot) => {
    sceneRef.current?.update(s.robots);
    // 开发期把最新快照挂到 window 上：视觉识别的问题在截图上看不出来
    // （两台车叠在一起、坐标差一两米、朝向反了都长得很像「对的」），
    // 必须能把数字拿出来核对。生产构建里这行会被 DCE 掉。
    if (import.meta.env.DEV) {
      (window as unknown as { __rmSandbox?: SandboxSnapshot }).__rmSandbox = s;
    }
  }, []);
  const { snapshot, sampleMs, tainted } = useSandbox(catalog, visible, onSnapshot);

  const located = snapshot?.located ?? 0;
  const total = snapshot?.robots.length ?? 0;
  const obj = snapshot?.objectives;

  return (
    <div className="sandbox" ref={wrapRef}>
      <canvas ref={canvasRef} className="sandbox-canvas" />
      {status !== 'ready' && (
        <div className="sandbox-cover">
          {status === 'failed' ? '沙盘加载失败' : '沙盘加载中…'}
        </div>
      )}
      {/* 状态文字，不是控件带 —— 观赛体验里唯一该出现在画面上的是状态本身 */}
      <div className="sandbox-status">
        <span>
          定位 {located}/{total}
        </span>
        {obj && (obj.redBase !== null || obj.blueBase !== null) && (
          <span>
            基地 <b className="red">{obj.redBase ?? '—'}</b> ·{' '}
            <b className="blue">{obj.blueBase ?? '—'}</b>
          </span>
        )}
        {obj && (obj.redOutpost !== null || obj.blueOutpost !== null) && (
          <span>
            前哨 <b className="red">{obj.redOutpost ?? '—'}</b> ·{' '}
            <b className="blue">{obj.blueOutpost ?? '—'}</b>
          </span>
        )}
        {sampleMs > 0 && <span className="dim">{sampleMs.toFixed(0)}ms/轮</span>}
        {tainted.length > 0 && <span className="warn">{tainted.length} 路取像素失败</span>}
      </div>
    </div>
  );
}
