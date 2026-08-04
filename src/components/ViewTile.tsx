import { memo, type CSSProperties } from 'react';
import type { StreamView } from '../types';
import type { QualityLabel } from '../config';
import { VideoPlayer } from './VideoPlayer';
import { srcForQuality } from '../data/streams';

interface Props {
  view: StreamView;
  quality: QualityLabel;
  /** 放大次序；null = 没放大。次序只用于层叠，让刚点开的压住正在缩回去的那一路 */
  stack: number | null;
  onToggle: (id: string) => void;
  onSignatureExpired?: () => void;
}

export const ViewTile = memo(function ViewTile({ view, quality, stack, onToggle, onSignatureExpired }: Props) {
  const enlarged = stack !== null;
  return (
    <button
      className={`view-tile ${view.side}${enlarged ? ' enlarged' : ''}`}
      // 遮挡判定要按 id 把 DOM 和机位对上（见 useEnlarged.readGeometries）
      data-view-id={view.id}
      // z 值由 CSS 从 --stack 算，层级基数留在 CSS 里不两处重复
      style={enlarged ? ({ '--stack': stack } as CSSProperties) : undefined}
      aria-pressed={enlarged}
      onClick={() => onToggle(view.id)}
      title={view.role}
    >
      <VideoPlayer src={srcForQuality(view, quality)} className="view-tile-video" onSignatureExpired={onSignatureExpired} />
    </button>
  );
});
