import { useCallback, useEffect, useRef, useState } from 'react';
import type { Danmaku, Profile } from '../types';
import { messageToDanmaku } from '../data/danmaku';
import { CHAT_BUFFER_LIMIT } from '../config';
import { connectDanmaku, type DanmakuConnection, type DanmakuStatus } from '../net/leancloud';

type ConnFactory = () => Promise<DanmakuConnection>;

const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 10000;
// 弹幕高峰每条 WS 消息各占一个宏任务，React 不跨任务合并 setState——
// 逐条上屏会把渲染频率推到消息速率（与 11 路视频解码抢主线程）。
// 攒进缓冲、按窗口统一 flush，渲染频率封顶 1000/FLUSH_MS 次每秒。
const FLUSH_MS = 200;

function retryDelayMs(attempt: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt);
}

// connect 传 null = 本场无聊天室（如搭建直播）：不建连、messages 恒空，上层据此隐藏弹幕 UI
export function useDanmaku(connect: ConnFactory | null) {
  const [messages, setMessages] = useState<Danmaku[]>([]);
  const [status, setStatus] = useState<DanmakuStatus>('connecting');
  const connRef = useRef<DanmakuConnection | null>(null);
  const bufRef = useRef<Danmaku[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    flushTimerRef.current = null;
    const batch = bufRef.current;
    if (!batch.length) return;
    bufRef.current = [];
    setMessages((prev) => {
      const next = prev.concat(batch);
      return next.length > CHAT_BUFFER_LIMIT ? next.slice(next.length - CHAT_BUFFER_LIMIT) : next;
    });
  }, []);

  const push = useCallback((d: Danmaku) => {
    const buf = bufRef.current;
    buf.push(d);
    if (buf.length > CHAT_BUFFER_LIMIT) buf.splice(0, buf.length - CHAT_BUFFER_LIMIT); // 缓冲同样有界
    if (flushTimerRef.current === null) flushTimerRef.current = setTimeout(flush, FLUSH_MS);
  }, [flush]);

  useEffect(() => () => {
    if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current);
  }, []);

  useEffect(() => {
    if (!connect) return;
    let alive = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const clearRetry = () => {
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const attemptConnect = (attempt: number) => {
      connect().then((conn) => {
        if (!alive) { void conn.close(); return; }
        clearRetry();
        connRef.current = conn;
        // alive 守卫：换赛区重连后，旧房间连接的推送不得再进当前列表
        conn.onMessage((m) => { if (alive) push(messageToDanmaku(m.id, m.text, m.attrs)); });
        conn.onStatus((s) => { if (alive) setStatus(s); });
        setStatus('connected');
      }).catch((e) => {
        console.error('[useDanmaku] connect failed', e);
        if (!alive) return;
        setStatus('reconnecting');
        retryTimer = setTimeout(() => attemptConnect(attempt + 1), retryDelayMs(attempt));
      });
    };

    attemptConnect(0);
    return () => {
      alive = false;
      clearRetry();
      void connRef.current?.close();
      connRef.current = null;
    };
  }, [connect, push]);

  const send = useCallback(async (text: string, profile: Profile) => {
    const conn = connRef.current;
    if (!conn) throw new Error('not connected');
    const raw = await conn.send(text, profile);
    push(messageToDanmaku(raw.id || 'local-' + Date.now(), raw.text, raw.attrs));
  }, [push]);

  return { messages, status, connected: status === 'connected', send };
}

export function makeLiveConnFactory(chatRoomId: string): ConnFactory {
  return () => connectDanmaku(chatRoomId);
}
