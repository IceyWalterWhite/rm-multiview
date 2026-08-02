import { memo } from 'react';
import type { StreamView } from '../types';
import type { QualityLabel } from '../config';
import type { SyncEngine } from '../sync/engine';
import { VideoPlayer } from './VideoPlayer';
import { SyncBadge } from './SyncBadge';
import { sourceForQuality } from '../data/streams';

interface Props {
  view: StreamView;
  quality: QualityLabel;
  enlarged: boolean;
  onToggle: (id: string) => void;
  onSignatureExpired?: () => void;
  syncEngine?: SyncEngine;
}

export const ViewTile = memo(function ViewTile({ view, quality, enlarged, onToggle, onSignatureExpired, syncEngine }: Props) {
  const source = sourceForQuality(view, quality); // tier 按实际源的 label（缺档回退时 ≠ quality）
  return (
    <button
      className={`view-tile ${view.side}${enlarged ? ' enlarged' : ''}`}
      onClick={() => onToggle(view.id)}
      title={view.role}
    >
      <VideoPlayer
        src={source?.src}
        className="view-tile-video"
        onSignatureExpired={onSignatureExpired}
        syncEngine={syncEngine}
        syncId={view.id}
        syncTier={source?.label ?? quality}
      />
      {syncEngine && <SyncBadge source={syncEngine} id={view.id} />}
    </button>
  );
});
