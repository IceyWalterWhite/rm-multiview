import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { classify } from '../matchstate/signals';
import { createMatchLiveDetector } from '../matchstate/detector';
import { barSaturationFromFrame } from '../matchstate/observe';
import { loadFixtures, type FixtureFrame } from './__fixtures__/load';
import type { StreamObservation } from '../matchstate/types';
import { HUD_PRESENT_BAR_SAT } from '../rmui/layout';

/**
 * 开赛检测的**视觉**半边，跑在浏览器现网像素上。
 *
 * 这批 420 帧抓于第 13 场（华东理工 vs 东莞理工），45 轮 × 1.2s ≈ 54s，
 * **横跨了一次回合结束** —— 前 32 轮进行中、后 13 轮间歇。正解不是「恒为 live」，
 * 而是切换点必须落在那一处。真值来自逐轮亮着的路数曲线本身（见下方断言处），
 * 不是人工标的：8 路同时亮只可能是新回合复活，持续零路亮只可能是回合结束。
 *
 * 判据只喂 barSaturation，audioDb 留 null：音频那条链路（hls.js fLoader 分片字节
 * → tsDemux → OfflineAudioContext）在 sync 分支，这个 worktree 里还没有，
 * 所以这一组**只能证视觉兜底可用，不能证音频主判据可用**。
 */
const DIR = 'D:/rmcap/browsercap';
const available = existsSync(`${DIR}/frames.json`);
const pct = (a: number, b: number) => (b ? +((100 * a) / b).toFixed(1) : 0);

describe.skipIf(!available)('开赛检测（视觉）跑在浏览器像素上', () => {
  it('横跨回合结束的一段，切换点必须落对', () => {
    const frames = loadFixtures(DIR);
    const byRound = new Map<number, FixtureFrame[]>();
    for (const f of frames) byRound.set(f.t, [...(byRound.get(f.t) ?? []), f]);
    const rounds = [...byRound.keys()].sort((a, b) => a - b);

    const detector = createMatchLiveDetector();
    let liveEvidence = 0;
    let livePhase = 0;
    let anyRule = 0;
    let majorityRule = 0;
    const satAll: number[] = [];
    const litFrac: number[] = [];
    for (const r of rounds) {
      const obs: StreamObservation[] = byRound.get(r)!.map((f) => {
        const sat = barSaturationFromFrame(f.frame, f.side);
        satAll.push(sat);
        return { streamId: f.stream, audioDb: null, barSaturation: sat };
      });
      const lit = obs.filter((o) => (o.barSaturation as number) >= HUD_PRESENT_BAR_SAT).length;
      litFrac.push(lit / obs.length);
      if (lit > 0) anyRule++;
      // 对照组：signals.ts 改掉之前的「过半」量词，留在这里当反例
      if (lit * 2 >= obs.length) majorityRule++;
      const ev = classify(obs);
      if (ev.live) liveEvidence++;
      // 时间由调用方注入；这里按实际采样间隔 1.2s 推进
      if (detector.observe(r * 1200, obs) === 'live') livePhase++;
    }

    // 时间序列：判「没开赛」的轮次若连成一片，那多半是回合间歇，判定反而是对的。
    // 排序会就地改数组，所以先把时间序拷一份出来再排。
    const litFracSeq = [...litFrac];
    console.log(
      '\n  每轮血条亮着的路数（时间序）\n    ' +
        rounds.map((r, i) => `${Math.round(litFracSeq[i] * (byRound.get(r)?.length ?? 0))}`).join(' '),
    );

    satAll.sort((a, b) => a - b);
    litFrac.sort((a, b) => a - b);
    const q = (a: number[], p: number) => a[Math.floor((a.length * p) / 100)];
    console.log(
      `\n[开赛检测·视觉 / 浏览器现网像素]\n` +
        `  轮数 ${rounds.length}\n` +
        `  现行判据 classify() live ${pct(liveEvidence, rounds.length)}%\n` +
        `  状态机处于 live       ${pct(livePhase, rounds.length)}%\n` +
        `  「任意一路」            ${pct(anyRule, rounds.length)}%\n` +
        `  「过半」（旧量词）      ${pct(majorityRule, rounds.length)}%\n` +
        `  每轮血条亮着的路数占比 5/50/95 = ` +
        `${q(litFrac, 5).toFixed(2)} / ${q(litFrac, 50).toFixed(2)} / ${q(litFrac, 95).toFixed(2)}\n` +
        `  血条阵营色占比分位 5/50/95 = ` +
        `${q(satAll, 5).toFixed(3)} / ${q(satAll, 50).toFixed(3)} / ${q(satAll, 95).toFixed(3)}`,
    );

    // 这段录制横跨了一次回合结束：前 32 轮进行中（第 26 轮 8 路全亮＝新回合复活，
    // 随后逐个阵亡），第 32 轮起持续零路亮 = 回合间歇。所以正解不是「恒为 live」。
    const LIVE_ROUNDS = 32;
    const lit = rounds.map((r, i) => Math.round(litFracSeq[i] * (byRound.get(r)?.length ?? 0)));
    // 判据：亮着的路数从有到无，切换点必须落在预期的那一处，且之后不再反弹
    expect(lit.slice(0, LIVE_ROUNDS).every((n) => n > 0)).toBe(true);
    expect(lit.slice(LIVE_ROUNDS).every((n) => n === 0)).toBe(true);
    // 「任意一路」逐轮与这条曲线吻合；「过半」在一方被团灭时会误判成未开赛
    expect(anyRule).toBe(LIVE_ROUNDS);
    expect(liveEvidence).toBe(LIVE_ROUNDS);
    expect(majorityRule).toBeLessThan(LIVE_ROUNDS);
    // 状态机：迟滞窗吃掉开头 2s，收场晚 8s，中间必须稳稳锁在 live
    expect(livePhase).toBeGreaterThan(LIVE_ROUNDS - 5);
  }, 300_000);
});
