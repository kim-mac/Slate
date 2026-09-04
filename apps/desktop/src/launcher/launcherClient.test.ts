import { expect, test, vi } from 'vitest';
import { connectLauncher, type LauncherHost } from './launcherClient';

test('subscribes before ready and ignores a ready snapshot superseded by an event', async () => {
  const stop = vi.fn();
  let deliver!: (state: { session: number; visible: boolean }) => void;
  let resolve!: (state: { session: number; visible: boolean }) => void;
  const host = {
    listen: vi.fn(async (handler) => {
      deliver = handler;
      return stop;
    }),
    ready: vi.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    ),
    hide: vi.fn(),
  } as LauncherHost;
  const receive = vi.fn();
  const disconnect = connectLauncher(host, receive, vi.fn());
  await vi.waitFor(() => expect(host.ready).toHaveBeenCalledOnce());
  deliver({ session: 1, visible: false });
  resolve({ session: 1, visible: true });
  await Promise.resolve();
  expect(receive.mock.calls).toEqual([[{ session: 1, visible: false }]]);
  disconnect();
  expect(stop).toHaveBeenCalledOnce();
});

test('cleans up a subscription which resolves after unmount without calling ready', async () => {
  const stop = vi.fn();
  let resolve!: (value: () => void) => void;
  const host: LauncherHost = {
    listen: () =>
      new Promise((done) => {
        resolve = done;
      }),
    ready: vi.fn(),
    hide: vi.fn(),
  };
  const disconnect = connectLauncher(host, vi.fn(), vi.fn());
  disconnect();
  resolve(stop);
  await Promise.resolve();
  expect(stop).toHaveBeenCalledOnce();
  expect(host.ready).not.toHaveBeenCalled();
});
