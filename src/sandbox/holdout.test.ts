import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readHp } from './hp';
import { loadFixtures } from './__fixtures__/load';

/**
 * 留出集精度评估。
 *
 * hp.test.ts 跑的是**训练集** —— glyphs.ts 的字形样本正是从那批夹具提取的，
 * 在上面全对说明不了泛化能力。本文件用的 27 帧不在 fixtures.spec.json 里，
 * 一个字形样本都没参与过训练，所以这里的正确率才是可以对外报的数字。
 *
 * 像素不进仓库（约 1MB）。有录屏的人先跑：
 *   python tools/sandbox/dump_fixtures.py --spec tools/sandbox/holdout.spec.json \
 *          --out testdata/sandbox-holdout
 * 没生成时整组跳过，而不是假装通过。
 */
const DIR = join(process.cwd(), 'testdata', 'sandbox-holdout');
const available = existsSync(join(DIR, 'frames.json'));

describe.skipIf(!available)('readHp on held-out frames', () => {
  it('reads at least 90% of the labelled frames exactly right', () => {
    const labelled = loadFixtures(DIR).filter((f) => f.hp);
    const wrong = labelled
      .map((f) => ({ f, got: readHp(f.frame) }))
      .filter(({ f, got }) => !got || got.current !== f.hp![0] || got.max !== f.hp![1])
      .map(({ f, got }) => `${f.stream}@${f.t}s 期望 ${f.hp![0]}/${f.hp![1]} 实得 ${got ? got.raw : 'null'}`);

    const accuracy = 1 - wrong.length / labelled.length;
    // 失败时把逐帧差异打出来，而不是只报一个百分比
    expect({ accuracy: +(accuracy * 100).toFixed(1), n: labelled.length, wrong }).toMatchObject({
      wrong: expect.any(Array),
    });
    expect(accuracy).toBeGreaterThanOrEqual(0.9);
  });

  it('never reports a value on frames that have no readable bar', () => {
    // 报错值比不报值有害得多：沙盘上一个凭空出现的血量会误导观众
    const blanks = loadFixtures(DIR).filter((f) => !f.hp);
    expect(blanks.length).toBeGreaterThan(0);
    const hallucinated = blanks
      .map((f) => ({ f, got: readHp(f.frame) }))
      .filter(({ got }) => got !== null)
      .map(({ f, got }) => `${f.stream}@${f.t}s 凭空读出 ${got!.raw}`);
    expect(hallucinated).toEqual([]);
  });
});
