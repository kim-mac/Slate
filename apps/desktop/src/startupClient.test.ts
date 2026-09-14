import { beforeEach, expect, test, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { tauriStartupClient } from './startupClient';

beforeEach(() => {
  invoke.mockReset();
});

test('reads the actual autostart state through the narrow command', async () => {
  invoke.mockResolvedValueOnce(true);

  await expect(tauriStartupClient.getEnabled()).resolves.toBe(true);
  expect(invoke).toHaveBeenCalledWith('get_autostart_enabled');
});

test('sets autostart and returns the re-read OS state', async () => {
  invoke.mockResolvedValueOnce(false);

  await expect(tauriStartupClient.setEnabled(false)).resolves.toBe(false);
  expect(invoke).toHaveBeenCalledWith('set_autostart_enabled', {
    enabled: false,
  });
});
