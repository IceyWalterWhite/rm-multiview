// LeanCloud 客户端公开密钥（实测，来源 robomasters bundle）
export const LEANCLOUD = {
  appId: 'UqaoAgYDPakCHxtDiMXVy2Sw-gzGzoHsz',
  appKey: 'xYO2wtjhri9dJR7Vor8kDFl4',
  server: 'https://leancloud.robomaster.com',
} as const;

// 可用 VITE_LIVE_GAME_INFO_URL 覆盖（本地模拟直播回放：testdata/sync/mock-live.mjs）
export const LIVE_GAME_INFO_URL =
  import.meta.env.VITE_LIVE_GAME_INFO_URL ??
  'https://rm-static.djicdn.com/live_json/live_game_info.json';

export const CURRENT_MATCHES_URL =
  'https://rm-static.djicdn.com/live_json/current_and_next_matches.json';

export const QUALITY_LABELS = ['1080p', '720p', '540p'] as const;
export type QualityLabel = (typeof QUALITY_LABELS)[number];
export const DEFAULT_MAIN_QUALITY: QualityLabel = '1080p';
export const DEFAULT_MULTI_QUALITY: QualityLabel = '540p';

// role 含这些词的视角丢弃（无解说版 / 红蓝机器人合集）
export const DISCARD_ROLE_KEYWORDS = ['合集', '无解说'] as const;

// 弹幕渲染规则（实测）。身份色属"内容层"，色值保真原站——老观众靠它识别身份；
// 站点自己的界面强调色是 --accent(#ffd54a)，与 COLOR_VETERAN 近似但刻意不统一，两层各归各。
export const VETERAN_POSITION = '老队员';
export const COLOR_VETERAN = '#FFE180'; // 老队员=浅金（≠ --accent，见上）
export const COLOR_COMMON = '#F5B599';  // 队员/校友=橙粉
export const ANNIVERSARY_BADGE = 'electronicTenth';

export const CHAT_BUFFER_LIMIT = 300; // 与原站一致
