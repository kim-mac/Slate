import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { beforeEach, expect, test, vi } from 'vitest';
import { tauriUpdaterClient, type UpdateSnapshot } from './updaterClient';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

const state: UpdateSnapshot = {
  revision: 0,
  phase: 'unconfigured',
  currentVersion: '0.1.0',
  availableVersion: null,
  downloadedBytes: 0,
  totalBytes: null,
  dismissed: false,
  error: null,
  installationEnabled: false,
};

test.each([
  ['getStatus', 'get_update_status'],
  ['check', 'check_for_updates'],
  ['download', 'download_update'],
  ['cancel', 'cancel_update'],
  ['dismiss', 'dismiss_update'],
  ['restart', 'restart_to_update'],
] as const)(
  '%s sends only its narrow command without configuration or content',
  async (action, command) => {
    vi.mocked(invoke).mockResolvedValue(state);
    await expect(tauriUpdaterClient[action]!()).resolves.toEqual(state);
    expect(invoke).toHaveBeenCalledExactlyOnceWith(command);
  },
);

test('subscribes only to updater metadata and returns the native unsubscribe', async () => {
  const stop = vi.fn();
  vi.mocked(listen).mockResolvedValue(stop);
  const receive = vi.fn();
  expect(await tauriUpdaterClient.listen(receive)).toBe(stop);
  expect(listen).toHaveBeenCalledWith(
    'slate:update-state',
    expect.any(Function),
  );
  vi.mocked(listen).mock.calls[0]![1]({
    event: 'slate:update-state',
    id: 1,
    payload: state,
  });
  expect(receive).toHaveBeenCalledExactlyOnceWith(state);
});

test('exposes only a no-argument consent command, not SDK install or endpoint/key setters', () => {
  expect(Object.keys(tauriUpdaterClient).sort()).toEqual(
    [
      'listen',
      'getStatus',
      'check',
      'download',
      'cancel',
      'dismiss',
      'restart',
    ].sort(),
  );
});
