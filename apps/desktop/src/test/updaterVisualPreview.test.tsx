import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { tauriClipClient } from '../clipClient';
import {
  createPreviewUpdater,
  UpdaterVisualPreview,
} from './updaterVisualPreview';

vi.mock('../launcher/launcherClient', () => ({
  getLauncherStatus: async () => ({
    available: false,
    shortcut: 'Ctrl+Shift+Space',
    errorCode: 'preview_disabled',
  }),
}));
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function renderPreview() {
  return render(
    <UpdaterVisualPreview
      fixture={createPreviewUpdater()}
      clips={{ ...tauriClipClient, list: async () => [] }}
    />,
  );
}

test('actual sidebar shows synthetic progress without installation capability', async () => {
  renderPreview();
  const card = await screen.findByRole('region', { name: 'Slate update' });
  fireEvent.click(within(card).getByRole('button', { name: 'Update Now' }));
  const progress = await screen.findByRole('progressbar', {
    name: 'Update download',
  });
  expect(progress.getAttribute('value')).toBe('6000000');
});

test('notice stays above the footer and real theme/sidebar controls remain usable', async () => {
  renderPreview();
  const card = await screen.findByRole('region', { name: 'Slate update' });
  const footer = document.querySelector('[data-sidebar="footer"]')!;
  expect(
    card.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
  expect(document.documentElement.dataset.theme).toBe('dark');
  fireEvent.click(screen.getByRole('button', { name: 'Switch to light mode' }));
  expect(document.documentElement.dataset.theme).toBe('light');
  fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
  expect(
    screen.getByRole('button', { name: 'Show update details' }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Show update details' }));
  expect(screen.getByRole('region', { name: 'Slate update' })).toBeTruthy();
});

test('Later hides the notice and manual Check restores it without networking', async () => {
  renderPreview();
  const card = await screen.findByRole('region', { name: 'Slate update' });
  fireEvent.click(within(card).getByRole('button', { name: 'Later' }));
  await screen.findByRole('button', { name: 'Settings' });
  expect(screen.queryByRole('region', { name: 'Slate update' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Check for Updates' }),
  );
  expect(
    await screen.findByRole('region', { name: 'Slate update' }),
  ).toBeTruthy();
});

test('scenario changes render actual error, disabled restart, and preserve Settings', async () => {
  renderPreview();
  fireEvent.change(
    screen.getByRole('combobox', { name: 'Mock update state' }),
    { target: { value: 'failure' } },
  );
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'Download interrupted. Check your connection and retry.',
  );
  fireEvent.change(
    screen.getByRole('combobox', { name: 'Mock update state' }),
    { target: { value: 'ready' } },
  );
  expect(
    (
      (await screen.findByRole('button', {
        name: 'Restart to update',
      })) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(
    await screen.findByRole('button', { name: 'Check for Updates' }),
  ).toBeTruthy();
});

test('native updater preview has a separate restricted configuration', () => {
  const path = resolve('src-tauri/examples/updater-visual/tauri.conf.json');
  expect(existsSync(path)).toBe(true);
  const config = JSON.parse(readFileSync(path, 'utf8'));
  expect(config.identifier).toBe('com.aiclipmemory.updater-visual');
  expect(config.bundle.active).toBe(false);
  expect(config.app.windows).toEqual([]);
  expect(config.app.security.capabilities[0].permissions).toEqual([
    'allow-list-clips',
    'allow-get-launcher-status',
    'core:app:allow-version',
  ]);
});

test('preview is excluded from normal frontend entry points and Rust startup', () => {
  for (const path of [
    'src/main.tsx',
    'src-tauri/src/lib.rs',
    'vite.config.ts',
  ]) {
    expect(readFileSync(resolve(path), 'utf8')).not.toContain(
      'updaterVisualPreview',
    );
  }
  const path = resolve('src-tauri/examples/updater_visual.rs');
  expect(existsSync(path)).toBe(true);
  const native = readFileSync(path, 'utf8');
  expect(native).toContain('SQLITE_OPEN_READ_ONLY');
  expect(native).toContain('.data_directory(');
  expect(native).toContain('debug_assertions');
  expect(native).not.toMatch(
    /\.plugin\(|StorageState|app_data_dir|\.install\(/,
  );
});

test('preview document blocks remote transport and native navigation cannot enter normal Slate', () => {
  const html = readFileSync(resolve('visual-preview/index.html'), 'utf8');
  expect(html).toContain('http-equiv="Content-Security-Policy"');
  expect(html).not.toContain('https:');
  const native = readFileSync(
    resolve('src-tauri/examples/updater_visual.rs'),
    'utf8',
  );
  expect(native).toContain('url.path() == "/visual-preview/"');
  expect(native).toContain('NewWindowResponse::Deny');
});
