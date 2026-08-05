/**
 * grid 布局里十路机位的显示顺序。
 *
 * 「固定到上方」（沙盘上把某路换到可见区）与「拖动重排」（像手机桌面挪图标）
 * 是同一份顺序的两条写入路径，所以都收在这里：纯函数、可单测，组件只管调用。
 *
 * 顺序里存的是 `StreamView.id`，与 `SandboxRobot.id` 是同一个值 ——
 * 沙盘点到哪台机器人，就能直接定位到它在网格里的下标。
 */

function inRange(i: number, len: number): boolean {
  return Number.isInteger(i) && i >= 0 && i < len;
}

/**
 * 交换两个位置。
 *
 * 「固定到上方」走这条：把目标路与用户选中的格子对调，于是目标路进了可见区、
 * 原本占着那格的路退到它原来的位置。用交换而非插入，是因为可见格子数固定，
 * 插入会把末尾的路挤出可见区，产生用户没要求的第二处变化。
 */
export function swap<T>(order: readonly T[], a: number, b: number): T[] {
  const next = [...order];
  if (!inRange(a, next.length) || !inRange(b, next.length) || a === b) return next;
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}

/**
 * 把 `from` 处的元素挪到 `to` 处，其余顺移。
 *
 * 拖动重排走这条 —— 手机桌面图标就是这个语义：拖住一个往前插，沿途的图标
 * 依次让位，而不是和落点那个对调。
 */
export function move<T>(order: readonly T[], from: number, to: number): T[] {
  const next = [...order];
  if (!inRange(from, next.length) || !inRange(to, next.length) || from === to) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * 用最新名单校正顺序，尽量保留用户排好的次序。
 *
 * `useCatalog` 在 HLS 签名过期时会重取并产出**内容相同的新数组**，而签名过期
 * 在一场比赛里会反复发生。若按数组身份重置顺序，用户拖好的排布会被反复清掉 ——
 * 所以这里只按 id 集合的差异增删：留下的保持原次序，新增的接在末尾。
 */
export function reconcile(current: readonly string[], roster: readonly string[]): string[] {
  const live = new Set(roster);
  const kept = current.filter((id) => live.has(id));
  const seen = new Set(kept);
  return [...kept, ...roster.filter((id) => !seen.has(id))];
}
