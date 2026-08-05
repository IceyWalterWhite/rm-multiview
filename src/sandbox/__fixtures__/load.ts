import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import type { Frame } from '../../vision/frame';

/**
 * 真实赛事录屏抽出来的像素夹具。由 tools/sandbox/dump_fixtures.py 生成。
 *
 * 存的是 ROI 而不是整帧（整帧 1.6MB/张），加载时再贴回一张全尺寸黑帧。
 * 这样被测函数拿到的仍然是「一整帧」——公开 API 不为测试变形，
 * ROI 常量本身也在这条路径上被验证了一次：贴错位置测试就会红。
 */

export interface FixtureRoi {
  x: number;
  y: number;
  w: number;
  h: number;
  offset: number;
}

export interface FixtureFrame {
  stream: string;
  side: 'red' | 'blue';
  t: number;
  /** 人工从放大画面读出的血量；null = 该帧本来就没有血条（阵亡/未开赛） */
  hp: [number, number] | null;
  alive: boolean;
  /** null = 该帧只作血量样本，没抽小地图 ROI，标记检测不对它断言 */
  expectMarker: boolean | null;
  /** 目标血量真值（双方基地/前哨站）。只有目标训练集才带。 */
  objectives?: { redOutpost: number; redBase: number; blueBase: number; blueOutpost: number };
  note?: string;
  frame: Frame;
}

interface Manifest {
  generatedFrom: string;
  frames: Array<Omit<FixtureFrame, 'frame'> & { width: number; height: number; rois: Record<string, FixtureRoi> }>;
}

const here = dirname(fileURLToPath(import.meta.url));

const cache = new Map<string, FixtureFrame[]>();

type Record_ = Manifest['frames'][number];

/** 把一条记录的 ROI 贴回一张全尺寸黑帧。展开后 540p 约 3 MB、1080p 约 8 MB。 */
function materialize(record: Record_, blob: Buffer): FixtureFrame {
  const data = new Uint8ClampedArray(record.width * record.height * 4);
  // 未覆盖区域留作不透明黑：ROI 之外的像素本就不该影响任何判据，
  // 万一哪个算法悄悄依赖了 ROI 外的内容，这里会立刻暴露出来。
  for (let i = 3; i < data.length; i += 4) data[i] = 255;

  for (const roi of Object.values(record.rois)) {
    for (let row = 0; row < roi.h; row++) {
      const src = roi.offset + row * roi.w * 4;
      const dst = ((roi.y + row) * record.width + roi.x) * 4;
      data.set(blob.subarray(src, src + roi.w * 4), dst);
    }
  }
  return {
    stream: record.stream,
    side: record.side,
    t: record.t,
    hp: record.hp,
    alive: record.alive,
    expectMarker: record.expectMarker,
    objectives: record.objectives,
    note: record.note,
    frame: { data, width: record.width, height: record.height },
  };
}

function readManifest(dir: string): { manifest: Manifest; blob: Buffer } {
  return {
    manifest: JSON.parse(readFileSync(join(dir, 'frames.json'), 'utf8')),
    blob: gunzipSync(readFileSync(join(dir, 'frames.bin.gz'))),
  };
}

/**
 * 载入一组像素夹具。
 * dir 默认是随仓库提交的小夹具；留出评估集放在 gitignored 的 testdata/ 下，
 * 由 tools/sandbox/dump_fixtures.py 现场生成 —— 标注提交、像素不提交。
 *
 * 全部驻留内存，只适合随仓库走的小夹具。整场直播那种上千帧的评估集用
 * {@link streamFixtures} —— 3 MB/帧乘以帧数很快就是几个 GiB。
 */
export function loadFixtures(dir: string = here): FixtureFrame[] {
  const hit = cache.get(dir);
  if (hit) return hit;
  const { manifest, blob } = readManifest(dir);
  const frames = manifest.frames.map((record) => materialize(record, blob));
  cache.set(dir, frames);
  return frames;
}

/**
 * 逐帧产出夹具，产出的帧交给调用方用完即弃 —— 常驻内存是 O(1 帧) 而不是 O(全集)。
 *
 * 压缩后的 ROI blob 仍整块解压驻留（几百 MiB，在堆外 Buffer 里），
 * 真正撑爆内存的是展开成全尺寸 RGBA 的那一步，所以只对它做惰性化。
 */
export function* streamFixtures(dir: string): Generator<FixtureFrame> {
  const { manifest, blob } = readManifest(dir);
  for (const record of manifest.frames) yield materialize(record, blob);
}

/** 评估集的帧数与尺寸，不展开像素。用于先报规模、再决定怎么跑。 */
export function fixtureStats(dir: string): { count: number; width: number; height: number } {
  const manifest: Manifest = JSON.parse(readFileSync(join(dir, 'frames.json'), 'utf8'));
  const first = manifest.frames[0];
  return { count: manifest.frames.length, width: first?.width ?? 0, height: first?.height ?? 0 };
}

export function fixture(stream: string, t: number): FixtureFrame {
  const found = loadFixtures().find((f) => f.stream === stream && f.t === t);
  if (!found) throw new Error(`夹具里没有 ${stream}@${t}s`);
  return found;
}
