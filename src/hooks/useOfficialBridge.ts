import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createOfficialBridgeClient,
  OfficialBridgeError,
  type BridgePayloads,
  type OfficialBridgeAction,
  type OfficialBridgeClient,
  type OfficialBridgeStatus,
} from '../net/officialBridge';

type WritableAction = Exclude<OfficialBridgeAction, 'probe'>;

export interface OfficialBridgeApi {
  status: OfficialBridgeStatus;
  request: <A extends WritableAction>(action: A, payload: BridgePayloads[A]) => Promise<unknown>;
  retry: () => Promise<void>;
}

export function useOfficialBridge(
  enabled = true,
  createClient: () => OfficialBridgeClient = createOfficialBridgeClient,
): OfficialBridgeApi {
  const clientRef = useRef<OfficialBridgeClient | null>(null);
  const factoryRef = useRef(createClient);
  const [statusSnapshot, setStatusSnapshot] = useState<{
    enabled: boolean;
    status: OfficialBridgeStatus;
  }>({ enabled, status: enabled ? 'probing' : 'missing' });

  useEffect(() => { factoryRef.current = createClient; });

  useEffect(() => {
    if (!enabled) return;
    const client = factoryRef.current();
    clientRef.current = client;
    const sync = () => setStatusSnapshot({ enabled: true, status: client.getStatus() });
    const unsubscribe = client.subscribe(sync);
    void client.probe().catch(() => undefined);
    return () => {
      unsubscribe();
      client.close();
      if (clientRef.current === client) clientRef.current = null;
    };
  }, [enabled]);

  const request = useCallback(<A extends WritableAction>(action: A, payload: BridgePayloads[A]) => {
    const client = clientRef.current;
    if (!enabled || !client) {
      return Promise.reject(new OfficialBridgeError('直播助手未启用', 'BRIDGE_NOT_READY'));
    }
    return client.request(action, payload);
  }, [enabled]);

  const retry = useCallback(async () => {
    if (!enabled || !clientRef.current) return;
    await clientRef.current.probe();
  }, [enabled]);

  const status: OfficialBridgeStatus = statusSnapshot.enabled === enabled
    ? statusSnapshot.status
    : enabled ? 'probing' : 'missing';
  return useMemo(() => ({ status, request, retry }), [status, request, retry]);
}
