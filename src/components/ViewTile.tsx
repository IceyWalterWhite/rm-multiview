import { memo } from 'react';
import type { StreamView } from '../types';
import type { QualityLabel } from '../config';
import { VideoPlayer } from './VideoPlayer';
import { srcForQuality } from '../data/streams';

interface Props {
  view: StreamView;
  quality: QualityLabel;
  enlarged: boolean;
  onToggle: (id: string) => void;
  onSignatureExpired?: () => void;
}

export const ViewTile = memo(function ViewTile({ view, quality, enlarged, onToggle, onSignatureExpired }: Props) {
  return (
    <button
      className={`view-tile ${view.side}${enlarged ? ' enlarged' : ''}`}
      onClick={() => onToggle(view.id)}
      title={view.role}
    >
      <VideoPlayer src={srcForQuality(view, quality)} className="view-tile-video" onSignatureExpired={onSignatureExpired} />
    </button>
  );
});
