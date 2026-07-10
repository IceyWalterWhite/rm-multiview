import { Realtime, TextMessage, Event } from 'leancloud-realtime';
import { LEANCLOUD } from '../config';
import type { Profile } from '../types';

export interface RawMessage { id: string; text: string; attrs: Record<string, unknown>; }
export type DanmakuStatus = 'connecting' | 'connected' | 'reconnecting';
export interface DanmakuConnection {
  onMessage: (cb: (m: RawMessage) => void) => void;
  onStatus: (cb: (s: DanmakuStatus) => void) => void;
  send: (text: string, profile: Profile) => Promise<RawMessage>;
  close: () => Promise<void>;
}

// LeanCloud SDK doesn't export these types; declare minimal structural interfaces
// covering only the methods/properties we actually use.
interface IMClient {
  on(event: string, handler: (msg: unknown) => void): void;
  getConversation(id: string): Promise<Conversation>;
}

interface Conversation {
  transient: boolean;
  join(): Promise<unknown>;
  queryMessages(options: { limit: number }): Promise<LCMessage[]>;
  send(msg: TextMessage): Promise<LCMessage>;
}

interface LCMessage {
  id?: string;
  text?: string;
  getAttributes(): Record<string, unknown> | undefined;
  getText(): string | undefined;
}

function randomClientId(): string {
  let s = '';
  for (let i = 0; i < 17; i++) s += Math.floor(Math.random() * 10);
  return s.replace(/^0/, '1');
}

// Realtime 对同一 appId 是单例：重复 `new Realtime` 会抛 "App is already
// initialized"（React StrictMode 双挂载 / HMR 会触发）。模块级缓存复用。
let realtimeSingleton: Realtime | null = null;
function getRealtime(): Realtime {
  if (!realtimeSingleton) {
    realtimeSingleton = new Realtime({ appId: LEANCLOUD.appId, appKey: LEANCLOUD.appKey, server: LEANCLOUD.server });
  }
  return realtimeSingleton;
}

// 连接也按 chatRoomId 缓存为单例：StrictMode 双挂载 / 多消费者都复用同一个
// IMClient + 会话 + WebSocket。close() 故意为 no-op——若按挂载关闭，会拆掉
// 共享的底层连接，导致存活组件收不到实时推送（历史走 REST 仍能拿到，于是表现
// 为"有历史无实时"）。SPA 单条弹幕流存活整个页面生命周期即可。
const connections = new Map<string, Promise<DanmakuConnection>>();

export function connectDanmaku(
  chatRoomId: string,
  factory: (id: string) => Promise<DanmakuConnection> = createConnection,
): Promise<DanmakuConnection> {
  let p = connections.get(chatRoomId);
  if (!p) {
    // 失败即逐出缓存：否则这条已 reject 的 promise 会被后续调用永久复用，
    // SDK 重连也救不回来（拿到的还是旧的失败结果）。
    p = factory(chatRoomId).catch((e) => { connections.delete(chatRoomId); throw e; });
    connections.set(chatRoomId, p);
  }
  return p;
}

async function createConnection(chatRoomId: string): Promise<DanmakuConnection> {
  const realtime = getRealtime();
  const client = await realtime.createIMClient(randomClientId()) as unknown as IMClient;
  const conv: Conversation = await client.getConversation(chatRoomId);
  if (conv.transient) { try { await conv.join(); } catch { /* transient join may noop */ } }

  const toRaw = (message: LCMessage): RawMessage => {
    const attrs = message.getAttributes?.() ?? {};
    const text = message.text !== undefined ? message.text : (message.getText?.() ?? '');
    return { id: String(message.id ?? ''), text, attrs };
  };

  let handler: ((m: RawMessage) => void) | null = null;
  const pending: RawMessage[] = []; // live messages arriving before onMessage is registered
  client.on(Event.MESSAGE, (message: unknown) => {
    const raw = toRaw(message as LCMessage);
    if (handler) handler(raw);
    else pending.push(raw);
  });

  // 连接状态机：SDK 自带 WS 重连，但瞬态聊天室成员关系在重连后不自动恢复，
  // 必须重新 join 才能续收实时推送（Event.MESSAGE 监听器本身在重连后仍有效）。
  let statusHandler: ((s: DanmakuStatus) => void) | null = null;
  let status: DanmakuStatus = 'connected';
  const setStatus = (s: DanmakuStatus) => { status = s; statusHandler?.(s); };
  client.on(Event.DISCONNECT, () => setStatus('reconnecting'));
  client.on(Event.RECONNECT, async () => {
    if (!conv.transient) { setStatus('connected'); return; }
    try { await conv.join(); setStatus('connected'); }
    catch { setStatus('reconnecting'); } // join 失败则维持重连中，SDK 会再次触发 reconnect
  });

  // 入会拉最近历史填充列表（瞬态聊天室支持 queryMessages，按时间升序返回）
  let history: RawMessage[] = [];
  try {
    const hist: LCMessage[] = await conv.queryMessages({ limit: 50 });
    history = (hist ?? []).map(toRaw);
  } catch { /* history is optional */ }

  return {
    onMessage(cb) {
      handler = cb;
      history.forEach(cb);     // recent history first (oldest→newest)
      pending.forEach(cb);     // then any live messages buffered during setup
      pending.length = 0;
    },
    onStatus(cb) { statusHandler = cb; cb(status); },
    async send(text, profile) {
      const attrs = {
        username: `${profile.racingAge}-${profile.position}-${profile.schoolName}-${profile.nickname}`,
        nickname: profile.nickname, schoolName: profile.schoolName, position: profile.position,
        racingAge: profile.racingAge, badge: profile.badge, sendTime: Date.now(), userId: 0,
      };
      const msg = new TextMessage(text);
      msg.setAttributes(attrs);
      const sent = await conv.send(msg);
      return { id: String(sent.id ?? ''), text, attrs };
    },
    async close() {
      // Keep the shared SDK/WebSocket alive, but detach callbacks from the
      // consumer that is unmounting or switching rooms. Otherwise a stale room
      // can keep pushing messages into the current React tree after navigation.
      handler = null;
      statusHandler = null;
    },
  };
}
