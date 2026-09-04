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
import { Launcher } from './Launcher';
import type { LauncherHost, LauncherState } from './launcherClient';

const older: Clip = {
  id: 'older',
  title: 'Older note',
  content: 'local-first notes',
  contentType: 'text',
  sourceApp: 'Claude',
  sourceUrl: null,
  sourcePageTitle: null,
  isPinned: true,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
};
const newer: Clip = {
  ...older,
  id: 'newer',
  title: 'Recent note',
  content: 'TypeScript guide',
  sourceApp: 'ChatGPT',
  createdAt: '2026-09-02T00:00:00Z',
};
function setup() {
  let deliver!: (state: LauncherState) => void;
  const host: LauncherHost = {
    listen: vi.fn(async (handler) => {
      deliver = handler;
      return vi.fn();
    }),
    ready: vi.fn(async () => ({ session: 1, visible: true })),
    hide: vi.fn(async () => undefined),
  };
  const client = {
    list: vi.fn(async () => [older, newer]),
    copyContent: vi
      .fn<(id: string) => Promise<void>>()
      .mockResolvedValue(undefined),
  };
  render(<Launcher host={host} client={client} />);
  return {
    host,
    client,
    emit: (state: LauncherState) => act(() => deliver(state)),
  };
}
afterEach(cleanup);
test('restores search focus when the native webview receives focus after rendering', async () => {
  setup();
  const search = await screen.findByRole('searchbox');
  (search as HTMLInputElement).blur();
  expect(document.activeElement).not.toBe(search);
  fireEvent.focus(window);
  expect(document.activeElement).toBe(search);
});
test('ignores a stale load from a dismissed session and preserves IME composition', async () => {
  const { client, emit } = setup();
  await screen.findByRole('option', { name: /Recent note/ });
  let resolve!: (clips: Clip[]) => void;
  client.list.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  emit({ session: 2, visible: true });
  emit({ session: 2, visible: false });
  emit({ session: 3, visible: true });
  await screen.findByRole('option', { name: /Recent note/ });
  await act(async () => resolve([]));
  expect(screen.getAllByRole('option')).toHaveLength(2);
  const search = screen.getByRole('searchbox');
  fireEvent.compositionStart(search);
  fireEvent.keyDown(search, { key: 'Enter' });
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  expect(client.copyContent).not.toHaveBeenCalled();
  expect(screen.getAllByRole('option')[0]!.getAttribute('aria-selected')).toBe(
    'true',
  );
  fireEvent.compositionEnd(search);
});
test('a failed hide can be retried without copying again', async () => {
  const { client, host } = setup();
  await screen.findByRole('option', { name: /Recent note/ });
  vi.mocked(host.hide).mockRejectedValueOnce(
    new Error('private native detail'),
  );
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
  await screen.findByRole('button', { name: 'Retry closing' });
  fireEvent.click(screen.getByRole('button', { name: 'Retry closing' }));
  await waitFor(() => expect(host.hide).toHaveBeenCalledTimes(2));
  expect(client.copyContent).toHaveBeenCalledTimes(1);
});
test('focuses search, orders recent clips, uses existing multi-term rules and keeps typing during navigation', async () => {
  const { client } = setup();
  const search = await screen.findByRole('searchbox');
  await screen.findByRole('option', { name: /Recent note/ });
  expect(document.activeElement).toBe(search);
  expect(screen.getAllByRole('option')[0]!.textContent).toContain(
    'Recent note',
  );
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  expect(screen.getAllByRole('option')[1]!.getAttribute('aria-selected')).toBe(
    'true',
  );
  expect(document.activeElement).toBe(search);
  fireEvent.change(search, { target: { value: 'CLAUDE local' } });
  expect(screen.getAllByRole('option')).toHaveLength(1);
  fireEvent.keyDown(search, { key: 'Enter' });
  await waitFor(() => expect(client.copyContent).toHaveBeenCalledWith('older'));
});
test('deduplicates Enter and hides only after successful copy', async () => {
  const { client, host } = setup();
  await screen.findByRole('option', { name: /Recent note/ });
  let resolve!: () => void;
  client.copyContent.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const search = screen.getByRole('searchbox');
  fireEvent.keyDown(search, { key: 'Enter', repeat: true });
  fireEvent.keyDown(search, { key: 'Enter', isComposing: true });
  fireEvent.keyDown(search, { key: 'Enter', shiftKey: true });
  expect(client.copyContent).not.toHaveBeenCalled();
  fireEvent.keyDown(search, { key: 'Enter' });
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(client.copyContent).toHaveBeenCalledTimes(1);
  expect(host.hide).not.toHaveBeenCalled();
  await act(async () => resolve());
  expect(host.hide).toHaveBeenCalledWith(1);
});
test('Escape hides without copying; new sessions reload/reset, repeated invocation only focuses', async () => {
  const { client, host, emit } = setup();
  const search = await screen.findByRole('searchbox');
  await screen.findByRole('option', { name: /Recent note/ });
  fireEvent.change(search, { target: { value: 'guide' } });
  emit({ session: 1, visible: true });
  expect((search as HTMLInputElement).value).toBe('guide');
  expect(client.list).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(search, { key: 'Escape' });
  expect(host.hide).toHaveBeenCalledWith(1);
  expect(client.copyContent).not.toHaveBeenCalled();
  emit({ session: 1, visible: false });
  emit({ session: 2, visible: true });
  await waitFor(() => expect(client.list).toHaveBeenCalledTimes(2));
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
});
test('copy failure stays open, hides raw errors and supports retry', async () => {
  const { client, host } = setup();
  await screen.findByRole('option', { name: /Recent note/ });
  client.copyContent.mockRejectedValueOnce(
    new Error('sensitive database details'),
  );
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
  const error = await screen.findByRole('alert');
  expect(error.textContent).not.toContain('sensitive');
  expect(host.hide).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry copy' }));
  await waitFor(() => expect(host.hide).toHaveBeenCalledWith(1));
});

test('a copy error with no selected result cannot dismiss the launcher through retry', async () => {
  const { client, host } = setup();
  await screen.findByRole('option', { name: /Recent note/ });
  client.copyContent.mockRejectedValueOnce(new Error('copy failed'));
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
  await screen.findByRole('alert');
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: 'no match' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Retry copy' }));
  expect(host.hide).not.toHaveBeenCalled();
});
test('dismissed sessions ignore stale copy completion', async () => {
  const { client, host, emit } = setup();
  await screen.findByRole('option', { name: /Recent note/ });
  let resolve!: () => void;
  client.copyContent.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
  emit({ session: 1, visible: false });
  emit({ session: 2, visible: true });
  await act(async () => resolve());
  expect(host.hide).not.toHaveBeenCalled();
});
test('load errors are safe and retryable, with empty and no-match states', async () => {
  const { client, emit } = setup();
  await screen.findByRole('option', { name: /Recent note/ });
  client.list.mockRejectedValueOnce(new Error('private path'));
  emit({ session: 2, visible: true });
  expect((await screen.findByRole('alert')).textContent).not.toContain(
    'private',
  );
  client.list.mockResolvedValueOnce([]);
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
  await screen.findByText('No clips yet');
  emit({ session: 3, visible: true });
  await screen.findByRole('option', { name: /Recent note/ });
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: 'missing' },
  });
  expect(screen.getByText('No matching clips')).toBeTruthy();
});
