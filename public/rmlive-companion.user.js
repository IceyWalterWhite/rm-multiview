// ==UserScript==
// @name         RM 多视角直播助手
// @namespace    https://rmlive.cn/
// @version      0.1.1
// @description  在本机浏览器中桥接 RoboMaster 官方人气投票与观看计时；登录 Cookie 不离开浏览器。
// @author       RM Multiview
// @match        https://rmlive.cn/*
// @match        https://www.rmlive.cn/*
// @grant        GM.xmlHttpRequest
// @connect      saas.robomaster.com
// @run-at       document-start
// @noframes
// @updateURL    https://rmlive.cn/rmlive-companion.user.js
// @downloadURL  https://rmlive.cn/rmlive-companion.user.js
// ==/UserScript==

(() => {
  'use strict';

  const page = window;
  const CHANNEL = 'rmlive:official:v1';
  const VERSION = 1;
  const DIRECTION_IN = 'page-to-script';
  const DIRECTION_OUT = 'script-to-page';
  const OFFICIAL_ORIGIN = 'https://saas.robomaster.com';
  const COOKIE_TOP_LEVEL_SITE = 'https://www.robomaster.com';
  const ALLOWED_ORIGINS = new Set(['https://rmlive.cn', 'https://www.rmlive.cn']);
  const MIN_WRITE_INTERVAL_MS = 4500;
  const lastHeartbeatAt = { value: 0 };
  const lastVoteAt = new Map();

  const endpoints = Object.freeze({
    getWatchProgress: `${OFFICIAL_ORIGIN}/registration/getWatchProgress`,
    vote: `${OFFICIAL_ORIGIN}/registration/cheer/vote`,
    heartbeat: `${OFFICIAL_ORIGIN}/registration/watchHeartbeat`,
  });

  /**
   * 消息是否来自本窗口自己（而非 iframe / opener / 其它窗口）。
   *
   * ⚠ 不能直接写 `event.source === window`：只要脚本带了任何 @grant，Tampermonkey 就在沙箱里
   * 运行它，此时 `window` 是页面 window 的 **Proxy**，而 `event.source` 是浏览器填入的**原始**
   * window 对象，`Proxy(target) !== target` —— 该判断在沙箱下恒为假，整条消息通道会被自己的
   * 安全检查焊死（2026-08-05 在 EdgeOne 预览环境实测：脚本在跑、消息到得了、就是不应答）。
   * jsdom 里没有沙箱，window === window，所以 mock 测试发现不了。
   * unsafeWindow 是 Tampermonkey always-available 的原始窗口引用，用它兜住沙箱那一侧。
   */
  function isSelfWindow(source) {
    if (source === page) return true;
    try {
      return typeof unsafeWindow !== 'undefined' && source === unsafeWindow;
    } catch {
      return false;
    }
  }

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function isId(value) {
    return typeof value === 'string' && /^\d{1,12}$/.test(value);
  }

  function cleanText(value, fallback) {
    return typeof value === 'string' && value.length > 0 ? value.slice(0, 300) : fallback;
  }

  function cleanNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
  }

  function cleanBoolean(value) {
    return typeof value === 'boolean' ? value : undefined;
  }

  function compact(object) {
    return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
  }

  function sanitizeTier(value) {
    if (!isObject(value)) return null;
    return compact({
      tier: cleanNumber(value.tier),
      thresholdSeconds: cleanNumber(value.thresholdSeconds),
      amount: cleanNumber(value.amount),
      granted: cleanBoolean(value.granted),
    });
  }

  function sanitizeData(action, value) {
    const data = isObject(value) ? value : {};
    if (action === 'getWatchProgress') {
      return compact({
        accumulatedSeconds: cleanNumber(data.accumulatedSeconds),
        tiers: Array.isArray(data.tiers)
          ? data.tiers.map(sanitizeTier).filter((tier) => tier !== null).slice(0, 20)
          : undefined,
      });
    }
    if (action === 'vote') {
      return compact({
        redVotes: cleanNumber(data.redVotes),
        blueVotes: cleanNumber(data.blueVotes),
        voteEnabled: cleanBoolean(data.voteEnabled),
      });
    }
    return compact({
      accumulatedSeconds: cleanNumber(data.accumulatedSeconds),
      rewarded: cleanBoolean(data.rewarded),
      rewardTier: cleanNumber(data.rewardTier),
      rewardAmount: cleanNumber(data.rewardAmount),
    });
  }

  function post(message) {
    page.postMessage({
      channel: CHANNEL,
      version: VERSION,
      direction: DIRECTION_OUT,
      ...message,
    }, page.location.origin);
  }

  function fail(id, code, message) {
    post({ id, ok: false, error: { code, message } });
  }

  function validatePayload(action, payload) {
    if (!isObject(payload)) return null;
    if (action === 'getWatchProgress') return {};
    if (action === 'heartbeat' && isId(payload.zoneId)) {
      return { zoneId: payload.zoneId };
    }
    if (
      action === 'vote'
      && isId(payload.matchId)
      && isId(payload.teamId)
      && Number.isInteger(payload.count)
      && payload.count >= 1
      && payload.count <= 100
    ) {
      return { matchId: payload.matchId, teamId: payload.teamId, count: payload.count };
    }
    return null;
  }

  function enforceRateLimit(action, payload) {
    const now = Date.now();
    if (action === 'heartbeat') {
      if (now - lastHeartbeatAt.value < MIN_WRITE_INTERVAL_MS) return false;
      lastHeartbeatAt.value = now;
    }
    if (action === 'vote') {
      const key = `${payload.matchId}:${payload.teamId}`;
      if (now - (lastVoteAt.get(key) || 0) < MIN_WRITE_INTERVAL_MS) return false;
      lastVoteAt.set(key, now);
    }
    return true;
  }

  async function callOfficial(action, payload) {
    const response = await GM.xmlHttpRequest({
      method: 'POST',
      url: endpoints[action],
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify(payload),
      responseType: 'json',
      timeout: 10000,
      anonymous: false,
      cookiePartition: { topLevelSite: COOKIE_TOP_LEVEL_SITE },
    });
    if (!response || response.status < 200 || response.status >= 300) {
      const status = response && typeof response.status === 'number' ? ` (${response.status})` : '';
      throw { code: 'OFFICIAL_HTTP_ERROR', message: `官方接口请求失败${status}` };
    }
    let envelope = response.response;
    if (!isObject(envelope) && typeof response.responseText === 'string' && response.responseText) {
      try {
        envelope = JSON.parse(response.responseText);
      } catch {
        throw { code: 'OFFICIAL_INVALID_RESPONSE', message: '官方接口返回了无法识别的数据' };
      }
    }
    if (!isObject(envelope)) {
      throw { code: 'OFFICIAL_INVALID_RESPONSE', message: '官方接口返回了无法识别的数据' };
    }
    if (envelope.success !== true) {
      throw {
        code: cleanText(envelope.code, 'OFFICIAL_BUSINESS_ERROR'),
        message: cleanText(envelope.msg, '官方接口拒绝了本次操作'),
      };
    }
    return sanitizeData(action, envelope.data);
  }

  page.addEventListener('message', async (event) => {
    const message = event.data;
    if (
      !isSelfWindow(event.source)
      || event.origin !== page.location.origin
      || !ALLOWED_ORIGINS.has(event.origin)
      || !isObject(message)
      || message.channel !== CHANNEL
      || message.version !== VERSION
      || message.direction !== DIRECTION_IN
      || typeof message.id !== 'string'
      || message.id.length < 1
      || message.id.length > 128
    ) return;

    if (message.action === 'probe') {
      if (!isObject(message.payload)) {
        fail(message.id, 'BRIDGE_INVALID_PAYLOAD', '探测参数无效');
        return;
      }
      post({
        id: message.id,
        ok: true,
        data: {
          scriptVersion: '0.1.1',
          manager: 'Tampermonkey',
        },
      });
      return;
    }

    if (!Object.prototype.hasOwnProperty.call(endpoints, message.action)) {
      fail(message.id, 'BRIDGE_ACTION_DENIED', '不允许的直播助手动作');
      return;
    }
    const payload = validatePayload(message.action, message.payload);
    if (payload === null) {
      fail(message.id, 'BRIDGE_INVALID_PAYLOAD', '请求参数无效');
      return;
    }
    if (!enforceRateLimit(message.action, payload)) {
      fail(message.id, 'BRIDGE_RATE_LIMIT', '操作过于频繁，请稍后再试');
      return;
    }

    try {
      post({ id: message.id, ok: true, data: await callOfficial(message.action, payload) });
    } catch (error) {
      const detail = isObject(error) ? error : {};
      fail(
        message.id,
        cleanText(detail.code, 'OFFICIAL_NETWORK_ERROR'),
        cleanText(detail.message, '无法连接 RoboMaster 官方接口'),
      );
    }
  });
})();
