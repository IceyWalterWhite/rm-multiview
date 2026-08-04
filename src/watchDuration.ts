/** 秒 → 中文时长。compact 用于胶囊（不带秒，宽度不抖）。 */
export function formatWatchDuration(totalSeconds: number, compact = false): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  if (compact) return minutes > 0 ? `${minutes} 分` : '不足 1 分';
  if (minutes > 0) return `${minutes} 分 ${String(rest).padStart(2, '0')} 秒`;
  return `${rest} 秒`;
}
