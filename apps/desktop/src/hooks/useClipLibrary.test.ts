import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { Clip, LibraryItem } from '@ai-clip-memory/shared';
import { afterEach, expect, test, vi } from 'vitest';
import { useClipLibrary } from './useClipLibrary';

afterEach(cleanup);
const clip = { id: 'a', createdAt: '2026-09-03T12:00:00.000Z' } as Clip;
const clipItem: LibraryItem = { kind: 'clip', clip };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
test('initial failure is retryable without exposing internal errors', async () => {
  const client = {
    list: vi
      .fn()
      .mockRejectedValueOnce(new Error('secret SQL'))
      .mockResolvedValueOnce([clipItem]),
  };
  const { result } = renderHook(() => useClipLibrary(client));
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.loadError).toBe(
    'Could not load local clips. Try again.',
  );
  await act(() => result.current.refresh());
  expect(result.current.clips).toEqual([clipItem]);
  expect(result.current.loadError).toBeNull();
});
test('shows safe recovery guidance when established storage is missing', async () => {
  const client = {
    list: vi.fn().mockRejectedValue({
      code: 'storage_missing',
      message:
        'The established local clip database is missing. Restore it, or explicitly delete app data before reinstalling to start over.',
    }),
  };
  const { result } = renderHook(() => useClipLibrary(client));
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.loadError).toContain('missing');
  expect(result.current.loadError).toContain('Restore');
});
test('retains existing rows after refresh failure', async () => {
  const client = {
    list: vi
      .fn()
      .mockResolvedValueOnce([clipItem])
      .mockRejectedValueOnce(new Error('private')),
  };
  const { result } = renderHook(() => useClipLibrary(client));
  await waitFor(() => expect(result.current.clips).toEqual([clipItem]));
  await act(() => result.current.refresh());
  expect(result.current.clips).toEqual([clipItem]);
  expect(result.current.loadError).toBeTruthy();
});
test('ignores older requests and invalidated mutation snapshots', async () => {
  const first = deferred<LibraryItem[]>();
  const second = deferred<LibraryItem[]>();
  const client = {
    list: vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise),
  };
  const { result } = renderHook(() => useClipLibrary(client));
  let refresh!: Promise<void>;
  act(() => {
    refresh = result.current.refresh();
  });
  await act(async () => {
    second.resolve([clipItem]);
    await refresh;
  });
  await act(async () => {
    first.resolve([]);
    await first.promise;
  });
  expect(result.current.clips).toEqual([clipItem]);
  const pending = deferred<LibraryItem[]>();
  client.list.mockReturnValueOnce(pending.promise);
  act(() => {
    refresh = result.current.refresh();
  });
  act(() => {
    result.current.invalidate();
    result.current.setClips([]);
  });
  await act(async () => {
    pending.resolve([clipItem]);
    await refresh;
  });
  expect(result.current.clips).toEqual([]);
});
test('unmount invalidates an outstanding request', async () => {
  const pending = deferred<LibraryItem[]>();
  const { result, unmount } = renderHook(() =>
    useClipLibrary({ list: () => pending.promise }),
  );
  const before = result.current;
  unmount();
  await act(async () => {
    pending.resolve([clipItem]);
    await pending.promise;
  });
  expect(result.current).toBe(before);
});
