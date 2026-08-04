const UPSTREAM = 'https://saas.robomaster.com/registration/cheer/info';
const ID_RE = /^\d{1,12}$/;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export async function onRequestGet({ request }) {
  const params = new URL(request.url).searchParams;
  const matchId = params.get('matchId') ?? '';
  const redTeamId = params.get('redTeamId') ?? '';
  const blueTeamId = params.get('blueTeamId') ?? '';
  if (![matchId, redTeamId, blueTeamId].every((value) => ID_RE.test(value))) {
    return json({ code: 'E400', msg: 'invalid match/team id', success: false, data: null }, 400);
  }

  let upstream;
  try {
    upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId, redTeamId, blueTeamId }),
    });
  } catch {
    return json({ code: 'E502', msg: 'upstream unreachable', success: false, data: null }, 502);
  }

  if (!upstream.ok) {
    return json({ code: 'E502', msg: `upstream HTTP ${upstream.status}`, success: false, data: null }, 502);
  }

  return new Response(await upstream.text(), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
