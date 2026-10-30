import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  InstallationSafetyClient,
  SafetyLease,
  SafetyLeaseKind,
  SafetySnapshot,
} from '../installationSafetyClient';

const BLOCKED =
  'Finish the current operation or try again when Slate is ready.';

// This hook owns leases, not draft content. An unmount is never proof that a draft
// was saved/cancelled. Native window lifecycle invalidates lost participants.
export function useInstallationSafety(client: InstallationSafetyClient) {
  const [connected, setConnected] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let stop: (() => void) | undefined;
    void client
      .onQuitBlocked?.(() => {
        if (active)
          setError(
            'Slate could not quit. Finish saving in Slate or Quick Search, or press Escape to cancel inline editing, then choose Quit again.',
          );
      })
      .then((unlisten) => {
        if (active) stop = unlisten;
        else unlisten();
      })
      .catch(() => {
        /* The native notification also reports the denied Quit. */
      });
    return () => {
      active = false;
      stop?.();
    };
  }, [client]);
  const current = useRef<{
    active: boolean;
    generation: number | null;
    snapshot: SafetySnapshot | null;
    leases: Map<number, SafetyLease>;
    unused: Map<number, SafetyLease>;
    pending: number;
    acknowledged: number | null;
    connection: Promise<void>;
  } | null>(null);

  const acknowledge = useCallback(() => {
    const state = current.current;
    if (
      !state?.active ||
      state.generation === null ||
      !state.snapshot?.preparing ||
      state.pending ||
      state.leases.size ||
      state.acknowledged === state.snapshot.generation
    )
      return;
    const epoch = state.snapshot.generation;
    state.acknowledged = epoch;
    void client.acknowledge(state.generation, epoch).catch(() => {
      // No acknowledgement means fail closed at the backend preparation deadline.
      if (current.current === state && state.active) setError(BLOCKED);
    });
  }, [client]);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let connecting = false;
    const state = {
      active: true,
      generation: null as number | null,
      snapshot: null as SafetySnapshot | null,
      leases: new Map<number, SafetyLease>(),
      unused: new Map<number, SafetyLease>(),
      pending: 0,
      acknowledged: null as number | null,
      connection: Promise.resolve(),
    };
    current.current = state;
    setConnected(false);
    setFrozen(false);
    setError(null);
    const receive = (next: SafetySnapshot) => {
      if (
        !state.active ||
        !Number.isSafeInteger(next.generation) ||
        next.generation < 0 ||
        (state.snapshot && next.generation <= state.snapshot.generation)
      )
        return;
      state.snapshot = next;
      setFrozen(next.preparing);
      acknowledge();
      // A renderer can load while preparation has closed registration. Once
      // that attempt ends, recover without reloading or discarding any lease.
      if (!next.preparing && state.generation === null && !connecting && stop)
        state.connection = register();
    };
    async function register() {
      connecting = true;
      const epoch = state.snapshot?.generation ?? -1;
      try {
        const registration = await client.connect();
        if (!state.active) return;
        if (
          !Number.isSafeInteger(registration.generation) ||
          registration.generation < 1
        )
          throw new Error('Invalid safety registration');
        state.generation = registration.generation;
        receive(await client.status());
        if (!state.active) return;
        setConnected(true);
        setError(null);
        acknowledge();
      } catch {
        if (state.active) {
          state.generation = null;
          setConnected(false);
          setError(BLOCKED);
        }
      } finally {
        connecting = false;
        // Also handle recovery delivered while the failed connect was pending.
        if (
          state.active &&
          state.generation === null &&
          state.snapshot &&
          !state.snapshot.preparing &&
          state.snapshot.generation > epoch
        )
          state.connection = register();
      }
    }
    state.connection = (async () => {
      stop = await client.listen(receive);
      if (!state.active) {
        stop();
        return;
      }
      await register();
    })().catch(() => {
      if (state.active) setError(BLOCKED);
    });
    return () => {
      state.active = false;
      stop?.();
      // No automatic release: crashed/replaced WebViews cannot declare old drafts safe.
    };
  }, [client, acknowledge]);

  const release = useCallback(
    async (lease: SafetyLease | null): Promise<boolean> => {
      if (!lease) return true;
      const state = current.current;
      if (
        !state?.active ||
        state.generation !== lease.generation ||
        !state.leases.has(lease.leaseId)
      )
        return false;
      try {
        await client.release(lease);
        state.leases.delete(lease.leaseId);
        state.unused.delete(lease.leaseId);
        if (state.active && current.current === state) {
          if (!state.leases.size) setError(null);
          acknowledge();
        }
        return true;
      } catch {
        if (state.active && current.current === state) setError(BLOCKED);
        return false;
      }
    },
    [client, acknowledge],
  );

  const acquire = useCallback(
    async (kind: SafetyLeaseKind): Promise<SafetyLease | null> => {
      const state = current.current;
      if (!state?.active) return null;
      state.pending++;
      try {
        await state.connection;
        if (
          !state.active ||
          current.current !== state ||
          state.generation === null ||
          state.snapshot?.preparing
        )
          return null;
        for (const unused of state.unused.values()) {
          if (!(await release(unused))) return null;
        }
        const lease = await client.acquire(state.generation, kind);
        if (
          lease.generation !== state.generation ||
          !Number.isSafeInteger(lease.leaseId) ||
          lease.leaseId < 1
        )
          throw new Error('Invalid lease');
        if (
          !state.active ||
          current.current !== state ||
          state.snapshot?.preparing
        ) {
          // Never opened an editor, so returning this unused grant loses no draft.
          if (state.active && current.current === state) {
            state.leases.set(lease.leaseId, lease);
            state.unused.set(lease.leaseId, lease);
            await release(lease);
          } else {
            await client.release(lease);
          }
          return null;
        }
        state.leases.set(lease.leaseId, lease);
        setError(null);
        return lease;
      } catch {
        if (state.active && current.current === state) setError(BLOCKED);
        return null;
      } finally {
        state.pending--;
        if (state.active && current.current === state) acknowledge();
      }
    },
    [client, acknowledge, release],
  );

  return { connected, frozen, error, acquire, release };
}

export type InstallationSafety = ReturnType<typeof useInstallationSafety>;
