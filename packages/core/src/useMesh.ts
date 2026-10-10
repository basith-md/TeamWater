import { useEffect, useSyncExternalStore } from 'react';
import type { MeshClient } from './types';

/** The client owner disposes it; multiple phone views may subscribe to one client. */
export function useMesh(client: MeshClient) {
  useEffect(() => { client.start(); }, [client]);
  return useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
}
