import { useEffect, useRef, useState } from 'react';
import type { Danmaku, Profile, ZoneCatalog } from '../types';
import type { QualityLabel } from '../config';
import { SideColumn } from './SideColumn';
import { MainStage } from './MainStage';
import { QualityControls } from './QualityControls';
import { DanmakuComposer } from './DanmakuComposer';

interface Props {
  catalog: ZoneCatalog;
  messages: Danmaku[];
  mainQuality: QualityLabel;
  multiQuality: QualityLabel;
  setMainQuality: (q: QualityLabel) => void;
  setMultiQuality: (q: QualityLabel) => void;
  profile: Profile;
  isComplete: boolean;
  onSend: (text: string) => Promise<void> | void;
  onEditIdentity: () => void;
  onSignatureExpired?: () => void;
}

export function LiveStage(p: Props) {
  // 红、蓝各自独立的放大状态：两侧可同时各放大一个
  const [enlargedRed, setEnlargedRed] = useState<string | null>(null);
  const [enlargedBlue, setEnlargedBlue] = useState<string | null>(null);
  const [tooNarrow, setTooNarrow] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const toggleRed = (id: string) => setEnlargedRed((cur) => (cur === id ? null : id));
  const toggleBlue = (id: string) => setEnlargedBlue((cur) => (cur === id ? null : id));

  // 主视角宽度 < 侧列宽度（窗口太窄到看不清）→ 盖「请在大屏幕上观看」遮罩
  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === 'undefined') return;
    const check = () => {
      const side = row.querySelector<HTMLElement>('.side-column');
      const main = row.querySelector<HTMLElement>('.main-stage');
      if (side && main) setTooNarrow(main.clientWidth < side.clientWidth);
    };
    const ro = new ResizeObserver(check);
    ro.observe(row);
    check();
    return () => ro.disconnect();
  }, []);

  return (
    <section className="live-stage">
      <div className="stage-row" ref={rowRef}>
        <SideColumn side="red" views={p.catalog.redViews} quality={p.multiQuality} enlargedId={enlargedRed} onToggle={toggleRed} onSignatureExpired={p.onSignatureExpired} />
        <MainStage main={p.catalog.main} quality={p.mainQuality} messages={p.messages} onSignatureExpired={p.onSignatureExpired} />
        <SideColumn side="blue" views={p.catalog.blueViews} quality={p.multiQuality} enlargedId={enlargedBlue} onToggle={toggleBlue} onSignatureExpired={p.onSignatureExpired} />
        {tooNarrow && <div className="stage-cover">请在大屏幕上观看</div>}
      </div>
      <div className="controls">
        <QualityControls mainQuality={p.mainQuality} multiQuality={p.multiQuality} onMain={p.setMainQuality} onMulti={p.setMultiQuality} />
        <DanmakuComposer profile={p.profile} isComplete={p.isComplete} onSend={p.onSend} onEditIdentity={p.onEditIdentity} />
        <span className="hint">点机位放大，再点缩回</span>
      </div>
    </section>
  );
}
