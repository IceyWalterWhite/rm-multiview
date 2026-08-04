// EdgeOne Pages Function —— GET /api/cheer，官方助威票数的同源只读代理。
// 路由由目录结构决定：functions/api/cheer.js → /api/cheer。
//
// 为什么必须绕服务端一趟（实测结论，别按"直连更简单"改回去）：
//   1. saas.robomaster.com 按来源白名单放行 CORS，预检带我们的 Origin 时不返回
//      Access-Control-Allow-Origin —— 任何触发预检的请求从浏览器必定失败；
//   2. 官方 cheer/info 又强制 application/json（换任何简单 content-type 都 415，
//      GET+查询串 405），而 application/json 一定触发预检。
// 两条相乘 = 浏览器直连无解。好在它免登录：服务端 fetch 不需要转发任何凭证，
// 也就不存在把用户 session 借给别人的问题。
const UPSTREAM = 'https://saas.robomaster.com/registration/cheer/info';

// 只放行纯数字 id。上游地址写死 + 参数限形，避免本函数退化成开放代理。
const ID_RE = /^\d{1,12}$/;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // 票数是实时值，任何一层缓存都会让人气条卡住
      'Cache-Control': 'no-store',
    },
  });
}

export async function onRequestGet({ request }) {
  const { searchParams } = new URL(request.url);
  const matchId = searchParams.get('matchId') ?? '';
  const redTeamId = searchParams.get('redTeamId') ?? '';
  const blueTeamId = searchParams.get('blueTeamId') ?? '';
  if (![matchId, redTeamId, blueTeamId].every((v) => ID_RE.test(v))) {
    return json({ code: 'E400', msg: 'invalid match/team id', success: false, data: null }, 400);
  }

  let upstream;
  try {
    upstream = await fetch(UPSTREAM, {
      method: 'POST',
      // 上游强制 json；这里是服务端到服务端，没有 CORS，可以放心用
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId, redTeamId, blueTeamId }),
    });
  } catch {
    return json({ code: 'E502', msg: 'upstream unreachable', success: false, data: null }, 502);
  }

  // 上游任何非 2xx 一律折成 502：把 404 留给"本函数没部署"这一种情况，
  // 前端据此判定「代理不在」并彻底关掉助威轮询，不至于被上游的 404 误伤。
  if (!upstream.ok) {
    return json({ code: 'E502', msg: `upstream HTTP ${upstream.status}`, success: false, data: null }, 502);
  }

  // 原样透传信封（{ code, msg, success, data }），解析口径留在前端一处
  return new Response(await upstream.text(), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
