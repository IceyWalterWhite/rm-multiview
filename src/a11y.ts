// 动效可及性：smooth 滚动等"锦上添花"的运动在用户声明减少动效时应退为瞬时
export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
