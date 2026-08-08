/**
 * 沙盘数据提取：从已经在播的 FPV 画面里抠出每台机器人的位置、朝向与血量。
 *
 * 之所以能这么干，是因为官方客户端在每一路第一视角里都渲染了同一套 HUD：
 * 右下小地图上的绿色圆盘就是「我」，左下血条上写着「当前/上限」。
 * 十路流各看各的自机 —— 每台机器人只由它自己那一路负责，
 * 天生没有多目标跟踪里最难的数据关联问题。
 *
 * 分层：
 *   marker.ts      小地图绿色圆盘 → 位置 + 朝向（单帧、纯函数）
 *   hp.ts          血条白字 → 当前/上限（单帧、纯函数）
 *   alive.ts       赛事 UI 是否整体灰化 → 阵亡（单帧、纯函数）
 *   streamPhase.ts 逐路自判 live / dead / off（单帧、纯函数）
 *   tracker.ts     逐路时序聚合：区分「没看见」与「死了」，上限跳变要连续确认
 *   fieldMap.ts    小地图归一化坐标 → 场地米制 + yaw（渲染层要的就是这个）
 *
 * **每一路自行判断有没有在放比赛，没有全局「开赛」标志。** 赛中某台机器人缺席时，
 * 导播会把那一路切成过渡画面，其余九路照常比赛 —— 全局标志对被切走的那一路是错的。
 * 判据是「记分板区域里现在是 HUD 还是一张照片」，见 streamPhase.ts。
 * 本模块因此不依赖 matchstate。
 *
 * 实测（2026-08-04 现网直播，rmlive.cn 浏览器 canvas 像素，多视角默认 540p=1152×648，
 * HUD 亮着的地面帧为分母）：
 *   位置    81.2%，其中有朝向 100%
 *   血量    97.8%，格式违例 0
 *   目标血量 地面路读出 100%，多路一致 86.7%
 *   开赛检测 视觉判据逐轮与真实回合边界吻合（音频主判据尚未验证，见下）
 *
 * 已知边界：
 *   - 有操作手全场关闭小地图（实测 B2），这一路只有血量没有位置
 *   - 血量很低时的红色伤害泛光会把绿色标记压到阈值下，个别帧检不出
 *   - **空中机器人没有血量**，那一路没有血条也没有记分板（三个 ROI 实测整片全黑）。
 *     传 kind:'drone' 后 tracker 会整段跳过血量与阵亡判定，hp 恒为 null
 *   - 空中位置两路不对称：条件化分母后蓝方 92%、**红方 0%**。红方自机机身被阵营底色
 *     压成发白、只剩箭头是绿的，540p 下落进色相窗的仅 9 个像素（蓝方 1092）——
 *     不是门限问题，是信号没了。1080p 下同一检测器 86.9%，即分辨率下限
 *   - 哨兵没有操作手视角，拿不到位置，沙盘上不显示
 *   - 目标血量剩下的误差是**投票投错**而非读不出：真值与误读常只差一位数字，
 *     而正确读数的置信度显著更高、误读的路数却更多，等权众数会选中错的。
 *     融合方案（置信度加权 + 下限 + 回合内单调）已在评估里验证，**尚未实现**
 *
 * 色彩前提：阈值标定在**浏览器解出的 RGB**（BT.709）上。离线抽帧默认是 BT.601，
 * 两者色相差约 3，直接拿离线像素标定会系统性偏。详见 rmui/layout.ts 的
 * SELF_MARKER_GREEN 注释与 tools/sandbox/README.md。
 */
export { detectSelfMarker, detectSelfMarkerResilient, type SelfMarker } from './marker';
export { readHp, type HpReading } from './hp';
export { readObjectives, type Objectives, type ObjectiveHp } from './objectives';
export { segmentCandidates, readField, type GlyphCandidate, type GlyphCountRange, type RawRead } from './digits';
export { isHudGreyedOut, scoreboardSaturation, scoreboardLit } from './alive';
export {
  observePhase,
  hudPresent,
  groundPhase,
  dronePhase,
  type StreamPhase,
  type PhaseSignals,
} from './streamPhase';
export {
  createRobotTracker,
  DEFAULT_TRACKER_OPTIONS,
  type RobotTracker,
  type TrackerOptions,
} from './tracker';
export { toWire, UNKNOWN_X, UNKNOWN_Y, type WireRobot } from './wire';
export { identifyRole, type RobotIdentity } from './roles';
export { roisFor, readRectsFor, mergeReadRects } from './rois';
export { createSampler, type Sampler, type SampleTarget, type SampleResult, type SamplerStats } from './sampler';
export {
  createObjectiveFusion,
  OBJECTIVE_FIELDS,
  type ObjectiveFusion,
  type FusedObjectives,
  type ObjectiveField,
} from './objectiveFusion';
export {
  createFleet,
  type Fleet,
  type FleetMember,
  type SandboxRobot,
  type SandboxSnapshot,
} from './fleet';
export {
  minimapToField,
  headingToYaw,
  markerToField,
  insideField,
  FIELD_CENTER_Y,
  FIELD_X,
  FIELD_Y,
  MINIMAP_SPAN_X,
  MINIMAP_SPAN_Y,
  MINIMAP_U0,
  MINIMAP_V0,
  DRONE_MINIMAP_U0,
  DRONE_MINIMAP_V0,
  DRONE_MINIMAP_SPAN_X,
  DRONE_MINIMAP_SPAN_Y,
  type FieldPose,
} from './fieldMap';
export type { Hp, Pose, RobotState, RobotStatus, StreamKind } from './types';
