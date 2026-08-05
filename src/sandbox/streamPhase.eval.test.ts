import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { loadFixtures, type FixtureFrame } from './__fixtures__/load';
import { scoreboardLit } from './alive';
import { detectSelfMarker } from './marker';
import { observePhase, type StreamPhase } from './streamPhase';
import {
  DRONE_MARKER_MIN_AREA_RATIO,
  DRONE_MINIMAP,
  HUD_ABSENT_LIT,
  MINIMAP,
  SELF_MARKER_MIN_AREA_RATIO,
} from '../rmui/layout';

/**
 * 逐路自判在现网像素上的验收。
 *
 * 要证的是三件事：
 *   1. 判据能把「没有 HUD」的帧择干净 —— 那些帧上读什么都是噪声；
 *   2. 择干净之后，剩下的帧里检出率显著提高（分母条件化才有意义）；
 *   3. **不需要任何全局标志**：等待卡、回合间歇、转播镜头都由这一路自己认出来。
 *
 * 像素不进仓库（D:/rmcap/browsercap 由 tools/sandbox 现场抓）。没生成时整组跳过。
 */
const DIR = 'D:/rmcap/browsercap';
const available = existsSync(`${DIR}/frames.json`);
const pct = (a: number, b: number) => (b ? +((100 * a) / b).toFixed(1) : 0);
const isDrone = (f: FixtureFrame) => f.stream.includes('空中');
const kindOf = (f: FixtureFrame) => (isDrone(f) ? ('drone' as const) : ('ground' as const));
const detect = (f: FixtureFrame) =>
  isDrone(f)
    ? detectSelfMarker(f.frame, DRONE_MINIMAP, DRONE_MARKER_MIN_AREA_RATIO)
    : detectSelfMarker(f.frame, MINIMAP, SELF_MARKER_MIN_AREA_RATIO);

describe.skipIf(!available)('逐路自判 · 现网像素', () => {
  it('把没有 HUD 的帧择干净，且择掉的帧里本来就检不出自机', () => {
    const frames = loadFixtures(DIR).filter((f) => !isDrone(f));
    const off = frames.filter((f) => observePhase(f.frame, 'ground').phase === 'off');
    const onWithMarker = frames.filter(
      (f) => observePhase(f.frame, 'ground').phase !== 'off' && detect(f),
    );
    const offWithMarker = off.filter(detect);

    // 判成 off 的帧占了三分之一强 —— 这一整段以前会被当成有效帧去读
    expect(off.length).toBeGreaterThan(frames.length * 0.3);
    // 而它们本来就一个自机都检不出：择掉的是纯噪声，没有误伤
    expect(offWithMarker.length).toBe(0);
    expect(onWithMarker.length).toBeGreaterThan(100);
  }, 180_000);

  it('HUD 的亮像素占比与转播镜头之间有干净的空档', () => {
    const frames = loadFixtures(DIR).filter((f) => !isDrone(f));
    const litWithMarker = frames.filter(detect).map((f) => scoreboardLit(f.frame));
    // 能检出自机 ⇒ HUD 必然在。这些帧的 lit 上界就是「HUD 在」的实测上界
    const maxHud = Math.max(...litWithMarker);
    expect(maxHud).toBeLessThan(HUD_ABSENT_LIT);
    // 门限两侧都要有余量，不能贴着实测上界
    expect(HUD_ABSENT_LIT - maxHud).toBeGreaterThan(0.01);
  }, 180_000);

  it('逐路给出各自的相位时间线，互不影响', () => {
    const frames = loadFixtures(DIR);
    const byStream = new Map<string, FixtureFrame[]>();
    for (const f of frames) {
      const arr = byStream.get(f.stream) ?? [];
      arr.push(f);
      byStream.set(f.stream, arr);
    }

    const report: string[] = [];
    let anyDisagreement = false;
    const phaseAt = new Map<number, Set<StreamPhase>>();

    for (const [stream, fs] of byStream) {
      fs.sort((a, b) => a.t - b.t);
      const counts: Record<StreamPhase, number> = { live: 0, dead: 0, off: 0 };
      let liveWithMarker = 0;
      for (const f of fs) {
        const { phase } = observePhase(f.frame, kindOf(f));
        counts[phase]++;
        if (phase === 'live' && detect(f)) liveWithMarker++;
        const set = phaseAt.get(f.t) ?? new Set<StreamPhase>();
        set.add(phase);
        phaseAt.set(f.t, set);
      }
      report.push(
        `${stream.padEnd(14)} live=${String(counts.live).padStart(2)} dead=${String(counts.dead).padStart(2)} ` +
          `off=${String(counts.off).padStart(2)}  live 里检出自机 ${pct(liveWithMarker, counts.live)}%`,
      );
    }
    for (const set of phaseAt.values()) if (set.size > 1) anyDisagreement = true;

    // 核心断言：同一时刻不同机位可以处在不同相位。
    // 这正是取消全局标志的理由 —— 一个标志根本表达不了这张表。
    expect(anyDisagreement).toBe(true);
    expect(report.length).toBe(10);
  }, 180_000);

  it('空中路判不出 dead，血量恒为 null', () => {
    const drones = loadFixtures(DIR).filter(isDrone);
    expect(drones.length).toBeGreaterThan(0);
    for (const f of drones) {
      const r = observePhase(f.frame, 'drone');
      expect(r.phase).not.toBe('dead');
      expect(r.hp).toBeNull();
    }
  }, 180_000);
});
