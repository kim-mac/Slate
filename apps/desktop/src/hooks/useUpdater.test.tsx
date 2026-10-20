import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { UpdateSnapshot, UpdaterClient } from '../updaterClient';
import { useUpdater } from './useUpdater';

afterEach(cleanup);

const initial: UpdateSnapshot = {
  revision: 1,
  phase: 'available',
  currentVersion: '0.1.0',
  availableVersion: '0.2.0',
  downloadedBytes: 0,
  totalBytes: null,
  dismissed: false,
  error: null,
  installationEnabled: false,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fake() {
  let receive: ((snapshot: UpdateSnapshot) => void) | undefined;
  const stop = vi.fn();
  const client: UpdaterClient = {
    listen: vi.fn(async (handler) => {
      receive = handler;
      return stop;
    }),
    getStatus: vi.fn(async () => initial),
    check: vi.fn(async () => ({
      ...initial,
      revision: 2,
      phase: 'checking' as const,
    })),
    download: vi.fn(async () => ({
      ...initial,
      revision: 2,
      phase: 'downloading' as const,
    })),
    cancel: vi.fn(async () => ({ ...initial, revision: 3 })),
    dismiss: vi.fn(async () => ({ ...initial, revision: 3, dismissed: true })),
  };
  return { client, stop, emit: (value: UpdateSnapshot) => receive?.(value) };
}

test('loads state without triggering another automatic startup check', async () => {
  const host = fake();
  const hook = renderHook(() => useUpdater(host.client));
  await waitFor(() => expect(hook.result.current.state).toEqual(initial));
  expect(host.client.check).not.toHaveBeenCalled();
});

test('restart requires a verified ready state, enabled backend, and no active edit', async () => {
  const host = fake();
  host.client.restart = vi.fn(async () => ({
    ...initial,
    revision: 4,
    phase: 'preparing' as const,
  }));
  const hook = renderHook(({ blocked }) => useUpdater(host.client, blocked), {
    initialProps: { blocked: false },
  });
  await waitFor(() => expect(hook.result.current.state).not.toBeNull());
  await act(async () => hook.result.current.restart?.());
  expect(host.client.restart).not.toHaveBeenCalled();
  act(() => host.emit({ ...initial, revision: 2, phase: 'ready' }));
  await act(async () => hook.result.current.restart?.());
  expect(host.client.restart).not.toHaveBeenCalled();
  act(() =>
    host.emit({
      ...initial,
      revision: 3,
      phase: 'ready',
      installationEnabled: true,
    }),
  );
  hook.rerender({ blocked: true });
  await act(async () => hook.result.current.restart?.());
  expect(host.client.restart).not.toHaveBeenCalled();
  hook.rerender({ blocked: false });
  await act(async () => {
    await Promise.all([
      hook.result.current.restart?.(),
      hook.result.current.restart?.(),
    ]);
  });
  expect(host.client.restart).toHaveBeenCalledOnce();
  expect(hook.result.current.state?.phase).toBe('preparing');
});

test('a newer event cannot be overwritten by an older initial snapshot', async () => {
  const host = fake();
  const read = deferred<UpdateSnapshot>();
  host.client.getStatus = vi.fn(() => read.promise);
  const hook = renderHook(() => useUpdater(host.client));
  await waitFor(() => expect(host.client.getStatus).toHaveBeenCalled());
  act(() => host.emit({ ...initial, revision: 5, phase: 'ready' }));
  await act(async () => read.resolve(initial));
  expect(hook.result.current.state?.phase).toBe('ready');
});

test('does not reset Later state and manual check restores access', async () => {
  const host = fake();
  const hook = renderHook(() => useUpdater(host.client));
  await waitFor(() => expect(hook.result.current.state).not.toBeNull());
  await act(async () => {
    await hook.result.current.dismiss();
  });
  expect(hook.result.current.state?.dismissed).toBe(true);
  host.client.check = vi.fn(async () => ({ ...initial, revision: 4 }));
  await act(async () => {
    await hook.result.current.check();
  });
  expect(hook.result.current.state?.dismissed).toBe(false);
});

test('does not send overlapping actions even before React rerenders', async () => {
  const host = fake();
  const request = deferred<UpdateSnapshot>();
  host.client.download = vi.fn(() => request.promise);
  const hook = renderHook(() => useUpdater(host.client));
  await waitFor(() => expect(hook.result.current.state).not.toBeNull());
  let first!: Promise<void>;
  act(() => {
    first = hook.result.current.download();
    void hook.result.current.download();
  });
  expect(host.client.download).toHaveBeenCalledTimes(1);
  await act(async () => {
    request.resolve({ ...initial, revision: 2, phase: 'downloading' });
    await first;
  });
});

test('rejects downloads while an edit or mutation is active', async () => {
  const host = fake();
  const hook = renderHook(() => useUpdater(host.client, true));
  await waitFor(() => expect(hook.result.current.state).not.toBeNull());
  await act(async () => {
    await hook.result.current.download();
  });
  expect(host.client.download).not.toHaveBeenCalled();
});

test('does not overwrite newer download progress with a late command response', async () => {
  const host = fake();
  const request = deferred<UpdateSnapshot>();
  host.client.download = vi.fn(() => request.promise);
  const hook = renderHook(() => useUpdater(host.client));
  await waitFor(() => expect(hook.result.current.state).not.toBeNull());
  let action!: Promise<void>;
  act(() => {
    action = hook.result.current.download();
  });
  act(() =>
    host.emit({
      ...initial,
      revision: 8,
      phase: 'downloading',
      downloadedBytes: 50,
    }),
  );
  await act(async () => {
    request.resolve({ ...initial, revision: 2, phase: 'downloading' });
    await action;
  });
  expect(hook.result.current.state?.downloadedBytes).toBe(50);
});

test('cleans up subscriptions and ignores a late subscription after unmount', async () => {
  const host = fake();
  const listen = deferred<() => void>();
  host.client.listen = vi.fn(() => listen.promise);
  const hook = renderHook(() => useUpdater(host.client));
  hook.unmount();
  await act(async () => listen.resolve(host.stop));
  expect(host.stop).toHaveBeenCalledTimes(1);
  expect(host.client.getStatus).not.toHaveBeenCalled();
});

test('does not apply a reply from a replaced client lifecycle', async () => {
  const old = fake();
  const next = fake();
  next.client.getStatus = vi.fn(async () => ({
    ...initial,
    revision: 1,
    availableVersion: '0.3.0',
  }));
  const request = deferred<UpdateSnapshot>();
  old.client.check = vi.fn(() => request.promise);
  const hook = renderHook(({ client }) => useUpdater(client), {
    initialProps: { client: old.client },
  });
  await waitFor(() => expect(hook.result.current.state).not.toBeNull());
  let action!: Promise<void>;
  act(() => {
    action = hook.result.current.check();
  });
  hook.rerender({ client: next.client });
  await waitFor(() =>
    expect(hook.result.current.state?.availableVersion).toBe('0.3.0'),
  );
  await act(async () => {
    request.resolve({ ...initial, revision: 9 });
    await action;
  });
  expect(hook.result.current.state?.availableVersion).toBe('0.3.0');
  expect(old.stop).toHaveBeenCalledTimes(1);
});

test('reports a failed connection without blocking other application state', async () => {
  const host = fake();
  host.client.listen = vi.fn(async () => {
    throw new Error('offline');
  });
  const hook = renderHook(() => useUpdater(host.client));
  await waitFor(() => expect(hook.result.current.connectionError).toBe(true));
  expect(hook.result.current.state).toBeNull();
});

test('manual check reconnects after initial subscription failure', async () => {
  const host = fake();
  vi.mocked(host.client.listen).mockRejectedValueOnce(new Error('unavailable'));
  const hook = renderHook(() => useUpdater(host.client));
  await waitFor(() => expect(hook.result.current.connectionError).toBe(true));
  await act(async () => {
    await hook.result.current.check();
  });
  await waitFor(() => expect(hook.result.current.connectionError).toBe(false));
  expect(hook.result.current.state).not.toBeNull();
  expect(host.client.listen).toHaveBeenCalledTimes(2);
});

test('failed actions retain the offer and expose only a safe retry message', async () => {
  const host = fake();
  host.client.download = vi.fn(async () => {
    throw new Error('https://example.invalid/private?secret=abc');
  });
  const hook = renderHook(() => useUpdater(host.client));
  await waitFor(() => expect(hook.result.current.state).not.toBeNull());
  await act(async () => {
    await hook.result.current.download();
  });
  expect(hook.result.current.actionError).toBe(
    'The update action could not be completed. Try again.',
  );
  expect(hook.result.current.state?.availableVersion).toBe(
    initial.availableVersion,
  );
  expect(hook.result.current.pending).toBe(false);
  host.client.download = vi.fn(async () => ({
    ...initial,
    revision: 2,
    phase: 'downloading' as const,
  }));
  await act(async () => {
    await hook.result.current.download();
  });
  expect(hook.result.current.actionError).toBeNull();
  expect(hook.result.current.state?.phase).toBe('downloading');
});
