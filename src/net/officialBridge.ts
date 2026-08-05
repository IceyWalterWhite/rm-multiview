export const BRIDGE_CHANNEL = 'rmlive:official:v1' as const;
export const BRIDGE_VERSION = 1 as const;

export type OfficialBridgeStatus = 'probing' | 'missing' | 'ready' | 'error';
export type OfficialBridgeAction = 'probe' | 'getWatchProgress' | 'vote' | 'heartbeat';

export interface OfficialBridgeMetadata {
  scriptVersion: string;
  manager: string;
}

export interface BridgePayloads {
  probe: Record<string, never>;
  getWatchProgress: Record<string, never>;
  vote: { matchId: string; teamId: string; count: number };
  heartbeat: { zoneId: string };
}

export interface BridgeRequest<A extends OfficialBridgeAction = OfficialBridgeAction> {
  channel: typeof BRIDGE_CHANNEL;
  version: typeof BRIDGE_VERSION;
  direction: 'page-to-script';
  id: string;
  action: A;
  payload: BridgePayloads[A];
}

export interface BridgeResponse {
  channel: typeof BRIDGE_CHANNEL;
  version: typeof BRIDGE_VERSION;
  direction: 'script-to-page';
  id: string;
  ok: boolean;
  data?: unknown;
  error?: { code: string | number; message: string };
}

export class OfficialBridgeError extends Error {
  readonly code: string | number;

  constructor(message: string, code: string | number) {
    super(message);
    this.name = 'OfficialBridgeError';
    this.code = code;
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: OfficialBridgeError) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface OfficialBridgeClient {
  getStatus: () => OfficialBridgeStatus;
  subscribe: (listener: () => void) => () => void;
  probe: () => Promise<OfficialBridgeMetadata>;
  request: <A extends Exclude<OfficialBridgeAction, 'probe'>>(
    action: A,
    payload: BridgePayloads[A],
  ) => Promise<unknown>;
  close: () => void;
}

interface ClientOptions {
  target?: Window;
  origin?: string;
  timeoutMs?: number;
}

let fallbackSequence = 0;

function requestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  fallbackSequence += 1;
  return `rmlive-${Date.now()}-${fallbackSequence}`;
}

function isBridgeResponse(value: unknown): value is BridgeResponse {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<BridgeResponse>;
  return v.channel === BRIDGE_CHANNEL
    && v.version === BRIDGE_VERSION
    && v.direction === 'script-to-page'
    && typeof v.id === 'string'
    && typeof v.ok === 'boolean';
}

function bridgeError(response: BridgeResponse): OfficialBridgeError {
  const code = response.error?.code;
  const safeCode = typeof code === 'string' || typeof code === 'number' ? code : 'BRIDGE_FAILED';
  const message = typeof response.error?.message === 'string' && response.error.message
    ? response.error.message
    : '直播助手请求失败';
  return new OfficialBridgeError(message, safeCode);
}

export function createOfficialBridgeClient(options: ClientOptions = {}): OfficialBridgeClient {
  const target = options.target ?? window;
  const origin = options.origin ?? window.location.origin;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const pending = new Map<string, Pending>();
  const listeners = new Set<() => void>();
  let status: OfficialBridgeStatus = 'probing';
  let closed = false;

  const setStatus = (next: OfficialBridgeStatus) => {
    if (status === next) return;
    status = next;
    listeners.forEach((listener) => listener());
  };

  const onMessage = (event: MessageEvent<unknown>) => {
    if (closed || event.source !== target || event.origin !== origin || !isBridgeResponse(event.data)) return;
    const item = pending.get(event.data.id);
    if (!item) return;
    pending.delete(event.data.id);
    clearTimeout(item.timer);
    if (event.data.ok) item.resolve(event.data.data);
    else item.reject(bridgeError(event.data));
  };
  target.addEventListener('message', onMessage as EventListener);

  const send = <A extends OfficialBridgeAction>(action: A, payload: BridgePayloads[A]): Promise<unknown> => {
    if (closed) return Promise.reject(new OfficialBridgeError('直播助手连接已关闭', 'BRIDGE_CLOSED'));
    const id = requestId();
    const message: BridgeRequest<A> = {
      channel: BRIDGE_CHANNEL,
      version: BRIDGE_VERSION,
      direction: 'page-to-script',
      id,
      action,
      payload,
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new OfficialBridgeError('未检测到直播助手', 'BRIDGE_TIMEOUT'));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      target.postMessage(message, origin);
    });
  };

  return {
    getStatus: () => status,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    probe: async () => {
      if (closed) throw new OfficialBridgeError('直播助手连接已关闭', 'BRIDGE_CLOSED');
      setStatus('probing');
      try {
        const data = await send('probe', {});
        const meta = data as Partial<OfficialBridgeMetadata> | null;
        if (!meta || typeof meta.scriptVersion !== 'string' || typeof meta.manager !== 'string') {
          throw new OfficialBridgeError('直播助手协议不兼容', 'BRIDGE_PROTOCOL');
        }
        setStatus('ready');
        return { scriptVersion: meta.scriptVersion, manager: meta.manager };
      } catch (error) {
        const e = error instanceof OfficialBridgeError
          ? error
          : new OfficialBridgeError('直播助手探测失败', 'BRIDGE_FAILED');
        setStatus(e.code === 'BRIDGE_TIMEOUT' ? 'missing' : 'error');
        throw e;
      }
    },
    request: (action, payload) => {
      if (status !== 'ready') {
        return Promise.reject(new OfficialBridgeError('直播助手尚未就绪', 'BRIDGE_NOT_READY'));
      }
      return send(action, payload);
    },
    close: () => {
      if (closed) return;
      closed = true;
      target.removeEventListener('message', onMessage as EventListener);
      const error = new OfficialBridgeError('直播助手连接已关闭', 'BRIDGE_CLOSED');
      pending.forEach((item) => {
        clearTimeout(item.timer);
        item.reject(error);
      });
      pending.clear();
      setStatus('error');
      listeners.clear();
    },
  };
}
