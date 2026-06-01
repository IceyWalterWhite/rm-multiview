import { QUALITY_LABELS, type QualityLabel } from '../config';

interface Props {
  mainQuality: QualityLabel;
  multiQuality: QualityLabel;
  onMain: (q: QualityLabel) => void;
  onMulti: (q: QualityLabel) => void;
}

function Select({ value, onChange }: { value: QualityLabel; onChange: (q: QualityLabel) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as QualityLabel)}>
      {QUALITY_LABELS.map((q) => <option key={q} value={q}>{q}</option>)}
    </select>
  );
}

export function QualityControls({ mainQuality, multiQuality, onMain, onMulti }: Props) {
  return (
    <>
      <span className="pill">主视角 <Select value={mainQuality} onChange={onMain} /></span>
      <span className="pill">多视角 <Select value={multiQuality} onChange={onMulti} /></span>
    </>
  );
}
