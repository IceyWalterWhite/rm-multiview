import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { readHp } from './hp';
import { readObjectives } from './objectives';
import { isHudGreyedOut } from './alive';
import { loadFixtures } from './__fixtures__/load';

/**
 * 空中机器人**没有血量**。
 *
 * 所以对空中路调 readHp / isHudGreyedOut 是无意义的：HP_TEXT、HP_BAR、TOP_SCOREBOARD
 * 这些 ROI 在空中路上落的是 FPV 画面本身，读出来的任何数字都是凭空捏造的。
 * 这一组量的就是「捏造率」—— 它不该被当成检出率的一部分，更不该喂进沙盘。
 *
 * 判据很简单：空中路上 readHp 的**任何**非 null 返回都是错的，
 * isHudGreyedOut 的**任何** true 也都是错的（无人机不会阵亡）。
 */
const DIR = 'D:/rmcap/browsercap';
const available = existsSync(`${DIR}/frames.json`);
const pct = (a: number, b: number) => (b ? +((100 * a) / b).toFixed(1) : 0);

describe.skipIf(!available)('空中路上那些本就不该读的东西', () => {
  it('量一量凭空捏造了多少', () => {
    const drones = loadFixtures(DIR).filter((f) => f.stream.includes('空中'));
    const rows: string[] = [];
    for (const stream of [...new Set(drones.map((f) => f.stream))].sort()) {
      const fs = drones.filter((f) => f.stream === stream);
      const hp = fs.map((f) => readHp(f.frame)).filter((r) => r !== null);
      const greyed = fs.filter((f) => isHudGreyedOut(f.frame)).length;
      const obj = fs.map((f) => readObjectives(f.frame));
      const objHits = obj.reduce(
        (n, o) => n + [o.redBase, o.redOutpost, o.blueBase, o.blueOutpost].filter(Boolean).length,
        0,
      );
      rows.push(
        `  ${stream}  n=${fs.length}\n` +
          `    readHp 返回了值      ${String(pct(hp.length, fs.length)).padStart(5)}%  ` +
          `样例 ${hp.slice(0, 4).map((r) => r!.raw).join(' ') || '（无）'}\n` +
          `    isHudGreyedOut=true ${String(pct(greyed, fs.length)).padStart(5)}%（无人机不会阵亡，全是误判）\n` +
          `    目标血量读出        ${String(pct(objHits, fs.length * 4)).padStart(5)}%`,
      );
    }
    console.log('\n[空中路的捏造率]\n' + rows.join('\n'));
    expect(rows.length).toBeGreaterThan(0);
  }, 300_000);
});
