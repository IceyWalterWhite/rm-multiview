import { useCallback, useEffect, useRef, useState } from 'react';
import type { Danmaku, Profile } from '../types';
import { messageToDanmaku } from '../data/danmaku';
import { CHAT_BUFFER_LIMIT } from '../config';
import { connectDanmaku, type DanmakuConnection, type DanmakuStatus } from '../net/leancloud';

type ConnFactory = () => Promise<DanmakuConnection>;

const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 10000;

function retryDelayMs(attempt: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt);
}

export function useDanmaku(connect: ConnFactory) {
  const [messages, setMessages] = useState<Danmaku[]>([]);
  const [status, setStatus] = useState<DanmakuStatus>('connecting');
  const connRef = useRef<DanmakuConnection | null>(null);

  const push = useCallback((d: Danmaku) => {
    setMessages((prev) => {
      const next = prev.length >= CHAT_BUFFER_LIMIT ? prev.slice(prev.length - CHAT_BUFFER_LIMIT + 1) : prev.slice();
      next.push(d);
      return next;
    });
  }, []);

  useEffect(() => {
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
        conn.onMessage((m) => {
          if (alive) push(messageToDanmaku(m.id, m.text, m.attrs));
        });
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
