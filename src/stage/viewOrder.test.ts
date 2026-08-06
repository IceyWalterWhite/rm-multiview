import { describe, it, expect } from 'vitest';
import { swap, move, reconcile } from './viewOrder';

const TEN = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];

/** 顺序操作的共同不变量：是原集合的一个排列——不丢、不重、不凭空多 */
function expectPermutationOf(got: readonly string[], src: readonly string[]) {
  expect(got.length).toBe(src.length);
  expect([...got].sort()).toEqual([...src].sort());
}

describe('swap', () => {
  it('交换两个位置，其余不动', () => {
    expect(swap(TEN, 0, 3)).toEqual(['d', 'b', 'c', 'a', 'e', 'f', 'g', 'h', 'i', 'j']);
  });

  it('结果是原集合的排列', () => {
    for (const [a, b] of [[0, 9], [4, 5], [2, 7], [9, 0]] as const) {
      expectPermutationOf(swap(TEN, a, b), TEN);
    }
  });

  it('自己换自己是恒等', () => {
    expect(swap(TEN, 4, 4)).toEqual(TEN);
  });

  it('越界下标原样返回，不抛不损坏', () => {
    expect(swap(TEN, -1, 3)).toEqual(TEN);
    expect(swap(TEN, 0, 99)).toEqual(TEN);
  });

  it('不改原数组', () => {
    const src = [...TEN];
    swap(src, 1, 8);
    expect(src).toEqual(TEN);
  });
});

describe('move', () => {
  it('往后移：中间元素整体前移一格', () => {
    expect(move(TEN, 0, 3)).toEqual(['b', 'c', 'd', 'a', 'e', 'f', 'g', 'h', 'i', 'j']);
  });

  it('往前移：中间元素整体后移一格', () => {
    expect(move(TEN, 3, 0)).toEqual(['d', 'a', 'b', 'c', 'e', 'f', 'g', 'h', 'i', 'j']);
  });

  it('结果是原集合的排列', () => {
    for (const [f, t] of [[0, 9], [9, 0], [4, 5], [5, 4], [2, 7]] as const) {
      expectPermutationOf(move(TEN, f, t), TEN);
    }
  });

  it('原地移动是恒等', () => {
    expect(move(TEN, 6, 6)).toEqual(TEN);
  });

  it('越界下标原样返回', () => {
    expect(move(TEN, -1, 2)).toEqual(TEN);
    expect(move(TEN, 2, 42)).toEqual(TEN);
  });

  it('不改原数组', () => {
    const src = [...TEN];
    move(src, 0, 9);
    expect(src).toEqual(TEN);
  });
});

describe('reconcile', () => {
  it('名单没变时原样保留用户排好的顺序', () => {
    const mine = ['c', 'a', 'b'];
    expect(reconcile(mine, ['a', 'b', 'c'])).toEqual(mine);
  });

  it('新增的路接在末尾，已有顺序不动', () => {
    expect(reconcile(['c', 'a'], ['a', 'b', 'c'])).toEqual(['c', 'a', 'b']);
  });

  it('消失的路被剔除，其余相对次序不变', () => {
    expect(reconcile(['c', 'a', 'b'], ['a', 'c'])).toEqual(['c', 'a']);
  });

  it('首次进入（空顺序）直接采用名单顺序', () => {
    expect(reconcile([], ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('整份名单换掉时全量采用新的', () => {
    expect(reconcile(['a', 'b'], ['x', 'y'])).toEqual(['x', 'y']);
  });

  it('签名过期重取产出内容相同的名单时，顺序必须纹丝不动', () => {
    // useCatalog 在 HLS 签名过期时重取，会产出内容相同的新数组。
    // 这里若按对象身份重置，用户拖好的排布会在一场比赛里被反复清掉。
    const mine = ['j', 'a', 'e', 'b', 'c', 'd', 'f', 'g', 'h', 'i'];
    expect(reconcile(mine, [...TEN])).toEqual(mine);
  });
});
