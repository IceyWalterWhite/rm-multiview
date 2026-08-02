import { memo } from 'react';

interface Props {
  on: boolean;
  onToggle: () => void;
}

// 时码同步开关（样式在 UI 设计阶段随 apple-design 重做，这里先保证行为与可及性）
export const SyncToggle = memo(function SyncToggle({ on, onToggle }: Props) {
  return (
    <button
      className={`sync-toggle${on ? ' active' : ''}`}
      aria-pressed={on}
      onClick={onToggle}
      title={on ? '关闭时码同步' : '开启时码同步'}
    >
      时码同步
    </button>
  );
});
