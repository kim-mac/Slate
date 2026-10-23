import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import type {
  InstallationSafetyClient,
  SafetySnapshot,
} from '../installationSafetyClient';
import { useInstallationSafety } from './useInstallationSafety';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  let receive!: (snapshot: SafetySnapshot) => void;
  let id = 0;
  const client: InstallationSafetyClient = {
    listen: vi.fn(async (next) => {
      receive = next;
      return vi.fn();
    }),
    connect: vi.fn(async () => ({ generation: 7 })),
    status: vi.fn(async () => ({ generation: 0, preparing: false })),
    acquire: vi.fn(async (generation) => ({ generation, leaseId: ++id })),
    release: vi.fn(async () => undefined),
    acknowledge: vi.fn(async () => undefined),
  };
  return {
    client,
    emit: (snapshot: SafetySnapshot) => act(() => receive(snapshot)),
  };
}

test('acquires before admitting an editor and keeps its lease until explicit release', async () => {
  const fake = fixture();
  const { result } = renderHook(() => useInstallationSafety(fake.client));
  let lease: Awaited<ReturnType<typeof result.current.acquire>>;
  await act(async () => {
    lease = await result.current.acquire('editor');
  });
  expect(lease!).toEqual({ generation: 7, leaseId: 1 });
  expect(fake.client.acquire).toHaveBeenCalledWith(7, 'editor');
  fake.emit({ generation: 1, preparing: true });
  expect(fake.client.acknowledge).not.toHaveBeenCalled();
  await act(async () => {
    await result.current.release(lease!);
  });
  await waitFor(() =>
    expect(fake.client.acknowledge).toHaveBeenCalledWith(7, 1),
  );
});

test('a denied tray Quit explains safe draft recovery and clears after explicit resolution', async () => {
  const fake = fixture();
  let blocked!: () => void;
  const stop = vi.fn();
  fake.client.onQuitBlocked = async (handler) => {
    blocked = handler;
    return stop;
  };
  const { result, unmount } = renderHook(() =>
    useInstallationSafety(fake.client),
  );
  await waitFor(() => expect(result.current.connected).toBe(true));
  let lease: Awaited<ReturnType<typeof result.current.acquire>>;
  await act(async () => {
    lease = await result.current.acquire('editor');
  });
  act(() => blocked());
  expect(result.current.error).toContain('Slate could not quit');
  expect(result.current.error).toContain('Escape');
  expect(fake.client.release).not.toHaveBeenCalled();
  await act(async () => {
    await result.current.release(lease!);
  });
  expect(result.current.error).toBeNull();
  unmount();
  expect(stop).toHaveBeenCalledOnce();
});

test('freezes admission and acknowledges a clean window without changing application state', async () => {
  const fake = fixture();
  const { result } = renderHook(() => useInstallationSafety(fake.client));
  await waitFor(() => expect(result.current.connected).toBe(true));
  fake.emit({ generation: 1, preparing: true });
  expect(result.current.frozen).toBe(true);
  expect(await result.current.acquire('editor')).toBeNull();
  expect(fake.client.acquire).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(fake.client.acknowledge).toHaveBeenCalledWith(7, 1),
  );
  fake.emit({ generation: 2, preparing: false });
  expect(result.current.frozen).toBe(false);
});

test('late preparation snapshots cannot freeze a recovered generation', async () => {
  const fake = fixture();
  const old = deferred<SafetySnapshot>();
  fake.client.status = vi.fn(() => old.promise);
  const { result } = renderHook(() => useInstallationSafety(fake.client));
  await waitFor(() => expect(fake.client.status).toHaveBeenCalled());
  fake.emit({ generation: 2, preparing: false });
  await act(async () => old.resolve({ generation: 1, preparing: true }));
  expect(result.current.frozen).toBe(false);
  expect(fake.client.acknowledge).not.toHaveBeenCalled();
});

test('an in-flight acquisition cannot acknowledge clean or open an editor after freezing', async () => {
  const fake = fixture();
  const pending = deferred<{ generation: number; leaseId: number }>();
  fake.client.acquire = vi.fn(() => pending.promise);
  const { result } = renderHook(() => useInstallationSafety(fake.client));
  await waitFor(() => expect(result.current.connected).toBe(true));
  let acquisition!: ReturnType<typeof result.current.acquire>;
  act(() => {
    acquisition = result.current.acquire('editor');
  });
  await waitFor(() => expect(fake.client.acquire).toHaveBeenCalled());
  fake.emit({ generation: 1, preparing: true });
  expect(fake.client.acknowledge).not.toHaveBeenCalled();
  await act(async () => pending.resolve({ generation: 7, leaseId: 1 }));
  expect(await acquisition).toBeNull();
  expect(fake.client.release).toHaveBeenCalledWith({
    generation: 7,
    leaseId: 1,
  });
  await waitFor(() =>
    expect(fake.client.acknowledge).toHaveBeenCalledWith(7, 1),
  );
});

test('failed releases retain the blocker and do not acknowledge clean', async () => {
  const fake = fixture();
  fake.client.release = vi
    .fn()
    .mockRejectedValue(new Error('synthetic IPC failure'));
  const { result } = renderHook(() => useInstallationSafety(fake.client));
  let lease!: NonNullable<Awaited<ReturnType<typeof result.current.acquire>>>;
  await act(async () => {
    lease = (await result.current.acquire('confirmation'))!;
  });
  fake.emit({ generation: 1, preparing: true });
  await act(async () => {
    expect(await result.current.release(lease)).toBe(false);
  });
  expect(fake.client.acknowledge).not.toHaveBeenCalled();
});

test('unmount does not silently release an open draft lease', async () => {
  const fake = fixture();
  const { result, unmount } = renderHook(() =>
    useInstallationSafety(fake.client),
  );
  await act(async () => {
    await result.current.acquire('editor');
  });
  unmount();
  expect(fake.client.release).not.toHaveBeenCalled();
});

test('connection failure is fail closed rather than admitting an unguarded editor', async () => {
  const fake = fixture();
  fake.client.connect = vi
    .fn()
    .mockRejectedValue(new Error('synthetic disconnect'));
  const { result } = renderHook(() => useInstallationSafety(fake.client));
  await act(async () => {
    expect(await result.current.acquire('editor')).toBeNull();
  });
  expect(fake.client.acquire).not.toHaveBeenCalled();
  expect(result.current.connected).toBe(false);
});

test('an unused late grant survives failed cleanup and is retired before another acquisition', async () => {
  const fake = fixture();
  const pending = deferred<{ generation: number; leaseId: number }>();
  fake.client.acquire = vi
    .fn()
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValue({ generation: 7, leaseId: 2 });
  fake.client.release = vi
    .fn()
    .mockRejectedValueOnce(new Error('synthetic cleanup failure'))
    .mockResolvedValue(undefined);
  const { result } = renderHook(() => useInstallationSafety(fake.client));
  await waitFor(() => expect(result.current.connected).toBe(true));
  let acquisition!: ReturnType<typeof result.current.acquire>;
  act(() => {
    acquisition = result.current.acquire('editor');
  });
  await waitFor(() => expect(fake.client.acquire).toHaveBeenCalledOnce());
  fake.emit({ generation: 1, preparing: true });
  await act(async () => pending.resolve({ generation: 7, leaseId: 1 }));
  expect(await acquisition).toBeNull();
  expect(fake.client.acknowledge).not.toHaveBeenCalled();
  fake.emit({ generation: 2, preparing: false });
  await act(async () => {
    expect(await result.current.acquire('editor')).toEqual({
      generation: 7,
      leaseId: 2,
    });
  });
  expect(fake.client.release).toHaveBeenNthCalledWith(2, {
    generation: 7,
    leaseId: 1,
  });
  expect(fake.client.release).toHaveBeenCalledTimes(2);
});

test('registration refused during preparation recovers on the next idle generation', async () => {
  const fake = fixture();
  fake.client.connect = vi
    .fn()
    .mockRejectedValueOnce(new Error('installation_preparing'))
    .mockResolvedValue({ generation: 8 });
  fake.client.status = vi.fn(async () => ({ generation: 2, preparing: false }));
  const { result } = renderHook(() => useInstallationSafety(fake.client));
  await waitFor(() => expect(result.current.error).toBeTruthy());
  fake.emit({ generation: 1, preparing: true });
  expect(await result.current.acquire('editor')).toBeNull();
  fake.emit({ generation: 2, preparing: false });
  await waitFor(() => expect(result.current.connected).toBe(true));
  await act(async () => {
    expect(await result.current.acquire('editor')).toEqual({
      generation: 8,
      leaseId: 1,
    });
  });
  expect(fake.client.connect).toHaveBeenCalledTimes(2);
});
