import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { detectSelfMarker } from './marker';
import { readHp } from './hp';
import { readObjectives } from './objectives';
import { isHudGreyedOut } from './alive';
import { streamFixtures, fixtureStats, type FixtureFrame } from './__fixtures__/load';
import { barSaturationFromFrame } from '../matchstate/observe';
import {
  MINIMAP,
  DRONE_MINIMAP,
  HUD_PRESENT_BAR_SAT,
  SELF_MARKER_MIN_AREA_RATIO,
  DRONE_MARKER_MIN_AREA_RATIO,
} from '../rmui/layout';

/**
 * 现网直播精度评估。
 *
 * 与 holdout.test.ts 的区别：那批是 852×480 录屏且带人工血量真值；
 * 这批是 10 路同时录制的直播原始流，**没有人工标注**，靠两个自洽性质取代：
 *   1. 基地/前哨站血量是全场共享量 —— 同一时刻各路读数必须相同，众数即真值；
 *   2. 位置在相邻采样点之间只能缓变 —— 跳变即误读。
 *
 * 两档一起测。站点默认拉 540p，用户可自行切档，两边都得有数字。
 * 540p 集按**原生 1152×648** 抽取，绝不上采样 —— 上采样会凭空补出细节，
 * 把「小字在低码率下糊成一团」这个真正的难点抹掉，得出的结论是假的。
 *
 * 顺带记一笔现场量到的事实：清晰度标签不可信。标称 720p 的流实际是
 * 1920×1080@25fps（2023kbps），标称 1080p 是 1920×1080@50fps 但用老式
 * Constrained Baseline（4805kbps），只有 540p 真的降采样到 1152×648（1312kbps）。
 *
 * 像素不进仓库。生成方式见 scratchpad/dump_live.py。
 * 没生成时整组跳过，而不是假装通过。
 *
 * 全集**单遍流式**统计：展开后的帧是 3 MB（540p）到 8 MB（1080p），
 * 整场 72 分钟 × 12 路一次性驻留会到几个 GiB。所以所有指标在同一次遍历里
 * 累加完成，帧用完即弃 —— 加新指标请加计数器，不要再遍历第二遍。
 */
const DIRS = (
  [
    ['720p→1920×1080', 'D:/rmcap/eval720'],
    ['540p→1152×648', 'D:/rmcap/eval540'],
  ] as [string, string][]
).filter(([, d]) => existsSync(`${d}/frames.json`));

const pct = (a: number, b: number) => (b ? +((100 * a) / b).toFixed(1) : 0);
const isDrone = (stream: string) => stream.includes('空中');

/**
 * 只在「HUD 确实亮着」的帧上统计。
 *
 * 不加这一条会得到彻底误导的数字：录制横跨回合间歇与等待卡，那些帧本就没有
 * 小地图和血条，把它们算作漏检会把 99% 的检出率压到 48%。这个坑在 480p 那轮
 * 已经踩过一次 —— 分母必须是「本来就该读到」的帧。
 */
const hudOn = (f: FixtureFrame) => barSaturationFromFrame(f.frame, f.side) >= HUD_PRESENT_BAR_SAT;

/** 空中与地面的小地图尺寸、图标配色都不同，门限必须跟着机型走。 */
const detect = (f: FixtureFrame) =>
  isDrone(f.stream)
    ? detectSelfMarker(f.frame, DRONE_MINIMAP, DRONE_MARKER_MIN_AREA_RATIO)
    : detectSelfMarker(f.frame, MINIMAP, SELF_MARKER_MIN_AREA_RATIO);

interface Tally {
  frames: number;
  ground: number;
  posHit: number;
  withHeading: number;
  hpHit: number;
  malformed: string[];
  objRead: number;
  objAttempted: number;
  /** 分机型的目标血量读出，用于判断空中路那套错位 ROI 是否在吐垃圾 */
  objReadGround: number;
  objAttemptedGround: number;
  objReadDrone: number;
  objAttemptedDrone: number;
  /** field@t -> 各路读数（带机型标记），用于跨路众数一致性 */
  bucket: Map<string, { v: number; drone: boolean }[]>;
  drones: number;
  droneHit: number;
  /** 空中路里 HUD 确实亮着的，与地面同口径 —— 不条件化的分母含等待卡，不可比 */
  dronesOn: number;
  droneHitOn: number;
  greyed: number;
  /** 同一路相邻采样点之间的位置跳变次数（性质 2） */
  jumps: number;
  tracked: number;
  /** 每路单独的 (HUD 亮帧, 位置检出, 血量读出)，用于定位是哪一路拖低总数 */
  perStream: Map<string, { on: number; pos: number; hp: number }>;
  /** DIAG_STREAM 指定那一路的失败时刻 */
  diagMisses: string[];
}

/** 设成某一路的名字（如 B工程），跑完会列出它读不出的时刻，便于回原始流抽帧核对。 */
const diagStream = process.env.DIAG_STREAM ?? '';

const OBJ_FIELDS = ['redBase', 'redOutpost', 'blueBase', 'blueOutpost'] as const;

/** 小地图归一化坐标下，20 秒内合理的最大位移。整场对角线约 1.41，跨半场即为误读。 */
const MAX_STEP = 0.5;

function evaluate(dir: string): Tally {
  const t: Tally = {
    frames: 0, ground: 0, posHit: 0, withHeading: 0, hpHit: 0, malformed: [],
    objRead: 0, objAttempted: 0, objReadGround: 0, objAttemptedGround: 0,
    objReadDrone: 0, objAttemptedDrone: 0, bucket: new Map(), drones: 0, droneHit: 0,
    dronesOn: 0, droneHitOn: 0, greyed: 0, jumps: 0, tracked: 0, perStream: new Map(),
    diagMisses: [],
  };
  const last = new Map<string, { x: number; y: number }>();
  const bump = (s: string, k: 'on' | 'pos' | 'hp') => {
    const e = t.perStream.get(s) ?? { on: 0, pos: 0, hp: 0 };
    e[k]++;
    t.perStream.set(s, e);
  };

  for (const f of streamFixtures(dir)) {
    t.frames++;
    if (isHudGreyedOut(f.frame)) t.greyed++;

    // 目标血量是全场共享量，空中路同样看得到，所以不受 hudOn 条件化影响。
    // 但空中路的 HUD 挤在左上子画面里，这套按全屏标定的 ROI 在那儿是错位的 ——
    // 分机型记，才能看出它是读不出、还是读出了错的。
    const drone = isDrone(f.stream);
    const o = readObjectives(f.frame);
    for (const k of OBJ_FIELDS) {
      t.objAttempted++;
      if (drone) t.objAttemptedDrone++;
      else t.objAttemptedGround++;
      if (!o[k]) continue;
      t.objRead++;
      if (drone) t.objReadDrone++;
      else t.objReadGround++;
      const key = `${k}@${f.t}`;
      t.bucket.set(key, [...(t.bucket.get(key) ?? []), { v: o[k]!.value, drone }]);
    }

    if (isDrone(f.stream)) {
      t.drones++;
      const hit = !!detect(f);
      if (hit) t.droneHit++;
      if (hudOn(f)) {
        t.dronesOn++;
        bump(f.stream, 'on');
        if (hit) {
          t.droneHitOn++;
          bump(f.stream, 'pos');
        }
      }
      continue;
    }

    if (!hudOn(f)) continue;
    t.ground++;
    bump(f.stream, 'on');

    const m = detect(f);
    // 定位单路异常用：DIAG_STREAM=B工程 时打印该路读不出的时刻，
    // 拿时间戳直接去原始 .ts 里抽帧看，比盯总体百分比快得多。
    if (diagStream && f.stream === diagStream && (!m || !readHp(f.frame))) {
      t.diagMisses.push(`${f.t}s${m ? '' : ' 位置'}${readHp(f.frame) ? '' : ' 血量'}`);
    }
    if (m) {
      t.posHit++;
      bump(f.stream, 'pos');
      if (m.heading !== null) t.withHeading++;
      const prev = last.get(f.stream);
      if (prev) {
        t.tracked++;
        if (Math.hypot(m.x - prev.x, m.y - prev.y) > MAX_STEP) t.jumps++;
      }
      last.set(f.stream, { x: m.x, y: m.y });
    }

    const hp = readHp(f.frame);
    if (hp) {
      t.hpHit++;
      bump(f.stream, 'hp');
      // current>max 是硬约束，破了说明格式否决失效 —— 这类错误比读不出严重得多
      if (hp.current > hp.max) t.malformed.push(`${f.stream}@${f.t}s ${hp.raw}`);
    }
  }
  return t;
}

const tallies = new Map<string, Tally>();

describe.skipIf(DIRS.length === 0)('现网直播评估', () => {
  beforeAll(() => {
    for (const [label, dir] of DIRS) {
      const s = fixtureStats(dir);
      console.log(`[${label}] 载入 ${s.count} 帧 @ ${s.width}×${s.height}（流式，单遍）`);
      tallies.set(label, evaluate(dir));
    }
  }, 1_800_000);

  it.each(DIRS)('%s', (label) => {
    const t = tallies.get(label)!;
    let agree = 0;
    let total = 0;
    // 地面路自己投出的众数当真值，再看空中路读数是否落在上面。
    // 空中不参与投票 —— 若它的 ROI 是错位的，让它投票等于用被污染的样本定真值。
    let groundAgree = 0;
    let groundTotal = 0;
    let droneMatch = 0;
    let droneChecked = 0;
    for (const vals of t.bucket.values()) {
      if (vals.length < 3) continue;
      const counts = new Map<number, number>();
      for (const { v } of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
      agree += Math.max(...counts.values());
      total += vals.length;

      const g = vals.filter((x) => !x.drone);
      if (g.length < 3) continue;
      const gc = new Map<number, number>();
      for (const { v } of g) gc.set(v, (gc.get(v) ?? 0) + 1);
      let truth = 0;
      let best = 0;
      for (const [v, c] of gc) {
        if (c > best) {
          best = c;
          truth = v;
        }
      }
      groundAgree += best;
      groundTotal += g.length;
      for (const { v } of vals.filter((x) => x.drone)) {
        droneChecked++;
        if (v === truth) droneMatch++;
      }
    }

    console.log(
      `\n[${label}]  地面 n=${t.ground}（HUD 亮着，全集 ${t.frames}）\n` +
        `  位置检出   ${pct(t.posHit, t.ground)}%\n` +
        `  其中有朝向 ${pct(t.withHeading, t.posHit)}%\n` +
        `  位置跳变   ${pct(t.jumps, t.tracked)}%  (n=${t.tracked}，>${MAX_STEP} 归一距离/20s)\n` +
        `  血量读出   ${pct(t.hpHit, t.ground)}%   格式违例 ${t.malformed.length}\n` +
        `  目标血量   读出 ${pct(t.objRead, t.objAttempted)}%   多路一致 ${pct(agree, total)}% (n=${total})\n` +
        `    ├ 地面路   读出 ${pct(t.objReadGround, t.objAttemptedGround)}%   ` +
        `地面内部一致 ${pct(groundAgree, groundTotal)}% (n=${groundTotal})\n` +
        `    └ 空中路   读出 ${pct(t.objReadDrone, t.objAttemptedDrone)}%   ` +
        `与地面众数相符 ${pct(droneMatch, droneChecked)}% (n=${droneChecked})\n` +
        `  空中检出   ${pct(t.droneHitOn, t.dronesOn)}%（n=${t.dronesOn}，HUD 亮着；` +
        `不条件化则 ${pct(t.droneHit, t.drones)}%/n=${t.drones}）\n` +
        `  ── 分路 ──\n` +
        [...t.perStream.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([s, e]) =>
            `  ${s.padEnd(8)} 亮${String(e.on).padStart(4)}帧  位置 ${String(pct(e.pos, e.on)).padStart(5)}%` +
            (isDrone(s) ? '  （空中，无血条）' : `  血量 ${String(pct(e.hp, e.on)).padStart(5)}%`),
          )
          .join('\n') +
        (t.diagMisses.length
          ? `\n  ── ${diagStream} 读不出的时刻 ──\n  ${t.diagMisses.join('  ')}`
          : ''),
    );

    expect(t.malformed).toEqual([]);
    expect(t.ground).toBeGreaterThan(0);
  });

  it.each(DIRS)('%s 阵亡判据不把正常帧判成灰化', (label) => {
    const t = tallies.get(label)!;
    console.log(`[${label}] 灰化 ${t.greyed}/${t.frames} = ${pct(t.greyed, t.frames)}%`);
    // 灰化=阵亡，只该是少数帧；接近半数说明判据本身塌了
    expect(pct(t.greyed, t.frames)).toBeLessThan(25);
  });
});
