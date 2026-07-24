import { memo } from 'react';
import { QUALITY_LABELS, type QualityLabel } from '../config';

interface Props {
  mainQuality: QualityLabel;
  multiQuality: QualityLabel;
  onMain: (q: QualityLabel) => void;
  onMulti: (q: QualityLabel) => void;
}

function Select({ value, onChange, label }: { value: QualityLabel; onChange: (q: QualityLabel) => void; label: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as QualityLabel)} aria-label={label}>
      {QUALITY_LABELS.map((q) => <option key={q} value={q}>{q}</option>)}
    </select>
  );
}

export const QualityControls = memo(function QualityControls({ mainQuality, multiQuality, onMain, onMulti }: Props) {
  return (
    <>
      <span className="pill">主视角 <Select value={mainQuality} onChange={onMain} label="主视角画质" /></span>
      <span className="pill">多视角 <Select value={multiQuality} onChange={onMulti} label="多视角画质" /></span>
    </>
  );
});
