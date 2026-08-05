import { describe, it, expect } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
import { loadFixtures, type FixtureFrame } from './__fixtures__/load';
import { createFleet, type FleetMember } from './fleet';
import { identifyRole } from './roles';
import { insideField } from './fieldMap';

/**
 * 端到端汇聚验收：十路真实浏览器像素 → 一份全场状态。
 *
 * 这是「沙盘上能出几个目标」这个问题的直接答案。走的是生产代码本身
 * （identifyRole → createFleet → tracker → streamPhase → fieldMap），
 * 唯一被替换掉的是取像素那一步 —— 这里的像素来自离线夹具而不是 canvas。
 */
const DIR = 'D:/rmcap/browsercap';
const available = existsSync(`${DIR}/frames.json`);
const pct = (a: number, b: number) => (b ? +((100 * a) / b).toFixed(1) : 0);

function buildMembers(frames: FixtureFrame[]): { members: FleetMember[]; unknown: string[] } {
  const members: FleetMember[] = [];
  const unknown: string[] = [];
  for (const role of new Set(frames.map((f) => f.stream))) {
    const id = identifyRole(role);
    if (!id) {
      unknown.push(role);
      continue;
    }
    members.push({ id: role, team: id.team, num: id.num, kind: id.kind });
  }
  return { members, unknown };
}

describe.skipIf(!available)('多路汇聚 · 端到端', () => {
  it('十路全部认得出身份，且十个身份互不相同', () => {
    const { members, unknown } = buildMembers(loadFixtures(DIR));
    expect(unknown).toEqual([]);
    expect(members).toHaveLength(10);
    expect(new Set(members.map((m) => `${m.team}${m.num}`)).size).toBe(10);
    // 双方各 5 台：英雄 / 工程 / 3 步 / 4 步 / 空中
    expect(members.filter((m) => m.team === 'red')).toHaveLength(5);
    expect(members.filter((m) => m.kind === 'drone')).toHaveLength(2);
  }, 180_000);

  it('跑完整场之后，沙盘上出现了几个目标', () => {
    const frames = loadFixtures(DIR);
    const { members } = buildMembers(frames);
    const fleet = createFleet(members);

    const ticks = [...new Set(frames.map((f) => f.t))].sort((a, b) => a - b);
    const byTick = new Map<number, FixtureFrame[]>();
    for (const f of frames) {
      const arr = byTick.get(f.t) ?? [];
      arr.push(f);
      byTick.set(f.t, arr);
    }

    const lines: string[] = [];
    let peakLocated = 0;
    let peakLive = 0;
    for (const t of ticks) {
      const snap = fleet.observe(t * 1000, byTick.get(t)!.map((f) => ({ id: f.stream, frame: f.frame })));
      peakLocated = Math.max(peakLocated, snap.located);
      peakLive = Math.max(peakLive, snap.live);
      lines.push(
        `t=${String(t).padStart(2)} 采样${String(byTick.get(t)!.length).padStart(2)} ` +
          `live=${String(snap.live).padStart(2)} 有位置=${String(snap.located).padStart(2)} ` +
          `目标血量 R基${snap.objectives.redBase ?? '-'} R哨${snap.objectives.redOutpost ?? '-'} ` +
          `B基${snap.objectives.blueBase ?? '-'} B哨${snap.objectives.blueOutpost ?? '-'}`,
      );
    }

    const final = fleet.snapshot;
    lines.push('');
    for (const r of [...final.robots].sort((a, b) => a.team.localeCompare(b.team) || a.num - b.num)) {
      lines.push(
        `${r.team}${r.num} ${r.kind.padEnd(6)} ${r.pose ? `x=${r.pose.x.toFixed(2).padStart(6)} y=${r.pose.y.toFixed(2).padStart(6)} yaw=${r.pose.yaw === null ? '  -  ' : ((r.pose.yaw * 180) / Math.PI).toFixed(0).padStart(5)}°` : '（全场未识别到位置）'}` +
          `  hp=${r.hp ?? '-'}/${r.maxHp ?? '-'} ${r.status}`,
      );
    }
    lines.push(`\n峰值：同时 live ${peakLive} 路，有位置 ${peakLocated} 路`);
    writeFileSync('D:/rmcap/fleet_eval.txt', lines.join('\n'), 'utf8');

    // 这一场实测 7/10。三路缺席各有各的原因，都不是管线的问题：
    //   red4  live 帧 0（23 dead + 16 off）—— 抓录时就已阵亡，全程没活过
    //   red2  live 帧 0（27 dead）—— 同上。全相位检出 1 次但落在 dead 帧上，
    //         灰化小地图上的绿色命中是噪声，拒掉是对的
    //   red6  live 帧 27、检出 0 —— 540p 分辨率下限，红方自机只剩 9 个像素
    //         落进色相窗（蓝方 1092）；1080p 下同一检测器 86.9%
    // live 帧内的检出率：blue2 29/30、blue4 25/27、blue6 23/26、blue3 21/24、
    //                   blue1 25/30、red1 10/15
    expect(peakLocated).toBeGreaterThanOrEqual(7);
    const located = final.robots.filter((r) => r.pose !== null);
    expect(located.every((r) => insideField(r.pose!.x, r.pose!.y))).toBe(true);
    expect(located.some((r) => r.kind === 'drone')).toBe(true);
    expect(new Set(located.map((r) => r.team)).size).toBe(2);
  }, 180_000);

  it('目标血量在回合内单调不增，且四个字段都读得出来', () => {
    const frames = loadFixtures(DIR);
    const { members } = buildMembers(frames);
    const fleet = createFleet(members);
    const ticks = [...new Set(frames.map((f) => f.t))].sort((a, b) => a - b);
    const byTick = new Map<number, FixtureFrame[]>();
    for (const f of frames) {
      const arr = byTick.get(f.t) ?? [];
      arr.push(f);
      byTick.set(f.t, arr);
    }

    let violations = 0;
    let covered = 0;
    let total = 0;
    let prev: Record<string, number | null> = {
      redBase: null,
      redOutpost: null,
      blueBase: null,
      blueOutpost: null,
    };
    let roundWasLive = false;
    for (const t of ticks) {
      const snap = fleet.observe(t * 1000, byTick.get(t)!.map((f) => ({ id: f.stream, frame: f.frame })));
      const nowLive = snap.live > 0;
      // 跨回合不比 —— 目标血量每回合归满
      const sameRound = nowLive && roundWasLive;
      for (const k of ['redBase', 'redOutpost', 'blueBase', 'blueOutpost'] as const) {
        const v = snap.objectives[k];
        if (nowLive) {
          total++;
          if (v !== null) covered++;
        }
        if (sameRound && v !== null && prev[k] !== null && v > prev[k]!) violations++;
        prev[k] = v;
      }
      roundWasLive = nowLive;
      if (!nowLive) prev = { redBase: null, redOutpost: null, blueBase: null, blueOutpost: null };
    }

    expect(pct(covered, total)).toBeGreaterThan(90);
    expect(violations).toBe(0); // 单调违例必须是 0 —— 融合方案的核心指标
  }, 180_000);
});
