// 演示模式数据源：当前只有人气助威条使用 demoCheer。其余全量假直播数据均已废弃，
// 仅作为未来重设计时的参考保留，不进线上主 bundle。
import type { MatchTitle, Profile, StreamView, ZoneCatalog } from '../types';
import type { DanmakuConnection, RawMessage } from '../net/leancloud';
import { QUALITY_LABELS, RM_OFFICIAL_LIVE_URL } from '../config';

// "demo:视角名[:retry]" 由 VideoPlayer 识别为占位画面；三档画质同源即可
function demoView(id: string, role: string, side: StreamView['side'], retry = false): StreamView {
  const src = `demo:${role}${retry ? ':retry' : ''}`;
  return { id, role, side, sources: QUALITY_LABELS.map((label) => ({ label, src, res: '' })) };
}

/** @deprecated Full fake-live catalog; the active demo does not render it. */
export const demoCatalog: ZoneCatalog = {
  zoneName: '演示赛区',
  chatRoomId: 'demo-room',
  main: demoView('demo-main', '主视角', 'main'),
  redViews: [
    demoView('demo-r1', '红方·英雄', 'red'),
    demoView('demo-r2', '红方·工程', 'red'),
    demoView('demo-r3', '红方·3号步兵', 'red'),
    demoView('demo-r4', '红方·4号步兵', 'red'),
    demoView('demo-r5', '红方·空中', 'red', true), // 常驻「信号中断」浮层：预览重试样式
  ],
  blueViews: [
    demoView('demo-b1', '蓝方·英雄', 'blue'),
    demoView('demo-b2', '蓝方·工程', 'blue'),
    demoView('demo-b3', '蓝方·3号步兵', 'blue'),
    demoView('demo-b4', '蓝方·4号步兵', 'blue'),
    demoView('demo-b5', '蓝方·空中', 'blue'),
  ],
};

// 足够长：可预览场次标题的循环滚动（跑马灯只在溢出时启动）
/** @deprecated Full fake-live title source; the active demo does not render it. */
export const demoTitleFetcher = async (): Promise<MatchTitle | null> => ({
  text: '超级对抗赛 南部赛区 第 42 场 · 演示大学 DEMO 战队 vs 示例学院 SAMPLE 战队（本页为演示数据，非真实赛况）',
  isNext: false,
});

// 助威演示：队名取自真实对阵格式（校名 + 队名）。
// 页面自己发不出投票请求——官方接口强制 application/json，必然触发 CORS 预检，
// 而预检只白名单 robomaster.com；线上能投票是靠直播助手（油猴脚本）代发。
// 所以 ?demo 里 canVote 恒 false（没有助手），?stagedemo 里恒 true（本地假投票，只验手感）。
export const demoCheer = {
  redLabel: '演示大学 DEMO',
  blueLabel: '示例学院 SAMPLE',
  baseRed: 2628,
  baseBlue: 2397,
  officialUrl: RM_OFFICIAL_LIVE_URL,
};

/**
 * 观看时长档位的假数据，线上实测口径：7/10/30 分钟 → 累计 500/1500/4500 弹丸。
 * 供组件测试与 `?stagedemo` 的胶囊预览使用。
 */
export const demoWatchTiers = [
  { id: 1, minutes: 7, seconds: 420, pellets: 500, increment: 500, granted: true },
  { id: 2, minutes: 10, seconds: 600, pellets: 1500, increment: 1000, granted: false },
  { id: 3, minutes: 30, seconds: 1800, pellets: 4500, increment: 3000, granted: false },
];
/** @deprecated See demoWatchTiers. */
export const demoWatchSeconds = 492;
/** @deprecated See demoWatchTiers. */
export const demoWatchPellets = 500;

interface PoolEntry { text: string; nickname: string; schoolName: string; position: string; racingAge: number; badge: string; }
const P = (text: string, nickname: string, schoolName: string, position = '队员', racingAge = 0, badge = ''): PoolEntry =>
  ({ text, nickname, schoolName, position, racingAge, badge });

// 弹幕池：覆盖三种身份色、徽章、长短文本（长文本考验轨道估宽与跑马灯）
const POOL: PoolEntry[] = [
  P('英雄这发大弹丸太稳了', '弹道之神', '演示大学'),
  P('3号步兵好猛，走位拉满', '小陀螺', '示例学院', '老队员', 3, 'electronicTenth'),
  P('666666', '路过的校友', '样例理工', '校友', 5),
  P('工程救援车速起飞！', '龙门吊', '演示大学', '队员', 1),
  P('这波兑换血亏吧', '经济学人', '示例学院', '老队员', 2),
  P('飞坡！！！', '起飞', '样例科技', '队员', 0, 'electronicTenth'),
  P('哨兵自瞄有点准啊', '云台手', '演示大学', '校友', 4),
  P('基地要碎了快回防！！', '指挥', '示例学院'),
  P('裁判系统这判罚没问题吗，我看半天没看懂这个规则到底怎么算的', '规则背诵机', '样例理工', '老队员', 6),
  P('对面阵容想打前压速攻', '战术板', '演示大学', '队员', 2),
  P('打符成功，起飞了', '打符人', '示例学院', '队员', 1, 'electronicTenth'),
  P('这解说好懂哥', '观众甲', '样例科技', '校友', 0),
];

// 连接延迟 ~1.2s：让「弹幕连接中…」横幅可被预览（修复 #1 的悬浮横幅）
const CONNECT_DELAY_MS = 1200;
const EMIT_MS = 900;

/** @deprecated Full fake-live chat source; the active demo does not render it. */
export function makeDemoConnFactory(): () => Promise<DanmakuConnection> {
  return () =>
    new Promise((resolve) => {
      setTimeout(() => {
        let msgCb: ((m: RawMessage) => void) | null = null;
        let n = 0;
        const emit = () => {
          const p = POOL[n % POOL.length];
          n += 1;
          msgCb?.({
            id: `demo-${n}`,
            text: p.text,
            attrs: { nickname: p.nickname, schoolName: p.schoolName, position: p.position, racingAge: p.racingAge, badge: p.badge, sendTime: Date.now(), userId: 9000 + (n % 40) },
          });
        };
        const timer = setInterval(() => {
          emit();
          // 周期性小爆发：3 条同帧到达，演示多轨道并行与爆发丢弃策略
          if (n % 9 === 0) { emit(); emit(); }
        }, EMIT_MS);
        resolve({
          onMessage: (cb) => { msgCb = cb; },
          onStatus: () => { /* 演示连接不掉线 */ },
          send: async (text: string, profile: Profile) => ({
            id: `demo-self-${Date.now()}`,
            text,
            attrs: { nickname: profile.nickname, schoolName: profile.schoolName, position: profile.position, racingAge: profile.racingAge, badge: profile.badge, sendTime: Date.now(), userId: 1 },
          }),
          close: async () => { clearInterval(timer); },
        });
      }, CONNECT_DELAY_MS);
    });
}
