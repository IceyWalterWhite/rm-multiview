import { describe, it, expect } from 'vitest';
import { identifyRole } from './roles';

/** 现网 live_game_info.json 里逐字抄下来的机位名（2026-08-05）。 */
const LIVE_ROLES = [
  '红方英雄第一视角',
  '红方工程第一视角',
  '红方3号步兵第一视角',
  '红方4号步兵第一视角',
  '红方空中机器人第一视角',
  '蓝方英雄第一视角',
  '蓝方工程第一视角',
  '蓝方3号步兵第一视角',
  '蓝方4号步兵第一视角',
  '蓝方空中机器人第一视角',
];

describe('identifyRole', () => {
  it('现网十路全部认得出，且身份两两不重', () => {
    const ids = LIVE_ROLES.map(identifyRole);
    expect(ids.every((x) => x !== null)).toBe(true);
    const keys = new Set(ids.map((x) => `${x!.team}${x!.num}`));
    // 十路必须映到十个互不相同的身份 —— 撞号意味着有一台车会被另一台覆盖
    expect(keys.size).toBe(10);
  });

  it('按官方编号映射，不按出现次序', () => {
    expect(identifyRole('红方英雄第一视角')).toEqual({ team: 'red', num: 1, kind: 'ground' });
    expect(identifyRole('蓝方工程第一视角')).toEqual({ team: 'blue', num: 2, kind: 'ground' });
    expect(identifyRole('红方3号步兵第一视角')).toEqual({ team: 'red', num: 3, kind: 'ground' });
    expect(identifyRole('蓝方4号步兵第一视角')).toEqual({ team: 'blue', num: 4, kind: 'ground' });
  });

  it('空中的两种叫法都认，且标成 drone', () => {
    // 东部赛区叫「无人机」，其余赛区叫「空中机器人」，同一个编号
    expect(identifyRole('红方空中机器人第一视角')).toEqual({ team: 'red', num: 6, kind: 'drone' });
    expect(identifyRole('红方无人机第一视角')).toEqual({ team: 'red', num: 6, kind: 'drone' });
  });

  it('认不出就是 null，不猜', () => {
    // 猜错会把 A 车的坐标画到 B 车头上，观众没有任何办法看出来 —— 比不画更糟
    expect(identifyRole('主视角（无解说版）')).toBeNull();
    expect(identifyRole('红方机器人第一视角合集')).toBeNull(); // 多宫格合集，没有单一自机
    expect(identifyRole('')).toBeNull();
    expect(identifyRole('英雄第一视角')).toBeNull(); // 没有阵营就不能落地
  });
});
