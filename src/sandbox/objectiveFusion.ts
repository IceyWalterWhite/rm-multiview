import type { Objectives } from './objectives';

/**
 * 战略目标血量的多路融合。
 *
 * 四个数字（双方基地 / 前哨站）长在**十路共享的同一条记分板**上，所以同一时刻能拿到
 * 至多十份读数。问题不是读不出来 —— 地面路读出率实测 100% —— 而是**投票投错**：
 * 真值与误读常常只差一位数字（实测 3946 vs 3936），糊掉那一位的路数反而更多，
 * 等权众数会稳稳地选中错的那个。
 *
 * ## 关键结构：十份读数**不是十个独立样本**
 *
 * 它们是同一块像素的十份转码副本。源头数字一旦糊，十路会**同时朝同一个方向读错** ——
 * 现网实测（browsercap 420 帧）逐时刻原始读数：
 *
 *     t=6   3936@.14  3946@.38  3946@.32  3936@.09  3936@.09  3936@.05  3936@.05  3946@.25
 *     t=7   3936@.14  3936@.09  3936@.09  3936@.09  3936@.09  3936@.09  3936@.05  3936@.11  ← 八路全错
 *     t=8   3936@.06  3936@.09  3936@.09  3936@.09  3936@.09  3936@.09  3936@.05  3936@.11  ← 连续
 *     t=9   3936@.06  3936@.09  3936@.09  3936@.09  3936@.09  3936@.09  3936@.05  3936@.11  ← 三拍
 *     t=10  3936@.08  3936@.09  3936@.09  3946@.32  3936@.10  3936@.09  3946@.34  3936@.11
 *
 * 所以**跨路投票几乎不提供保护**，「连续确认 N 拍」也不提供 —— 相关性误差本就连续。
 * 而单调约束会让这个错误**不可恢复**：一旦锁到 3936，后面所有 3946 都成了「上跳」。
 *
 * 真正把真值与误读分开的是**置信度量级**，四个字段一致（全场统计）：
 *
 *     redBase      3936 n=124 conf≤0.19   │ **3946 n=86  conf 0.13~0.39 (p50 0.34)**
 *     blueBase     4965 n= 90 conf≤0.22   │ **5000 n=94  conf 0.26~0.54 (p50 0.47)**
 *                  4995 n= 29 conf≤0.42   │
 *     redOutpost                          │ **0    n=209 conf 0.09~0.53 (p50 0.42)**
 *     blueOutpost                         │ **0    n=213 conf 0.03~0.63 (p50 0.42)**
 *
 * 误读次数反而更多，但置信度上界压在真值中位数之下。单一门限切不干净
 * （blueBase 的 4995 能摸到 0.42），能切干净的是**时间**：误读是瞬时的，真值是持续的。
 *
 * ## 于是：按时间衰减累积证据，而不是逐时刻投票
 *
 * 每个候选值维护一个衰减累积的 conf² 得分，取得分最高者（再受单调约束）。
 * 上面那三拍全员误读只累积到约 0.16，而 3946 此前已累到约 0.87 —— 翻不动。
 */

/** 置信度加权用平方：让高置信度的少数派压得过低置信度的多数派。 */
const weight = (confidence: number) => confidence * confidence;

/**
 * 参与投票的最低置信度。
 * 低于此值的读数连投票资格都没有 —— 实测误读的置信度普遍落在 0.05~0.17，
 * 而正确读数是 0.30~0.39，这条下限先削掉一批噪声再谈加权。
 */
const CONFIDENCE_FLOOR = 0.05;

/**
 * 每拍的证据衰减系数。
 *
 * 定它就是在定一个取舍：**抗相关性误读的能力** vs **真实掉血的跟随延迟**。
 * 设稳态得分 S = c/(1−d)，一个新值要反超旧值需要 k 拍，满足 d^k < 0.5，
 * 即 k > ln0.5/ln d。
 *     d=0.8 → 3.1 拍：跟得快，但连续 8 拍的全员误读就能翻盘（实测已出现过连续 3 拍）
 *     d=0.9 → 6.6 拍：连续 8 拍误读也只到真值的 1/4，安全余量 4 倍
 * 取 0.9。按 4 Hz 采样，真实掉血约 1.7 秒跟上 —— 战略目标血量不需要更快。
 */
const EVIDENCE_DECAY = 0.9;

/**
 * 采纳一个值所需的最低累积证据。
 *
 * 挡的是开局那几拍：现网 t=0 只有 `3946@0.13 / 3936@0.06 / 3396@0.09` 这种全弱读数，
 * 此时谁得分最高纯属偶然，而**单调约束会把这个偶然永久锁死**。
 * 宁可空着等 —— 实测等到 t=3（3946 以 0.39/0.32/0.30 三路齐出）才落定。
 */
const MIN_EVIDENCE = 0.05;

/** 得分衰减到这个量级以下就从表里删掉，免得候选表随时间无限增长。 */
const PRUNE_BELOW = 1e-4;

export type ObjectiveField = 'redBase' | 'redOutpost' | 'blueBase' | 'blueOutpost';
export const OBJECTIVE_FIELDS: readonly ObjectiveField[] = [
  'redBase',
  'redOutpost',
  'blueBase',
  'blueOutpost',
];

export type FusedObjectives = Record<ObjectiveField, number | null>;

export interface ObjectiveFusion {
  /**
   * 喂一轮多路读数。**只该传地面路的** —— 空中路没有记分板，那四块 ROI 落在
   * FPV 画面本身，实测捏造率 35.7%。
   */
  observe(readings: readonly Objectives[]): FusedObjectives;
  /**
   * 回合重置。目标血量每回合归满，单调约束只在回合内成立
   * （实测蓝方前哨站 Round1 末 600、Round2 中 945）。
   * 由 fleet 在「全场没有一路处于 live」之后再次出现 live 时调用。
   */
  reset(): void;
  readonly state: FusedObjectives;
}

interface FieldState {
  current: number | null;
  /** 候选值 → 时间衰减累积的 conf² 得分 */
  scores: Map<number, number>;
}

export function createObjectiveFusion(decay = EVIDENCE_DECAY): ObjectiveFusion {
  const fields = new Map<ObjectiveField, FieldState>();
  const blank = (): FieldState => ({ current: null, scores: new Map() });
  for (const f of OBJECTIVE_FIELDS) fields.set(f, blank());

  const snapshot = (): FusedObjectives => ({
    redBase: fields.get('redBase')!.current,
    redOutpost: fields.get('redOutpost')!.current,
    blueBase: fields.get('blueBase')!.current,
    blueOutpost: fields.get('blueOutpost')!.current,
  });

  return {
    observe(readings) {
      for (const field of OBJECTIVE_FIELDS) {
        const st = fields.get(field)!;

        // 1) 旧证据衰减
        for (const [v, s] of st.scores) {
          const next = s * decay;
          if (next < PRUNE_BELOW) st.scores.delete(v);
          else st.scores.set(v, next);
        }

        // 2) 本拍读数入账。置信度低于下限的连入账资格都没有 ——
        //    实测误读普遍落在 0.05~0.19，先削一批噪声再谈加权。
        for (const r of readings) {
          const hit = r[field];
          if (!hit || hit.confidence < CONFIDENCE_FLOOR) continue;
          st.scores.set(hit.value, (st.scores.get(hit.value) ?? 0) + weight(hit.confidence));
        }

        // 3) 取累积得分最高者
        let best: number | null = null;
        let bestScore = 0;
        for (const [value, s] of st.scores) {
          // 同分取较小值：战略目标只降不升，偏保守的那个更可能是刚发生的真实下降
          if (s > bestScore || (s === bestScore && best !== null && value < best)) {
            best = value;
            bestScore = s;
          }
        }

        // 证据不足就先空着。此时谁最高纯属偶然，而单调约束会把偶然永久锁死。
        if (best === null || bestScore < MIN_EVIDENCE) continue;

        // 4) 单调：回合内战略目标不回血，上跳一律是误读。
        //    注意这里**不**清掉上跳候选的得分 —— 它继续累积，
        //    真到了下一回合（reset 之后）自然会被采纳。
        if (st.current === null || best <= st.current) st.current = best;
      }
      return snapshot();
    },
    reset() {
      for (const f of OBJECTIVE_FIELDS) fields.set(f, blank());
    },
    get state() {
      return snapshot();
    },
  };
}
