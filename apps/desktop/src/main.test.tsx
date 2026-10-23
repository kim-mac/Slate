import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const native = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  getName: vi.fn(async () => 'AI Clip Memory'),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: native.isTauri }));
vi.mock('@tauri-apps/api/app', () => ({ getName: native.getName }));
// Test entry-point routing/mounting without starting the library or updater IPC.
vi.mock('./App', () => ({ App: () => <main>Ordinary Slate</main> }));
vi.mock('./ux-dev/UxDevApp', () => ({
  UxDevApp: () => <main>Isolated UX Slate</main>,
}));

beforeEach(() => {
  vi.resetModules();
  native.isTauri.mockReset().mockReturnValue(true);
  native.getName.mockReset().mockResolvedValue('AI Clip Memory');
  vi.stubEnv('DEV', true);
  document.body.innerHTML = '<div id="root"></div>';
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.unstubAllEnvs();
});

test('ordinary Tauri development mounts when optional name permission is denied', async () => {
  native.getName.mockRejectedValue(new Error('app.name not allowed'));
  await import('./main');
  await screen.findByText('Ordinary Slate');
  expect(native.getName).toHaveBeenCalledTimes(1);
});

test('browser-only development mounts without attempting native IPC', async () => {
  native.isTauri.mockReturnValue(false);
  await import('./main');
  await screen.findByText('Ordinary Slate');
  expect(native.getName).not.toHaveBeenCalled();
});

test('ordinary Tauri development with a readable name mounts the normal application', async () => {
  await import('./main');
  await screen.findByText('Ordinary Slate');
});

test('isolated UX development still selects the isolated application', async () => {
  native.getName.mockResolvedValue('Slate UX Development');
  await import('./main');
  await screen.findByText('Isolated UX Slate');
  expect(screen.queryByText('Ordinary Slate')).toBeNull();
});

test('production mounts normally without any development identity lookup', async () => {
  vi.stubEnv('DEV', false);
  native.getName.mockResolvedValue('Slate UX Development');
  await import('./main');
  await screen.findByText('Ordinary Slate');
  expect(native.getName).not.toHaveBeenCalled();
  expect(native.isTauri).not.toHaveBeenCalled();
});

test('startup still rejects a missing root element', async () => {
  document.body.innerHTML = '';
  await expect(import('./main')).rejects.toThrow('Root element not found');
  await waitFor(() => expect(native.getName).not.toHaveBeenCalled());
});
