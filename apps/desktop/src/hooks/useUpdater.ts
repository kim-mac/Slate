import { useCallback, useEffect, useRef, useState } from 'react';
import {
  updateIsBusy,
  type UpdateControls,
  type UpdateSnapshot,
  type UpdaterClient,
} from '../updaterClient';

export function useUpdater(
  client: UpdaterClient,
  blocked = false,
): UpdateControls {
  const [state, setState] = useState<UpdateSnapshot | null>(null);
  const [pending, setPending] = useState(false);
  const [connectionError, setConnectionError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const latest = useRef<UpdateSnapshot | null>(null);
  const requestPending = useRef(false);
  const lifecycle = useRef(0);
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;

  const receive = useCallback((snapshot: UpdateSnapshot) => {
    if (
      !snapshot ||
      !Number.isSafeInteger(snapshot.revision) ||
      snapshot.revision < 0
    )
      return;
    if (latest.current && snapshot.revision <= latest.current.revision) return;
    latest.current = snapshot;
    setState(snapshot);
  }, []);

  useEffect(() => {
    const generation = ++lifecycle.current;
    let active = true;
    let stop: (() => void) | undefined;
    latest.current = null;
    requestPending.current = false;
    setState(null);
    setPending(false);
    setActionError(null);
    setConnectionError(false);
    // Subscribe before reading: a progress event must win over a stale reply.
    void client
      .listen((snapshot) => {
        if (active) receive(snapshot);
      })
      .then(async (unlisten) => {
        if (!active) {
          unlisten();
          return;
        }
        stop = unlisten;
        const snapshot = await client.getStatus();
        if (active) receive(snapshot);
      })
      .catch(() => {
        if (active) setConnectionError(true);
      });
    return () => {
      active = false;
      if (lifecycle.current === generation) lifecycle.current += 1;
      stop?.();
    };
  }, [client, connectionAttempt, receive]);

  const run = useCallback(
    async (action: 'check' | 'download' | 'cancel' | 'dismiss' | 'restart') => {
      if (requestPending.current) return;
      const snapshot = latest.current;
      const busy = updateIsBusy(snapshot?.phase);
      if (action !== 'cancel' && busy) return;
      if (
        action === 'download' &&
        (blockedRef.current ||
          !snapshot?.availableVersion ||
          !['available', 'error'].includes(snapshot.phase))
      )
        return;
      if (action === 'cancel' && !busy) return;
      if (snapshot?.phase === 'preparing') return;
      if (
        action === 'restart' &&
        (blockedRef.current ||
          snapshot?.phase !== 'ready' ||
          !snapshot.installationEnabled ||
          !client.restart)
      )
        return;
      if (
        action === 'dismiss' &&
        (!snapshot || !['available', 'ready', 'error'].includes(snapshot.phase))
      )
        return;
      const generation = lifecycle.current;
      requestPending.current = true;
      setPending(true);
      setActionError(null);
      if (connectionError) setConnectionAttempt((attempt) => attempt + 1);
      try {
        const next = await client[action]!();
        if (lifecycle.current === generation) receive(next);
      } catch {
        if (lifecycle.current === generation)
          setActionError(
            'The update action could not be completed. Try again.',
          );
      } finally {
        if (lifecycle.current === generation) {
          requestPending.current = false;
          setPending(false);
        }
      }
    },
    [client, connectionError, receive],
  );

  return {
    state,
    pending,
    connectionError,
    actionError,
    check: useCallback(() => run('check'), [run]),
    download: useCallback(() => run('download'), [run]),
    cancel: useCallback(() => run('cancel'), [run]),
    dismiss: useCallback(() => run('dismiss'), [run]),
    restart: useCallback(() => run('restart'), [run]),
  };
}
