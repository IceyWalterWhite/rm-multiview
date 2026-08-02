import { memo } from 'react';
import type { StreamView } from '../types';
import type { QualityLabel } from '../config';
import type { SyncEngine } from '../sync/engine';
import { ViewTile } from './ViewTile';

interface Props {
  side: 'red' | 'blue';
  views: StreamView[];
  quality: QualityLabel;
  enlargedId: string | null;
  onToggle: (id: string) => void;
  onSignatureExpired?: () => void;
  syncEngine?: SyncEngine;
}

// memo：截断弹幕批次触发的重渲染向 5 路 ViewTile/VideoPlayer 传播
export const SideColumn = memo(function SideColumn({ side, views, quality, enlargedId, onToggle, onSignatureExpired, syncEngine }: Props) {
  return (
    <div className={`side-column ${side}`}>
      {views.map((v) => (
        <ViewTile key={v.id} view={v} quality={quality} enlarged={enlargedId === v.id} onToggle={onToggle} onSignatureExpired={onSignatureExpired} syncEngine={syncEngine} />
      ))}
    </div>
  );
});
