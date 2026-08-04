export interface Danmaku {
  id: string;
  text: string;
  nickname: string;
  schoolName: string;
  position: string;   // 队员 | 老队员 | 校友 | ...
  racingAge: number;  // 0 表示无年限
  badge: string;      // 'electronicTenth' | ''
  sendTime: number;
  userId: number;
}

export interface Profile {
  nickname: string;
  schoolName: string;
  position: string;
  racingAge: number;
  badge: string;      // 'electronicTenth' | ''
}

export type Side = 'main' | 'red' | 'blue';

export interface QualitySource {
  label: string;  // '1080p' | '720p' | '540p'
  src: string;    // 含 auth_key 的 m3u8 URL
  res: string;
}
export interface StreamView {
  id: string;          // 流名，如 fight2026001
  role: string;        // 视角名
  side: Side;
  sources: QualitySource[];
}
export interface ZoneCatalog {
  zoneName: string;
  chatRoomId: string;
  main: StreamView;          // 主视角（zoneLiveString）
  redViews: StreamView[];
  blueViews: StreamView[];
  // 以下三项由 parseLiveGameInfo 始终填充；声明为可选是为了让手写的 ZoneCatalog
  // （测试夹具等）不必逐个补齐，且外部 JSON 缺字段时天然降级为"功能不开"。
  // 投票严格按这些官方开关启停；已废弃的观看心跳实现也保留这些字段，缺失时安全降级为关闭。
  zoneId?: string;           // 赛区 id
  liveState?: number;        // 1 = 官方直播中
  matchState?: number;       // 1 = 比赛进行中
  openVote?: number;         // commonConfig.openVote，官方那侧是否开放投票
}

export interface CheerTarget {
  matchId: string;
  redTeamId: string;
  blueTeamId: string;
  redLabel: string;
  blueLabel: string;
}

export interface CheerInfo {
  redVotes: number;
  blueVotes: number;
}

export interface MatchTitle {
  text: string;     // 拼好的标题，如 "超级对抗赛 北部赛区 第68场 A大学 Alpha vs B大学 Beta"
  isNext: boolean;  // true = 用的是 nextMatch（下一场预告），由组件加「下一场 」前缀
}

// —— 助威（人气值）——
// 只由 currentMatch 产生：nextMatch 还没开打，票数接口也对不上号。
export interface CheerTarget {
  matchId: string;
  redTeamId: string;
  blueTeamId: string;
  redLabel: string;   // 学校 + 队名，与标题里的取法一致
  blueLabel: string;
}

export interface CheerInfo {
  redVotes: number;
  blueVotes: number;
  voteEnabled: boolean;  // 官方接口返回的投票开关；必须与目录开关同时开启
}

// —— 观赛任务（累计时长换弹丸）——
// 时长与奖励始终由官网侧累计；本站仅通过本机直播助手同步官方状态和心跳。
export interface WatchTier {
  id: number;         // 官方 tier
  minutes: number;    // thresholdSeconds/60 四舍五入
  seconds: number;    // thresholdSeconds
  pellets: number;    // 到本档为止的累计弹丸数
  increment: number;  // 本档新增
  granted: boolean;
}

export interface WatchProgress {
  accumulatedSeconds: number;
  tiers: WatchTier[];
  earnedPellets: number;  // 最后一个 granted 档位的累计值
}
