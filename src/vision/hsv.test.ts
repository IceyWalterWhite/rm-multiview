import { describe, it, expect } from 'vitest';
import { rgbToHsv, inHsvRange } from './hsv';
import { SELF_MARKER_GREEN, TEAM_RED, TEAM_BLUE } from '../rmui/layout';

describe('rgbToHsv', () => {
  // 这三组是从真实录屏里用 cv2 量出来的均值。数值必须与 OpenCV 逐一对上，
  // 否则 layout.ts 里那些标定过的阈值会集体失准。
  it('matches OpenCV on the self-marker green sampled from the recording', () => {
    expect(rgbToHsv(58, 200, 146)).toEqual({ h: 79, s: 181, v: 200 });
  });

  it('matches OpenCV on the power-rune yellow-green sampled from the recording', () => {
    expect(rgbToHsv(161, 213, 83)).toEqual({ h: 42, s: 156, v: 213 });
  });

  it('reports zero saturation for greys without dividing by zero', () => {
    expect(rgbToHsv(128, 128, 128)).toEqual({ h: 0, s: 0, v: 128 });
    expect(rgbToHsv(0, 0, 0)).toEqual({ h: 0, s: 0, v: 0 });
  });
});

describe('inHsvRange', () => {
  it('accepts the self marker and rejects the power rune', () => {
    expect(inHsvRange(58, 200, 146, SELF_MARKER_GREEN)).toBe(true);
    expect(inHsvRange(161, 213, 83, SELF_MARKER_GREEN)).toBe(false);
  });

  it('rejects the cyan blue-team icons that sit next to the marker on the minimap', () => {
    // 蓝方图标色相 ≥90，与自机绿只隔几度，是最容易误收的一类
    expect(rgbToHsv(60, 200, 220).h).toBeGreaterThan(86);
    expect(inHsvRange(60, 200, 220, SELF_MARKER_GREEN)).toBe(false);
  });

  it('treats the red range as circular across hue 0', () => {
    // 血条红实测 RGB(210,47,59) → 色相 178，落在 0 点的另一侧；
    // 不按环形处理的话整条红色血条一个像素都收不到
    expect(rgbToHsv(210, 47, 59).h).toBeGreaterThan(170);
    expect(inHsvRange(210, 47, 59, TEAM_RED)).toBe(true);
    expect(inHsvRange(255, 0, 0, TEAM_RED)).toBe(true); // h=0，区间的另一端
    expect(inHsvRange(210, 47, 59, TEAM_BLUE)).toBe(false);
  });

  it('accepts the cyan-leaning UI blue but not pure blue', () => {
    // 血条蓝实测 RGB(54,170,226) → 色相 ≈99。纯蓝是 120，不在 UI 阵营色里 ——
    // 把区间放宽到 120 会开始收进画面里的天空和灯光
    expect(inHsvRange(54, 170, 226, TEAM_BLUE)).toBe(true);
    expect(inHsvRange(0, 0, 255, TEAM_BLUE)).toBe(false);
  });

  it('rejects dark or washed-out pixels before touching hue', () => {
    expect(inHsvRange(10, 30, 22, SELF_MARKER_GREEN)).toBe(false); // 太暗
    expect(inHsvRange(200, 220, 210, SELF_MARKER_GREEN)).toBe(false); // 太淡
  });
});
