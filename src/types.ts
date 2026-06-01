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
}

export interface MatchTitle {
  text: string;     // 拼好的标题，如 "超级对抗赛 北部赛区 第68场 A大学 Alpha vs B大学 Beta"
  isNext: boolean;  // true = 用的是 nextMatch（下一场预告），由组件加「下一场 」前缀
}
