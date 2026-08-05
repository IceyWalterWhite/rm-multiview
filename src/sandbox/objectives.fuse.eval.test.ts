import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { readObjectives, type ObjectiveHp } from './objectives';
import { loadFixtures, type FixtureFrame } from './__fixtures__/load';

/**
 * 目标血量（双方基地/前哨站）的融合策略对比 —— 用来决定值不值得加一层融合。
 *
 * 现状：读出 76%、多路一致 85.4%。这两个数字都不是终点指标 ——
 * 沙盘要的是**一条随时间演进的可信数值序列**，而不是每帧每路的读数。
 * 所以这里比的是融合之后的序列质量：
 *   - 覆盖率：有多少个时刻能给出一个值
 *   - 单调违例：回合内基地/前哨站血量只减不增（见 objectives.ts 注释），
 *     融合结果里出现上跳就一定是误读混进来了
 *
 * 三种策略：
 *   A 现状      —— 全部路（含空中）逐时刻取众数
 *   B 只用地面  —— 空中路的记分板不在同一位置，读出来的本就不该采信
 *   C B + 单调  —— 再加回合内单调约束：上跳的候选直接否掉，退而取次优候选
 */
const DIR = 'D:/rmcap/browsercap';
const available = existsSync(`${DIR}/frames.json`);
const pct = (a: number, b: number) => (b ? +((100 * a) / b).toFixed(1) : 0);

const FIELDS = ['redBase', 'redOutpost', 'blueBase', 'blueOutpost'] as const;
type Field = (typeof FIELDS)[number];

/** 这段录制在第 32 轮回合结束，之后没有 HUD；单调约束只在回合内成立，所以只取前 32 轮。 */
const ROUND_END = 32;

interface Reading {
  value: number;
  confidence: number;
}

/** 按时刻收集每个字段的所有读数。 */
function collect(frames: FixtureFrame[]): Map<Field, Map<number, Reading[]>> {
  const out = new Map<Field, Map<number, Reading[]>>(FIELDS.map((f) => [f, new Map()]));
  for (const f of frames) {
    const o = readObjectives(f.frame);
    for (const k of FIELDS) {
      const hit: ObjectiveHp | null = o[k];
      if (!hit) continue;
      const byT = out.get(k)!;
      byT.set(f.t, [...(byT.get(f.t) ?? []), { value: hit.value, confidence: hit.confidence }]);
    }
  }
  return out;
}

/**
 * 投票权重方案。
 *
 * 现网数据打脸了「众数即真值」这个假设：同一块记分板在 8 路里各自编码，
 * redBase 的真值在 3936/3946 之间来回跳（只差第三位一个数字），而
 * **3946 的置信度稳定 0.30~0.39、3936 只有 0.05~0.17** —— 糊掉那一位的路数反而更多，
 * 于是众数选中了低置信度的错答案。所以权重必须让置信度真正起作用。
 */
type Weight = (c: number) => number;
const WEIGHTS: [string, Weight][] = [
  ['等权（众数）', () => 1],
  ['1+conf', (c) => 1 + c],
  ['conf', (c) => c],
  ['conf²', (c) => c * c],
];

/** 加权投票，返回候选值按得分从高到低排序。 */
function ranked(rs: Reading[], w: Weight, floor: number): number[] {
  const score = new Map<number, number>();
  for (const r of rs) {
    if (r.confidence < floor) continue;
    score.set(r.value, (score.get(r.value) ?? 0) + w(r.confidence));
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}

/** 融合成一条时间序列。monotonic=true 时否掉相对上一个已采纳值上跳的候选。 */
function fuse(byT: Map<number, Reading[]>, w: Weight, floor: number, monotonic: boolean): Map<number, number> {
  const out = new Map<number, number>();
  let last: number | null = null;
  for (const t of [...byT.keys()].sort((a, b) => a - b)) {
    const cands = ranked(byT.get(t)!, w, floor);
    const cap: number | null = last;
    const pick: number | null =
      monotonic && cap !== null ? (cands.find((v: number) => v <= cap) ?? null) : (cands[0] ?? null);
    if (pick === null) continue;
    out.set(t, pick);
    last = pick;
  }
  return out;
}

/**
 * 全局最优的非递增序列（DP），取代贪心单调。
 *
 * 贪心的毛病是早期采纳一个偏低的误读之后，后面所有合法值都被否掉，覆盖直接塌掉。
 * 改成整段一起解：在候选值集合上选一条非递增路径，使各时刻命中的权重之和最大。
 * 时刻内没观测到的值权重记 0 —— 允许「保持上一个值」跨过读不出的时刻。
 *
 * 状态是 (时刻, 取值)，取值域是全场出现过的候选去重后降序排列，
 * 转移只允许往更小或相等的下标走，所以一遍前缀最大值就够，复杂度 O(T·V)。
 */
function fuseOptimal(byT: Map<number, Reading[]>, w: Weight, floor: number): Map<number, number> {
  const times = [...byT.keys()].sort((a, b) => a - b);
  const values = [...new Set(times.flatMap((t) => byT.get(t)!.filter((r) => r.confidence >= floor).map((r) => r.value)))]
    .sort((a, b) => b - a); // 降序：下标越大值越小
  if (values.length === 0) return new Map();

  const V = values.length;
  const idx = new Map(values.map((v, i) => [v, i]));
  // score[t][i] = t 时刻取 values[i] 能拿到的权重
  const score = times.map((t) => {
    const row = new Array(V).fill(0);
    for (const r of byT.get(t)!) {
      if (r.confidence < floor) continue;
      row[idx.get(r.value)!] += w(r.confidence);
    }
    return row;
  });

  const best = score[0].slice();
  const from: number[][] = [new Array(V).fill(-1)];
  for (let t = 1; t < times.length; t++) {
    // 非递增 = 下标只能不减。prefix[i] = max(best[0..i])，并记住取到最大的那个下标
    const prefix = new Array(V).fill(-Infinity);
    const prefixArg = new Array(V).fill(-1);
    let run = -Infinity;
    let runArg = -1;
    for (let i = 0; i < V; i++) {
      if (best[i] > run) { run = best[i]; runArg = i; }
      prefix[i] = run;
      prefixArg[i] = runArg;
    }
    const next = new Array(V).fill(0);
    const back = new Array(V).fill(-1);
    for (let i = 0; i < V; i++) {
      next[i] = prefix[i] + score[t][i];
      back[i] = prefixArg[i];
    }
    for (let i = 0; i < V; i++) best[i] = next[i];
    from.push(back);
  }

  let cur = best.indexOf(Math.max(...best));
  const out = new Map<number, number>();
  for (let t = times.length - 1; t >= 0; t--) {
    out.set(times[t], values[cur]);
    cur = from[t][cur] >= 0 ? from[t][cur] : cur;
  }
  return out;
}

/**
 * 在线版：只能看见到当前为止的数据，实时链路只能用这种。
 *
 * DP 要整段数据才能解，实时拿不到未来。在线版靠两条规则逼近它：
 *   1. 只往下走 —— 战略目标回合内不回血，上跳一律是误读；
 *   2. 下降要连续两个时刻都指向同一个更低值才采纳。
 * 第 2 条是贪心版塌掉的解药：贪心被单帧误读拽到低位就再也回不来，
 * 要求连续确认之后，单帧误读翻不动它。
 */
function fuseOnline(byT: Map<number, Reading[]>, w: Weight, floor: number, confirm = 2): Map<number, number> {
  const out = new Map<number, number>();
  let cur: number | null = null;
  let pending: { value: number; count: number } | null = null;
  for (const t of [...byT.keys()].sort((a, b) => a - b)) {
    const top = ranked(byT.get(t)!, w, floor)[0];
    if (top === undefined) {
      if (cur !== null) out.set(t, cur);
      continue;
    }
    if (cur === null) {
      cur = top;
    } else if (top < cur) {
      pending = pending && pending.value === top ? { value: top, count: pending.count + 1 } : { value: top, count: 1 };
      if (pending.count >= confirm) {
        cur = top;
        pending = null;
      }
    } else {
      pending = null; // 上跳或持平，撤销半路的下降候选
    }
    out.set(t, cur);
  }
  return out;
}

/** 序列里有多少次相对前一个采纳值上跳。 */
function violations(series: Map<number, number>): number {
  let bad = 0;
  let prev: number | null = null;
  for (const t of [...series.keys()].sort((a, b) => a - b)) {
    const v = series.get(t)!;
    if (prev !== null && v > prev) bad++;
    prev = v;
  }
  return bad;
}

/**
 * 序列里数值改变了几次。
 *
 * 战略目标的血量是阶梯下降的 —— 挨一次打掉一截，其余时间恒定。所以在没有
 * 真实掉血的时段，变化次数越少越好；抖动全部来自误读。它和「单调违例」互补：
 * 违例只抓上跳，抖动还能抓到「跌下去又跌回来」这种一上一下抵消掉的误读。
 */
function changes(series: Map<number, number>): number {
  let n = 0;
  let prev: number | null = null;
  for (const t of [...series.keys()].sort((a, b) => a - b)) {
    const v = series.get(t)!;
    if (prev !== null && v !== prev) n++;
    prev = v;
  }
  return n;
}

describe.skipIf(!available)('目标血量的融合策略', () => {
  it('只用地面 + 回合内单调，能把序列质量提到什么程度', () => {
    const all = loadFixtures(DIR).filter((f) => f.t < ROUND_END);
    const ground = all.filter((f) => !f.stream.includes('空中'));
    const times = new Set(all.map((f) => f.t)).size;

    // 读出率：分母是「每帧每字段各算一次尝试」
    const readRate = (fs: FixtureFrame[]) => {
      let read = 0;
      let tried = 0;
      for (const f of fs) {
        const o = readObjectives(f.frame);
        for (const k of FIELDS) {
          tried++;
          if (o[k]) read++;
        }
      }
      return pct(read, tried);
    };

    const dataAll = collect(all);
    const dataGround = collect(ground);
    const lines: string[] = [
      `  读出率：全部路 ${readRate(all)}%   只算地面 ${readRate(ground)}%   （时刻数 ${times}）`,
      '  权重           置信度下限  数据源   覆盖    单调违例  数值抖动',
    ];
    const summary = new Map<string, { cover: number; bad: number; jitter: number }>();

    const run = (name: string, data: Map<Field, Map<number, Reading[]>>, w: Weight, floor: number, mono: boolean) => {
      let cover = 0;
      let bad = 0;
      let jitter = 0;
      for (const k of FIELDS) {
        const s = fuse(data.get(k)!, w, floor, mono);
        cover += s.size;
        bad += violations(s);
        jitter += changes(s);
      }
      summary.set(name, { cover, bad, jitter });
      return `  ${name.padEnd(30)} 覆盖 ${String(pct(cover, times * 4)).padStart(5)}%   ` +
        `${String(bad).padStart(3)}      ${String(jitter).padStart(3)}`;
    };

    for (const [wn, w] of WEIGHTS) lines.push(run(`${wn} / 无下限 / 全部路`, dataAll, w, 0, false));
    lines.push('');
    for (const [wn, w] of WEIGHTS) lines.push(run(`${wn} / conf≥0.05 / 地面`, dataGround, w, 0.05, false));
    lines.push('');
    lines.push(run('conf² / conf≥0.05 / 地面 + 贪心单调', dataGround, (c) => c * c, 0.05, true));

    // DP：整段一起解最优非递增序列
    {
      let cover = 0;
      let bad = 0;
      let jitter = 0;
      for (const k of FIELDS) {
        const s = fuseOptimal(dataGround.get(k)!, (c) => c * c, 0.05);
        cover += s.size;
        bad += violations(s);
        jitter += changes(s);
      }
      summary.set('DP', { cover, bad, jitter });
      lines.push(
        `  ${'conf² / conf≥0.05 / 地面 + DP最优（离线）'.padEnd(30)} 覆盖 ${String(pct(cover, times * 4)).padStart(5)}%   ` +
          `${String(bad).padStart(3)}      ${String(jitter).padStart(3)}`,
      );
    }

    // 在线版：实时链路只能用这种
    for (const confirm of [1, 2, 3]) {
      let cover = 0;
      let bad = 0;
      let jitter = 0;
      for (const k of FIELDS) {
        const s = fuseOnline(dataGround.get(k)!, (c) => c * c, 0.05, confirm);
        cover += s.size;
        bad += violations(s);
        jitter += changes(s);
      }
      summary.set(`online${confirm}`, { cover, bad, jitter });
      lines.push(
        `  ${`conf² / conf≥0.05 / 地面 + 在线(确认${confirm}次)`.padEnd(30)} 覆盖 ${String(pct(cover, times * 4)).padStart(5)}%   ` +
          `${String(bad).padStart(3)}      ${String(jitter).padStart(3)}`,
      );
    }

    console.log('\n[目标血量融合对比]\n' + lines.join('\n'));

    const base = summary.get('等权（众数） / 无下限 / 全部路')!;
    const weighted = summary.get('conf² / conf≥0.05 / 地面')!;
    const dp = summary.get('DP')!;
    // 置信度加权必须至少压住抖动，否则不值得加这层
    expect(weighted.jitter).toBeLessThan(base.jitter);
    // DP 的意义：拿到单调性的同时不牺牲覆盖（贪心会塌到 78%）
    expect(dp.bad).toBe(0);
    expect(dp.cover).toBe(base.cover);
    expect(dp.jitter).toBeLessThan(weighted.jitter);
    // 真正要落地的是在线版 —— 实时链路看不到未来。确认 2 次即可追平离线最优。
    const online = summary.get('online2')!;
    expect(online.bad).toBe(0);
    expect(online.cover).toBe(base.cover);
    expect(online.jitter).toBe(dp.jitter);
  }, 600_000);
});
