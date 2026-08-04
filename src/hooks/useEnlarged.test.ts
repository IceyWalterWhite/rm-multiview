import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createRef } from 'react';
import { scaledBox, separation, resolveEnlarged, readGeometries, useEnlarged, type TileGeometry } from './useEnlarged';

const GAP = 6; // .side-column 的 row-gap

/**
 * 造一列 5 路机位的布局几何，锚点按 theme.css 的规则：
 * 首尾在 top/bottom（放大只朝列内长，不出界被裁），中间在 center。
 */
function column(tileHeight: number, side: 'red' | 'blue' = 'red', offsetX = 0): TileGeometry[] {
  const w = (tileHeight * 16) / 9;
  return Array.from({ length: 5 }, (_, i) => {
    const top = i * (tileHeight + GAP);
    return {
      id: `${side}${i}`,
      box: { left: offsetX, top, right: offsetX + w, bottom: top + tileHeight },
      originX: side === 'red' ? 0 : w,
      originY: i === 0 ? 0 : i === 4 ? tileHeight : tileHeight / 2,
    };
  });
}

const gapBetween = (col: TileGeometry[], a: number, b: number, scale: number) =>
  separation(scaledBox(col[a], scale), scaledBox(col[b], scale));

// 判定阈值与 useEnlarged 内的 MIN_BREATH_RATIO 一致
const minGapFor = (tileHeight: number) => tileHeight * 0.05;

const SIZES = [69, 120, 175, 240, 275, 400]; // 小窗 → 1080p → 2K → 4K

describe('放大后的遮挡几何', () => {
  it('放大盒的锚点不动，其余边按 scale 推开', () => {
    const col = column(100);
    // 首个机位锚点在左上：顶边不动，向下长满 scale 倍
    expect(scaledBox(col[0], 1.6)).toMatchObject({ left: 0, top: 0, bottom: 160 });
    // 末个机位锚点在左下：底边不动，向上长
    const last = scaledBox(col[4], 1.6);
    expect(last.bottom).toBeCloseTo(col[4].box.bottom, 5);
    expect(last.top).toBeCloseTo(col[4].box.bottom - 160, 5);
  });

  it.each(SIZES)('相邻机位在任何尺寸下都必然重叠（机位高 %ipx）', (h) => {
    const col = column(h);
    for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 4]]) {
      expect(gapBetween(col, a, b, 1.6)).toBeLessThan(minGapFor(h));
    }
  });

  it.each(SIZES)('1/3/5 号在任何尺寸下都留得住呼吸缝（机位高 %ipx）', (h) => {
    const col = column(h);
    // 缝 = (2.5 − 1.5×scale)×机位高 + 2×gap，scale=1.6 → 0.1h + 12
    for (const [a, b] of [[0, 2], [2, 4]]) {
      expect(gapBetween(col, a, b, 1.6)).toBeCloseTo(0.1 * h + 2 * GAP, 5);
      expect(gapBetween(col, a, b, 1.6)).toBeGreaterThan(minGapFor(h));
    }
    expect(gapBetween(col, 0, 4, 1.6)).toBeGreaterThan(minGapFor(h));
  });

  // 这条是 1.7 → 1.6 的理由本身：别改回去
  it('1.7 倍下 1/3 号那条缝会随屏幕变大而归零、翻负', () => {
    expect(gapBetween(column(69), 0, 2, 1.7)).toBeCloseTo(8.55, 2); // 小窗：勉强留得住
    expect(gapBetween(column(175), 0, 2, 1.7)).toBeCloseTo(3.25, 2); // 1080p：贴边
    expect(gapBetween(column(240), 0, 2, 1.7)).toBeCloseTo(0, 5); // 2K：正好相切
    expect(gapBetween(column(275), 0, 2, 1.7)).toBeLessThan(0); // 再大：重叠
  });

  it('红蓝两列各自放大互不干扰（间距足够时）', () => {
    const h = 175;
    const w = (h * 16) / 9;
    const red = column(h, 'red');
    const blue = column(h, 'blue', w + 8 + 1200 + 8); // 中间隔着主视角
    expect(separation(scaledBox(red[0], 1.6), scaledBox(blue[0], 1.6))).toBeGreaterThan(minGapFor(h));
  });
});

describe('resolveEnlarged — 谁让位', () => {
  const h = 175;
  const col = column(h);
  const resolve = (current: string[], id: string) => resolveEnlarged(col, current, id, 1.6, minGapFor(h));

  it('点开互不遮挡的机位就同时开着', () => {
    expect(resolve([], 'red0')).toEqual(['red0']);
    expect(resolve(['red0'], 'red2')).toEqual(['red0', 'red2']);
    expect(resolve(['red0', 'red2'], 'red4')).toEqual(['red0', 'red2', 'red4']);
  });

  it('被挤到的那一路缩回去，新点开的留下', () => {
    expect(resolve(['red0'], 'red1')).toEqual(['red1']);
    // 2 号夹在 1、3 之间：两边都得让
    expect(resolve(['red1', 'red3'], 'red2')).toEqual(['red2']);
  });

  it('只收会被挤到的，开着的其余机位不动', () => {
    expect(resolve(['red0', 'red2', 'red4'], 'red3')).toEqual(['red0', 'red3']);
  });

  it('再点一次是收起，且不影响别人', () => {
    expect(resolve(['red0', 'red2'], 'red0')).toEqual(['red2']);
  });

  it('量不到几何时不擅自收人', () => {
    expect(resolveEnlarged([], ['red0'], 'red1', 1.6, 8.75)).toEqual(['red0', 'red1']);
  });

  // 2026-08-04 实测 6 档视口的结论，用行为锁住「为什么是 1.6」：
  // 1.7 倍下机位高一过 120px，连点 1/3/5 会一路互相挤掉，只剩最后点的那一个。
  it.each([122, 162, 202, 242, 282])('1.7 倍在机位高 %ipx 上连三路都撑不住', (h) => {
    const col = column(h);
    const chain = (scale: number) =>
      ['red0', 'red2', 'red4'].reduce<string[]>((cur, id) => resolveEnlarged(col, cur, id, scale, minGapFor(h)), []);
    expect(chain(1.7)).toEqual(['red4']);
    expect(chain(1.6)).toEqual(['red0', 'red2', 'red4']);
  });
});

describe('readGeometries — 从 DOM 量布局', () => {
  /** jsdom 不做布局，offset* 恒为 0，得把布局值钉上去 */
  function stub(el: HTMLElement, box: { left: number; top: number; w: number; h: number }, parent: HTMLElement | null) {
    Object.defineProperties(el, {
      offsetLeft: { value: box.left, configurable: true },
      offsetTop: { value: box.top, configurable: true },
      offsetWidth: { value: box.w, configurable: true },
      offsetHeight: { value: box.h, configurable: true },
      offsetParent: { value: parent, configurable: true },
    });
  }

  /** 一行两列：侧列自己是定位祖先，机位的 offsetLeft/Top 是相对侧列的 */
  function stage(colLeft: number[], tileH = 100, gap = 6) {
    const row = document.createElement('div');
    const w = (tileH * 16) / 9;
    colLeft.forEach((left, c) => {
      const col = document.createElement('div');
      stub(col, { left, top: 0, w, h: 5 * tileH + 4 * gap }, row);
      row.appendChild(col);
      for (let i = 0; i < 5; i++) {
        const tile = document.createElement('button');
        tile.className = 'view-tile';
        tile.dataset.viewId = `c${c}t${i}`;
        tile.style.transformOrigin = `0px ${tileH / 2}px`;
        stub(tile, { left: 0, top: i * (tileH + gap), w, h: tileH }, col);
        col.appendChild(tile);
      }
    });
    document.body.appendChild(row);
    return row;
  }

  it('逐级累加 offsetParent，把两列换算到同一坐标系', () => {
    const row = stage([0, 1400]);
    const g = readGeometries(row);
    expect(g).toHaveLength(10);
    // 红列第一路在原点；蓝列第一路带着侧列的 offsetLeft
    expect(g[0].box).toMatchObject({ left: 0, top: 0 });
    expect(g[5].box).toMatchObject({ left: 1400, top: 0 });
    // 同列内 offsetTop 逐格递增（侧列 offsetTop 为 0，不重复累加）
    expect(g[1].box.top).toBe(106);
    expect(g[6].box.top).toBe(106);
    row.remove();
  });

  it('两列隔着主视角时互不遮挡——点蓝列不会误收红列', () => {
    const row = stage([0, 1400]);
    const g = readGeometries(row);
    const kept = resolveEnlarged(g, ['c0t0'], 'c1t0', 1.6, 5);
    expect(kept).toEqual(['c0t0', 'c1t0']);
    row.remove();
  });

  it('窄到两列放大后真会压上时，才让位', () => {
    const row = stage([0, 100]); // 侧列几乎贴着，放大后必然重叠
    const g = readGeometries(row);
    expect(resolveEnlarged(g, ['c0t0'], 'c1t0', 1.6, 5)).toEqual(['c1t0']);
    row.remove();
  });
});

describe('useEnlarged', () => {
  it('放大次序单调递增，刚点开的层级永远最高', () => {
    const { result } = renderHook(() => useEnlarged(createRef<HTMLElement>()));
    act(() => result.current.toggle('a'));
    act(() => result.current.toggle('b'));
    const zb = result.current.stacks.get('b')!;
    act(() => result.current.toggle('a')); // 收起 a，腾出它的序号
    act(() => result.current.toggle('c'));
    expect(result.current.stacks.get('c')!).toBeGreaterThan(zb);
    expect(result.current.stacks.get('b')).toBe(zb); // 没动的那一路层级不变
  });

  it('clear 收起全部', () => {
    const { result } = renderHook(() => useEnlarged(createRef<HTMLElement>()));
    act(() => result.current.toggle('a'));
    act(() => result.current.toggle('b'));
    act(() => result.current.clear());
    expect(result.current.stacks.size).toBe(0);
  });

  it('已经全收起时 clear 不产生新状态（避免无谓重渲染 11 路机位）', () => {
    const { result } = renderHook(() => useEnlarged(createRef<HTMLElement>()));
    const before = result.current.stacks;
    act(() => result.current.clear());
    expect(result.current.stacks).toBe(before);
  });
});
