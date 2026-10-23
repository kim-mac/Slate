import type { Clip } from '@ai-clip-memory/shared';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { App } from './App';
import { tauriClipClient } from './clipClient';
import { EXTENSION_DISMISSAL_KEY } from './extensionDiscoveryPreference';
import {
  deferred,
  installationSafetyFixture,
  safetyClip,
} from './test/installationSafety';

vi.mock('./launcher/launcherClient', () => ({
  getLauncherStatus: vi.fn(async () => ({
    available: true,
    shortcut: 'Ctrl+Shift+Space',
    errorCode: null,
  })),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

async function setup() {
  const safety = installationSafetyFixture();
  const saved = { ...safetyClip, content: 'Edited synthetic content' };
  const client = {
    ...tauriClipClient,
    list: vi.fn(async () => [{ kind: 'clip' as const, clip: safetyClip }]),
    update: vi.fn(async () => saved),
  };
  const extension = { openListing: vi.fn(async () => undefined) };
  render(
    <App
      client={client}
      safetyClient={safety.client}
      extensionClient={extension}
      startupClient={{
        getEnabled: async () => false,
        setEnabled: async (v) => v,
      }}
    />,
  );
  const preview = await screen.findByText(safetyClip.content, {
    selector: '.clip-list-preview',
  });
  fireEvent.click(preview.closest('button')!);
  fireEvent.click(screen.getByRole('button', { name: 'Edit content' }));
  const editor = await screen.findByRole<HTMLTextAreaElement>('textbox', {
    name: 'Clip content',
  });
  fireEvent.change(editor, { target: { value: saved.content } });
  return { client, extension, editor, safety, saved };
}

test('the extension action waits for inline persistence and lease release before opening', async () => {
  const { client, extension, safety, saved } = await setup();
  const pending = deferred<Clip>();
  const release = deferred<void>();
  safety.client.release = vi.fn(() => release.promise);
  client.update.mockReturnValue(pending.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Get the extension' }));
  await waitFor(() => expect(client.update).toHaveBeenCalledOnce());
  expect(extension.openListing).not.toHaveBeenCalled();
  expect(window.localStorage.getItem(EXTENSION_DISMISSAL_KEY)).toBeNull();
  expect(safety.client.release).not.toHaveBeenCalled();
  await act(async () => pending.resolve(saved));
  await waitFor(() => expect(safety.client.release).toHaveBeenCalledOnce());
  expect(extension.openListing).not.toHaveBeenCalled();
  expect(window.localStorage.getItem(EXTENSION_DISMISSAL_KEY)).toBeNull();
  await act(async () => release.resolve(undefined));
  await waitFor(() => expect(extension.openListing).toHaveBeenCalledOnce());
  expect(safety.client.release).toHaveBeenCalledOnce();
  expect(window.localStorage.getItem(EXTENSION_DISMISSAL_KEY)).toBe('true');
  expect(screen.queryByRole('textbox', { name: 'Clip content' })).toBeNull();
});

test('failed inline persistence never opens the listing or dismisses the suggestion; retry recovers', async () => {
  const { client, extension, safety, saved } = await setup();
  client.update.mockRejectedValueOnce(new Error('synthetic write failure'));
  fireEvent.click(screen.getByRole('button', { name: 'Get the extension' }));
  await screen.findByText(/Your draft is preserved/);
  await screen.findByText(/Could not open the extension listing/);
  expect(
    screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Clip content' })
      .value,
  ).toBe(saved.content);
  expect(extension.openListing).not.toHaveBeenCalled();
  expect(safety.client.release).not.toHaveBeenCalled();
  expect(window.localStorage.getItem(EXTENSION_DISMISSAL_KEY)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Get the extension' }));
  await waitFor(() => expect(extension.openListing).toHaveBeenCalledOnce());
  expect(client.update).toHaveBeenCalledTimes(2);
});

test('lease-cleanup failure blocks the link and retry never repeats the saved write', async () => {
  const { client, extension, safety } = await setup();
  safety.client.release = vi
    .fn()
    .mockRejectedValueOnce(new Error('synthetic IPC failure'))
    .mockResolvedValue(undefined);
  fireEvent.click(screen.getByRole('button', { name: 'Get the extension' }));
  await screen.findByText(/Content saved, but safety cleanup failed/);
  await screen.findByText(/Could not open the extension listing/);
  expect(extension.openListing).not.toHaveBeenCalled();
  expect(window.localStorage.getItem(EXTENSION_DISMISSAL_KEY)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Get the extension' }));
  await waitFor(() => expect(extension.openListing).toHaveBeenCalledOnce());
  expect(client.update).toHaveBeenCalledOnce();
  expect(safety.client.release).toHaveBeenCalledTimes(2);
});

test('focus departure plus repeated extension clicks share one save and one external action', async () => {
  const { client, extension, editor, saved } = await setup();
  const pending = deferred<Clip>();
  client.update.mockReturnValue(pending.promise);
  const button = screen.getByRole('button', { name: 'Get the extension' });
  fireEvent.blur(editor, { relatedTarget: button });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(client.update).toHaveBeenCalledOnce());
  await act(async () => pending.resolve(saved));
  await waitFor(() => expect(extension.openListing).toHaveBeenCalledOnce());
});

test('dismissing discovery never discards a failed inline draft or bypasses its lease', async () => {
  const { client, extension, safety, saved } = await setup();
  client.update.mockRejectedValue(new Error('synthetic write failure'));
  fireEvent.click(
    screen.getByRole('button', { name: 'Dismiss extension suggestion' }),
  );
  expect(
    screen.queryByRole('button', { name: 'Get the extension' }),
  ).toBeNull();
  await screen.findByText(/Your draft is preserved/);
  expect(
    screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Clip content' })
      .value,
  ).toBe(saved.content);
  expect(extension.openListing).not.toHaveBeenCalled();
  expect(safety.client.release).not.toHaveBeenCalled();
});
