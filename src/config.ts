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

// —— 官方 SaaS 接口（bundle 里叫 sassUrl / voteURL）——
//
// saas.robomaster.com 的 CORS **按来源白名单**放行（实测）：OPTIONS 带
// Origin: https://www.robomaster.com 才返回 Access-Control-Allow-Origin，带 https://rmlive.cn
// 一律不返回，/registration/ 下四个路径全都如此。推论：任何触发预检的请求从本站必定失败，
// 只有「简单请求」能出去（Content-Type 限 text/plain / x-www-form-urlencoded / multipart/form-data）。
//
// 普通网页上下文的逐条实测结果：
//   getWatchProgress —— text/plain + credentials:'include' → 200，真读到数据（session cookie 是
//                       SameSite=None，跨站能带上）；换 application/json 即预检失败。
//   cheer/info       —— 强制 application/json（任何简单 content-type 都 415，GET+查询串 405），
//                       浏览器直连无解；好在它免登录，改由服务端代理，见 functions/api/cheer.js。
//   cheer/vote —— 强制 json，普通页面发不出去。生产站只允许本机安装的 Tampermonkey
//                 直播助手通过固定动作桥接；Cookie 不经过本站服务端。
//   watchHeartbeat —— 同样受限；只由本机直播助手在严格播放门槛下发起。
export const SAAS_BASE = 'https://saas.robomaster.com';
export const WATCH_PROGRESS_URL = `${SAAS_BASE}/registration/getWatchProgress`;

/** 助威票数的同源代理（EdgeOne Pages Functions）。本地 vite dev 下该函数不存在 → 404，助威静默关闭。 */
export const CHEER_PROXY_PATH = '/api/cheer';

// DJI SSO 入口，backurl 回跳当前页
export const RM_LOGIN_OAUTH_URL = 'https://www.robomaster.com/api/members/oauth';
/** 官方直播页：脚本缺失、未登录或功能关闭时的可信降级入口。 */
export const RM_OFFICIAL_LIVE_URL = 'https://www.robomaster.com/live';
export const COMPANION_SCRIPT_URL = '/rmlive-companion.user.js';
const EDGEONE_PREVIEW_HOST = /^rm-multiview-[a-z0-9]+\.edgeone\.cool$/;

/** Preview deployments use a userscript whose @match is limited to their temporary EdgeOne host. */
export function companionScriptUrlFor(hostname: string): string {
  return EDGEONE_PREVIEW_HOST.test(hostname)
    ? '/rmlive-companion.preview.user.js'
    : COMPANION_SCRIPT_URL;
}

// 官方助威美术资源，直接引用其 CDN。
// 依赖 index.html 的 <meta name="referrer" content="no-referrer">：rm-static 按 Referer 白名单
// 做防盗链，带上我们的 Referer 会 403。改动那条 meta 前先确认这里还能加载。
const RM_ART = 'https://rm-static.djicdn.com/documents/73177';
/** 骑在接缝上的 VS 徽标（红 V 蓝 S 渐变） */
export const CHEER_VS_ICON = `${RM_ART}/360ae03bf95431784015806496447875.png`;
/** 助威飘字气泡：官方三种循环 like / fist / rocket，红蓝各一套 */
export const CHEER_BUBBLES: Record<'red' | 'blue', readonly string[]> = {
  red: [
    `${RM_ART}/76b0e36affe681784015779066819968.png`,
    `${RM_ART}/0a8cdce1b699d1784015771982372480.png`,
    `${RM_ART}/102f5f14e32461784015789171524243.png`,
  ],
  blue: [
    `${RM_ART}/9de4a71b732521784015749294932712.png`,
    `${RM_ART}/ddf3e4516b8741784015739339995248.png`,
    `${RM_ART}/603930231c22c1784015759547787918.png`,
  ],
};
/** VS 位置夹取范围（照抄官方 vsLeft）：一边倒时徽标也不掉出条子 */
export const CHEER_VS_CLAMP = { min: 8, max: 92 } as const;

export const CHEER_INFO_POLL_MS = 5_000;   // 拉双方票数
export const CHEER_TARGET_POLL_MS = 10_000; // 拉当前场次，与 useMatchTitle 同频
export const WATCH_PROGRESS_REFRESH_MIN_MS = 30000;

/**
 * 沙盘采样周期（ms）。
 *
 * 一轮要做的事：十路各一次 drawImage + 四次 getImageData，再跑一遍检测。
 * 取像素部分实测十路 36.7 ms（策略 A：整帧画一次 + 逐 ROI 读回；
 * 逐 ROI 各画各读要 171 ms）。3 Hz 下这部分约占单核 11%。
 *
 * 不做更快：机器人最快约 3 m/s，3 Hz 之间跑不到 1 米，渲染侧的临界阻尼弹簧
 * 足以补平；而每快一档，代价是全场十路的解码-读回同步点也多一档。
 */
export const SANDBOX_TICK_MS = 333;

/** 场地模型。7.6 MiB，只在用户滚到沙盘时才加载。 */
export const SANDBOX_FIELD_GLB = '/sandbox/field.meshopt.glb';
