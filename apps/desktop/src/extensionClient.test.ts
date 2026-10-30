import { expect, test, vi } from 'vitest';
const boundary = vi.hoisted(() => ({ invoke: vi.fn(async () => undefined) }));
vi.mock('@tauri-apps/api/core', () => boundary);

test('extension opener accepts no destination or options from frontend callers', async () => {
  const { tauriExtensionClient } = await import('./extensionClient');
  await tauriExtensionClient.openListing();
  expect(boundary.invoke).toHaveBeenCalledExactlyOnceWith(
    'open_extension_listing',
  );
});
