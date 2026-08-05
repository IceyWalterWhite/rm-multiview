// 官方 SaaS 的统一响应信封与 POST 封装。
// 现在只剩 getWatchProgress 一个调用方（cheer/info 改走同源代理，两个写接口从本站发不出去、已删），
// 但信封与错误码判定仍单独成文：它描述的是官方接口的约定，不是某个调用方的私事。

// code 混用字符串与数字（'S0000' / 'B200000' / 1001），保留原值再判等，不强转。
interface SaasEnvelope<T> {
  code?: unknown;
  msg?: unknown;
  success?: unknown;
  data?: T;
}

export const CODE_NOT_LOGGED_IN = 1001;       // 数字风格的未登录码
export const CODE_UNAUTHORIZED = 'B200000';   // getWatchProgress 的未登录码

export class SaasError extends Error {
  readonly code: string | number | null;
  constructor(message: string, code: string | number | null) {
    super(message);
    this.name = 'SaasError';
    this.code = code;
  }
  /** 未登录：上层据此降级为"显示登录入口"，而不是报错 */
  get needLogin(): boolean {
    return this.code === CODE_NOT_LOGGED_IN || this.code === CODE_UNAUTHORIZED;
  }
}

export function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function codeOf(env: SaasEnvelope<unknown> | null): string | number | null {
  const c = env?.code;
  return typeof c === 'string' || typeof c === 'number' ? c : null;
}

/**
 * 向官方 SaaS 发一次 POST，成功时返回 data，失败一律抛 SaasError。
 *
 * ⚠ Content-Type 是 'text/plain'，**不要**"修正"成 application/json——改了整个功能立刻挂掉。
 * 原因：saas.robomaster.com 按来源白名单放行 CORS，预检（OPTIONS）带我们的 Origin 时不返回
 * Access-Control-Allow-Origin，于是任何触发预检的请求必定失败。只有「简单请求」能出去，而
 * application/json 不在简单请求允许的三种 Content-Type 里，一设上去就变成预检请求。
 * 实测：getWatchProgress + text/plain + credentials:'include' → 200，真实读到数据；
 *       同一个调用换成 application/json → Failed to fetch（预检就被挡）。
 * 服务端并不校验这个头，body 照旧按 JSON 解析，所以下面仍然发 JSON.stringify 的结果。
 *
 * credentials:'include' 是鉴权前提（.robomaster.com 的 session cookie，实测 SameSite=None，
 * 跨站能带上）。带不上时服务端返回未登录码，走 needLogin 降级，不当错误弹给用户。
 */
export async function postSaas<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(body ?? {}),
    cache: 'no-store',
  });
  if (!res.ok) throw new SaasError(`saas ${url} HTTP ${res.status}`, null);
  const env = (await res.json()) as SaasEnvelope<T> | null;
  if (env?.success !== true) {
    throw new SaasError(String(env?.msg ?? '') || `saas ${url} failed`, codeOf(env));
  }
  return env.data as T;
}
