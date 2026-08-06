import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import type { Danmaku, Profile, ZoneCatalog } from '../types';
import type { QualityLabel } from '../config';
import { SideColumn } from './SideColumn';
import { MainStage } from './MainStage';
import { QualityMenu } from './QualityMenu';
import { DanmakuComposer } from './DanmakuComposer';
import { LayoutMenu, type StageLayout } from './LayoutMenu';
import { StageGrid } from './StageGrid';
import { useMatchTitle } from '../hooks/useMatchTitle';
import { useEnlarged } from '../hooks/useEnlarged';
import { prefersReducedMotion } from '../a11y';
import { SyncEngine } from '../sync/engine';
import { AudioCalibrator, createAdtsDecoder } from '../sync/audioCalib';
import { demuxAudio } from '../sync/tsDemux';
import { parseFragName } from '../sync/nameClock';
import { reconcile, swap } from '../stage/viewOrder';

const SYNC_PREF_KEY = 'rm.timecodeSync';
const TRIM_KEY = 'rm.sync.trim';
const LAYOUT_KEY = 'rm.stageLayout';

/**
 * 沙盘只在 grid 布局下才渲染，所以整个模块（含 three.js 与 7.6 MiB 场地）
 * 挂在这个懒加载边界后面。默认布局 wings 一个字节都不下。
 */
const SandboxMap = lazy(() => import('./SandboxMap').then((m) => ({ default: m.SandboxMap })));

interface Props {
  catalog: ZoneCatalog;
  messages: Danmaku[];
  danmakuEnabled: boolean;
  cheerSlot?: ReactNode;
  watchTaskSlot?: ReactNode;
  mainQuality: QualityLabel;
  multiQuality: QualityLabel;
  setMainQuality: (q: QualityLabel) => void;
  setMultiQuality: (q: QualityLabel) => void;
  profile: Profile;
  isComplete: boolean;
  onSend: (text: string) => Promise<void> | void;
  onEditIdentity: () => void;
  onSignatureExpired?: () => void;
  onMainPlayingChange?: (playing: boolean) => void;
}

export function LiveStage(p: Props) {
  const [tooNarrow, setTooNarrow] = useState(false);
  const [danmakuOn, setDanmakuOn] = useState(true);
  const rowRef = useRef<HTMLDivElement>(null);
  // 多路放大：互不遮挡的机位可以同时开着，会被挤到的那一路自动缩回去。
  // toggle/clear 引用稳定，才不会击穿 SideColumn 的 memo（弹幕批次不该重渲染 11 路机位）
  const { stacks, toggle, clear } = useEnlarged(rowRef);
  const matchTitle = useMatchTitle(p.catalog.zoneName);

  // 舞台布局：wings（三栏，默认）/ grid（主视角 + 网格 + 沙盘）
  const [layout, setLayout] = useState<StageLayout>(
    () => (localStorage.getItem(LAYOUT_KEY) === 'grid' ? 'grid' : 'wings'),
  );
  useEffect(() => { localStorage.setItem(LAYOUT_KEY, layout); }, [layout]);

  // grid 的十路显示顺序。state 里只存「用户排过的次序」，实际顺序在渲染期由它
  // 与最新名单现算 —— 不用 effect 去同步，于是不存在过期值，也没有级联渲染。
  //
  // 名单用字符串 key 而非数组身份判等：useCatalog 在 HLS 签名过期时会重取并产出
  // 内容相同的新数组，而签名过期在一场比赛里会反复发生。按身份重建的话，
  // 用户拖好的排布会被反复清零。
  const allViews = useMemo(
    () => [...p.catalog.redViews, ...p.catalog.blueViews],
    [p.catalog.redViews, p.catalog.blueViews],
  );
  const rosterKey = allViews.map((v) => v.id).join('|');
  const roster = useMemo(() => rosterKey.split('|').filter(Boolean), [rosterKey]);
  const [userOrder, setUserOrder] = useState<string[]>([]);
  const order = useMemo(() => reconcile(userOrder, roster), [userOrder, roster]);
  const [selected, setSelected] = useState<string | null>(null);

  // 「固定到上方」：把沙盘点到的那一路与用户选中的格子对调。
  // 换完就清掉选中 —— 那一格已经被这次替换消费了，留着会让下一次替换换到
  // 一个已经不在原位的目标上（选中存的是路，不是格位）。
  const pinToGrid = useCallback((viewId: string) => {
    setUserOrder((cur) => {
      const list = reconcile(cur, roster);
      const a = list.indexOf(viewId);
      const b = selected ? list.indexOf(selected) : -1;
      return a === -1 || b === -1 ? cur : swap(list, a, b);
    });
    setSelected(null);
  }, [roster, selected]);

  // 时码同步引擎：单例、引用稳定（memo 安全）；开关默认开，偏好入 localStorage
  // useState 的惰性初始化而非 useRef 懒建：同样只构造一次、引用同样稳定，
  // 但不必在渲染期读写 ref（那会踩 react-hooks 的 refs-during-render）
  const [syncEngine] = useState(() => new SyncEngine());
  // 音频校准器：吃 fLoader tee 下来的分片字节，比赛时测各路 δ 的 view 常量
  const [calibrator] = useState(() => new AudioCalibrator(syncEngine, { decode: createAdtsDecoder() }));
  const [syncOn, setSyncOn] = useState(() => localStorage.getItem(SYNC_PREF_KEY) !== 'off');
  const toggleSync = useCallback(() => setSyncOn((v) => !v), []);
  const [syncTrim, setSyncTrim] = useState(() => {
    const v = parseFloat(localStorage.getItem(TRIM_KEY) ?? '0');
    return Number.isFinite(v) ? Math.max(-5, Math.min(5, v)) : 0;
  });
  const handleTrim = useCallback((sec: number) => setSyncTrim(sec), []);
  useEffect(() => {
    syncEngine.setTrim(syncTrim);
    localStorage.setItem(TRIM_KEY, String(syncTrim));
  }, [syncEngine, syncTrim]);
  useEffect(() => {
    syncEngine.setEnabled(syncOn);
    if (syncOn) {
      syncEngine.start();
      // 分片字节 → demux 音频 + 分片名 → 校准缓冲（demux 数 ms/片，主线程可承受）
      syncEngine.setByteSink((id, bytes, url, handle) => {
        const name = parseFragName(url);
        if (!name) return;
        const d = demuxAudio(new Uint8Array(bytes));
        if (d.frameCount === 0 || d.firstAudioPts === null || d.firstVideoPts === null) return;
        calibrator.ingest(id, handle, {
          nameSec: name.wallSec,
          firstAudioPts: d.firstAudioPts,
          firstVideoPts: d.firstVideoPts,
          adts: d.adts,
          sampleRate: d.sampleRate,
          frameCount: d.frameCount,
        });
      });
      calibrator.start();
    } else {
      syncEngine.stop();
      syncEngine.setByteSink(null);
      calibrator.stop();
    }
    localStorage.setItem(SYNC_PREF_KEY, syncOn ? 'on' : 'off');
  }, [syncEngine, calibrator, syncOn]);
  useEffect(
    () => () => {
      syncEngine.stop();
      calibrator.stop();
    },
    [syncEngine, calibrator],
  );
  // 本地验收/调试句柄（仅 dev 构建）：console 里可手动触发校准、读各路状态
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    void import('../sync/xcorr').then(({ crossCorrelate }) => {
      (window as unknown as Record<string, unknown>).__rmSync = { engine: syncEngine, calibrator, crossCorrelate };
    });
    return () => {
      delete (window as unknown as Record<string, unknown>).__rmSync;
    };
  }, [syncEngine, calibrator]);

  // Esc 收起全部放大的机位（wayfinding：任何状态都要有键盘退路）。
  // 对话框开着时 Esc 属于对话框（原生 cancel），不越权抢收
  const hasEnlarged = stacks.size > 0;
  useEffect(() => {
    if (!hasEnlarged) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      clear();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasEnlarged, clear]); // 依赖布尔而非 stacks 本身：多路开关不必反复重绑监听

  // 底栏挤不挤得下由实测决定，不猜阈值 —— 一行还是两行、有没有弹幕、
  // 观看胶囊是「500 弹丸 · 8 分」还是「登录领弹丸」，都在改占位。
  const ctlRowRef = useRef<HTMLDivElement>(null);
  const measuring = useRef(false);
  const [tightBar, setTightBar] = useState(false);
  // 与 theme.css 的 740px 断点是同一个数：那条注释说明了为什么是它
  const [narrowBar, setNarrowBar] = useState(
    () => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 740px)').matches,
  );
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const mq = matchMedia('(max-width: 740px)');
    const sync = () => setNarrowBar(mq.matches);
    mq.addEventListener('change', sync);
    sync();
    return () => mq.removeEventListener('change', sync);
  }, []);
  useEffect(() => {
    const el = ctlRowRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      if (measuring.current) return;
      measuring.current = true;
      try {
        // 判据只有一条：**把路标写全之后这一行会不会溢出**。所以必须在写全的状态下量。
        //
        // 别再想着「算还剩多少富余」—— 这一行里总有个吃掉全部富余的元素：
        // 经典布局是 flex:1 的发送条，沙盘布局是带 margin-left:auto 的尾部。
        // 两种情况下 scrollWidth 都恒等于 clientWidth，富余永远算成 0，
        // 于是一旦收起就再也展不开（这个坑我踩了两次，换个元素又是一次）。
        flushSync(() => setTightBar(false));
        if (el.scrollWidth > el.clientWidth + 1) flushSync(() => setTightBar(true));
      } finally {
        measuring.current = false;
      }
    };
    // 不在这里同步 measure 一次：effect 体内 flushSync 会被 React 警告。
    // ResizeObserver 在 observe 后本来就会回调一次，首帧由它兜。
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout, p.danmakuEnabled]);

  // 主视角宽度 < 侧列宽度（窗口太窄到看不清）→ 盖「请在大屏幕上观看」遮罩
  // 同时从 CSS 读取 .side-column 的真实 gap，动态设 --side-col-w 使 5 个 16:9 机位精确填满行高
  //
  // 依赖 layout 不能省：切到沙盘布局时 .stage-row 整个被卸载，写在它 style 上的
  // --side-col-w 随之丢失；切回来是**新的** DOM 节点，effect 不重跑就没人再设这个变量，
  // 侧列退回 CSS 兜底宽度 —— 表现就是「切回经典布局后机位错位」。
  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === 'undefined') return;
    const check = () => {
      const side = row.querySelector<HTMLElement>('.side-column');
      const main = row.querySelector<HTMLElement>('.main-stage');
      // 从 CSS computed style 读取真实 gap，CSS 是唯一真相源
      const rawGap = side ? parseFloat(getComputedStyle(side).rowGap) : NaN;
      const gapPx = Number.isFinite(rawGap) ? rawGap : 6;
      const totalGap = gapPx * 4; // 5 个机位之间有 4 条 gap
      // colW * 9/16 * 5 + totalGap = rowH  →  colW = (rowH - totalGap) * 16/45
      const colW = (row.clientHeight - totalGap) * 16 / 45;
      row.style.setProperty('--side-col-w', String(Math.max(0, colW)) + 'px');
      if (side && main) setTooNarrow(main.clientWidth < side.clientWidth);
    };
    const ro = new ResizeObserver(check);
    ro.observe(row);
    check();
    return () => ro.disconnect();
  }, [layout]);

  const scrollToCommunity = (e: MouseEvent) => {
    e.preventDefault();
    document.getElementById('community')?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };

  const mainStage = (
    <MainStage main={p.catalog.main} quality={p.mainQuality} titleFallback={`${p.catalog.zoneName} · 主视角`} matchTitle={matchTitle} messages={p.messages} showDanmaku={danmakuOn} cheerSlot={p.cheerSlot} onSignatureExpired={p.onSignatureExpired} onPlayingChange={p.onMainPlayingChange} syncEngine={syncEngine} syncOn={syncOn} onToggleSync={toggleSync} syncTrim={syncTrim} onSyncTrim={handleTrim} />
  );

  // B 站式：弹幕开关放输入条内（同一个框），避免两个不等高的框并排
  const composer = p.danmakuEnabled ? (
    <DanmakuComposer
      profile={p.profile}
      isComplete={p.isComplete}
      onSend={p.onSend}
      onEditIdentity={p.onEditIdentity}
      leading={<button className={`dm-toggle${danmakuOn ? ' active' : ''}`} onClick={() => setDanmakuOn((v) => !v)} aria-pressed={danmakuOn} title={danmakuOn ? '关闭弹幕' : '开启弹幕'}>弹幕</button>}
    />
  ) : null;

  // 经典布局底栏占整幅宽度，一行放得下；沙盘布局的底栏只占左半边，
  // 挤成一行会把发送条压到几个字宽，所以那边才分两行。
  //
  // 740px 以下经典布局也退回两行 —— 这是 main 上就有的断点（原先靠 flex-wrap +
  // `.composer--bar{flex-basis:100%}` 实现）：再窄下去输入框会被压到 100px 以内，
  // 与其放任 flex 自行换行，不如明确堆成两行。路标缩成 👇 只够买回 ~90px，救不了这一档。
  const oneRow = layout === 'wings' && !narrowBar;
  const controls = (
    <div className="controls">
      <div className="controls__row" ref={ctlRowRef}>
        <QualityMenu mainQuality={p.mainQuality} multiQuality={p.multiQuality} onMain={p.setMainQuality} onMulti={p.setMultiQuality} />
        <LayoutMenu value={layout} onChange={setLayout} />
        {oneRow && composer}
        <div className="controls__tail">
          {p.watchTaskSlot}
          {/* 第二屏路标：没有它，恰好占满一屏的首屏看不出下面还有内容。
              挤不下就只留 👇 —— 路标可以变短，发送条不能被挤没 */}
          <a className="scroll-hint" href="#community" onClick={scrollToCommunity} title="下滑查看社区工具">
            {!tightBar && <span className="scroll-hint__text">下滑查看社区工具</span>}
            <span aria-hidden="true">👇</span>
            {tightBar && <span className="sr-only">下滑查看社区工具</span>}
          </a>
        </div>
      </div>
      {!oneRow && composer}
    </div>
  );

  if (layout === 'grid') {
    return (
      <section className="live-stage" aria-label="直播视角">
        <StageGrid
          views={allViews}
          order={order}
          onReorder={setUserOrder}
          selected={selected}
          onSelect={setSelected}
          quality={p.multiQuality}
          onSignatureExpired={p.onSignatureExpired}
          syncEngine={syncEngine}
          mainSlot={<>{mainStage}{controls}</>}
          sandboxSlot={(shown) => (
            <Suspense fallback={<div className="sandbox"><div className="sandbox-cover">沙盘加载中…</div></div>}>
              <SandboxMap catalog={p.catalog} shownIds={shown} selected={selected} onPin={pinToGrid} />
            </Suspense>
          )}
        />
      </section>
    );
  }

  return (
    <section className="live-stage" aria-label="直播视角">
      <div className="stage-row" ref={rowRef}>
        <SideColumn side="red" views={p.catalog.redViews} quality={p.multiQuality} stacks={stacks} onToggle={toggle} onSignatureExpired={p.onSignatureExpired} syncEngine={syncEngine} />
        {mainStage}
        <SideColumn side="blue" views={p.catalog.blueViews} quality={p.multiQuality} stacks={stacks} onToggle={toggle} onSignatureExpired={p.onSignatureExpired} syncEngine={syncEngine} />
        {tooNarrow && <div className="stage-cover">请在大屏幕上观看</div>}
      </div>
      {controls}
    </section>
  );
}
