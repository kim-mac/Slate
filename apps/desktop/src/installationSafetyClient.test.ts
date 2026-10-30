import { expect, test, vi } from 'vitest';

const boundary = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: boundary.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: boundary.listen }));

test('safety IPC passes only generation-bound participant commands, never preparation or installation', async () => {
  const { tauriInstallationSafetyClient: client } = await vi.importActual<
    typeof import('./installationSafetyClient')
  >('./installationSafetyClient');
  await client.connect();
  await client.status();
  await client.acquire(3, 'editor');
  await client.release({ generation: 3, leaseId: 7 });
  await client.acknowledge(3, 9);
  expect(boundary.invoke.mock.calls).toEqual([
    ['connect_installation_safety'],
    ['get_installation_safety_status'],
    ['acquire_installation_lease', { generation: 3, kind: 'editor' }],
    ['release_installation_lease', { generation: 3, leaseId: 7 }],
    [
      'acknowledge_installation_safety',
      { windowGeneration: 3, preparationGeneration: 9 },
    ],
  ]);
  expect(Object.keys(client).sort()).toEqual([
    'acknowledge',
    'acquire',
    'connect',
    'hideMainAfterSave',
    'listen',
    'onCloseRequested',
    'onQuitBlocked',
    'release',
    'status',
  ]);
  const receive = vi.fn();
  await client.listen(receive);
  expect(boundary.listen).toHaveBeenCalledWith(
    'slate:installation-safety',
    expect.any(Function),
  );
  boundary.listen.mock.calls[0]![1]({
    payload: { preparing: true, generation: 9 },
  });
  expect(receive).toHaveBeenCalledWith({ preparing: true, generation: 9 });
  const quitBlocked = vi.fn();
  await client.onQuitBlocked!(quitBlocked);
  expect(boundary.listen).toHaveBeenCalledWith(
    'slate:quit-blocked',
    quitBlocked,
  );
  const closeRequested = vi.fn();
  await client.onCloseRequested!(closeRequested);
  expect(boundary.listen).toHaveBeenCalledWith(
    'slate:inline-close-requested',
    closeRequested,
  );
  await client.hideMainAfterSave!();
  expect(boundary.invoke).toHaveBeenLastCalledWith(
    'hide_main_after_inline_save',
  );
  await client.acquire(3, 'inline');
  expect(boundary.invoke).toHaveBeenLastCalledWith(
    'acquire_installation_lease',
    { generation: 3, kind: 'inline' },
  );
});
