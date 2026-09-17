import type { Clip, ClipInput } from '@ai-clip-memory/shared';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
    openTin: vi.fn(async () => undefined),
  };
  const client = {
    list: vi.fn(async () => [older, newer]),
    create: vi.fn(async () => ({
      ...newer,
      id: 'created',
      title: null,
      content: 'Created locally',
      contentType: 'text' as const,
      sourceApp: null,
      sourceUrl: null,
      sourcePageTitle: null,
    })),
    update: vi.fn(async (id: string, input: ClipInput) => ({
      ...newer,
      ...input,
      id,
    })),
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
afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

test.each(['light', 'dark'] as const)(
  'uses the persisted %s desktop theme',
  async (theme) => {
    window.localStorage.setItem('ai-clip-memory-theme', theme);
    setup();

    await screen.findByRole('searchbox');
    expect(document.documentElement.dataset.theme).toBe(theme);
  },
);

test('updates an open launcher when the shared desktop theme preference changes', async () => {
  window.localStorage.setItem('ai-clip-memory-theme', 'light');
  setup();
  await screen.findByRole('searchbox');

  window.localStorage.setItem('ai-clip-memory-theme', 'dark');
  window.dispatchEvent(
    new StorageEvent('storage', { key: 'ai-clip-memory-theme' }),
  );

  expect(document.documentElement.dataset.theme).toBe('dark');
});

test('limits dragging to the header and opens Tin through the launcher host', async () => {
  const { host } = setup();
  await screen.findByRole('option', { name: /Recent note/ });

  const header = screen.getByRole('banner');
  expect(header.hasAttribute('data-tauri-drag-region')).toBe(true);
  expect(
    screen.getByRole('searchbox').hasAttribute('data-tauri-drag-region'),
  ).toBe(false);
  expect(
    document
      .querySelector('.launcher-preview')
      ?.hasAttribute('data-tauri-drag-region'),
  ).toBe(false);

  fireEvent.click(screen.getByRole('button', { name: 'Open Tin' }));
  await waitFor(() => expect(host.openTin).toHaveBeenCalledWith(1));
});

test('shows a drag affordance and closes through the existing hide path', async () => {
  const { host, client } = setup();
  await screen.findByRole('option', { name: /Recent note/ });

  const handle = document.querySelector('.launcher-drag-handle');
  expect(handle).not.toBeNull();
  expect(handle?.getAttribute('aria-hidden')).toBe('true');
  expect(handle?.hasAttribute('data-tauri-drag-region')).toBe(true);

  fireEvent.click(screen.getByRole('button', { name: 'Close Quick Search' }));

  await waitFor(() => expect(host.hide).toHaveBeenCalledWith(1));
  expect(client.copyContent).not.toHaveBeenCalled();
});

test('removes the Local only footer copy and uses shared scroll areas', async () => {
  setup();
  await screen.findByRole('option', { name: /Recent note/ });
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'ArrowDown' });

  expect(screen.queryByText(/Local only/)).toBeNull();
  expect(document.querySelector('.launcher-results-content')).not.toBeNull();
  expect(
    document.querySelectorAll('[data-slot="scroll-area"]').length,
  ).toBeGreaterThanOrEqual(2);
  expect(
    document.querySelectorAll('[data-slot="scroll-area-viewport"]').length,
  ).toBeGreaterThanOrEqual(2);
});
test('restores search focus when the native webview receives focus after rendering', async () => {
  setup();
  const search = await screen.findByRole('searchbox');
  expect(search.getAttribute('placeholder')).toBe('Search clips…');
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
  expect(
    screen
      .getAllByRole('option')
      .every((option) => option.getAttribute('aria-selected') === 'false'),
  ).toBe(true);
  fireEvent.compositionEnd(search);
});
test('starts unselected and enters results explicitly from either direction', async () => {
  const { client } = setup();
  const search = await screen.findByRole('searchbox');
  const options = await screen.findAllByRole('option');

  expect(
    options.every((option) => option.getAttribute('aria-selected') === 'false'),
  ).toBe(true);
  expect(search.getAttribute('aria-activedescendant')).toBeNull();
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(client.copyContent).not.toHaveBeenCalled();

  fireEvent.keyDown(search, { key: 'ArrowDown' });
  expect(options[0]?.getAttribute('aria-selected')).toBe('true');

  fireEvent.change(search, { target: { value: ' ' } });
  fireEvent.keyDown(search, { key: 'ArrowUp' });
  expect(options.at(-1)?.getAttribute('aria-selected')).toBe('true');
});
test('opens compact create mode, focuses Content, and Escape returns to search before hiding', async () => {
  const { host } = setup();
  await screen.findByRole('option', { name: /Recent note/ });

  fireEvent.click(screen.getByRole('button', { name: 'New clip' }));
  const content = screen.getByRole('textbox', { name: 'Content' });
  await waitFor(() => expect(document.activeElement).toBe(content));
  expect(screen.getByRole('combobox', { name: 'Content type' })).toBeTruthy();
  expect(screen.queryByRole('searchbox')).toBeNull();

  fireEvent.keyDown(content, { key: 'Escape' });
  const search = await screen.findByRole('searchbox');
  await waitFor(() => expect(document.activeElement).toBe(search));
  expect(host.hide).not.toHaveBeenCalled();

  fireEvent.keyDown(search, { key: 'Escape' });
  await waitFor(() => expect(host.hide).toHaveBeenCalledWith(1));
});
test('creates through the existing client, clears search, and selects the local result', async () => {
  const { client, host } = setup();
  const search = await screen.findByRole('searchbox');
  fireEvent.change(search, { target: { value: 'guide' } });
  fireEvent.click(screen.getByRole('button', { name: 'New clip' }));
  const content = screen.getByRole('textbox', { name: 'Content' });
  fireEvent.change(content, {
    target: { value: '  https://example.com/new  ' },
  });
  fireEvent.keyDown(content, { key: 'Enter', ctrlKey: true });

  await waitFor(() =>
    expect(client.create).toHaveBeenCalledWith({
      content: '  https://example.com/new  ',
      contentType: 'link',
      title: null,
      sourceApp: null,
      sourceUrl: null,
      sourcePageTitle: null,
    }),
  );
  const returnedSearch = await screen.findByRole('searchbox');
  expect(returnedSearch).toHaveProperty('value', '');
  expect(screen.getByText('Saved')).toBeTruthy();
  expect(
    screen
      .getByRole('option', { name: /Created locally/ })
      .getAttribute('aria-selected'),
  ).toBe('true');
  expect(host.hide).not.toHaveBeenCalled();
});
test('deduplicates a pending create and preserves a failed draft for retry', async () => {
  const { client } = setup();
  await screen.findByRole('option', { name: /Recent note/ });
  let rejectCreate!: (error: Error) => void;
  client.create.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        rejectCreate = reject;
      }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'New clip' }));
  const content = screen.getByRole('textbox', { name: 'Content' });
  fireEvent.change(content, { target: { value: 'Keep failed draft' } });
  fireEvent.keyDown(content, { key: 'Enter', ctrlKey: true });
  fireEvent.keyDown(content, { key: 'Enter', ctrlKey: true });
  expect(client.create).toHaveBeenCalledTimes(1);

  await act(async () => rejectCreate(new Error('private database detail')));
  expect((await screen.findByRole('alert')).textContent).toBe(
    'Clip could not be saved.',
  );
  expect(content).toHaveProperty('value', 'Keep failed draft');
});
test('Cancel discards create draft and focus loss preserves an active draft', async () => {
  const { host } = setup();
  await screen.findByRole('option', { name: /Recent note/ });
  fireEvent.click(screen.getByRole('button', { name: 'New clip' }));
  let content = screen.getByRole('textbox', { name: 'Content' });
  fireEvent.change(content, { target: { value: 'Discard me' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'New clip' }));
  content = screen.getByRole('textbox', { name: 'Content' });
  expect(content).toHaveProperty('value', '');

  fireEvent.change(content, { target: { value: 'Survive focus loss' } });
  fireEvent.blur(window);
  fireEvent.focus(window);
  expect(content).toHaveProperty('value', 'Survive focus loss');
  expect(host.hide).not.toHaveBeenCalled();
});
test('edits the current stored clip by id and preserves hidden metadata', async () => {
  const { client } = setup();
  const search = await screen.findByRole('searchbox');
  await screen.findByRole('option', { name: /Recent note/ });
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  fireEvent.click(screen.getByRole('button', { name: 'Edit selected clip' }));
  const content = screen.getByRole('textbox', { name: 'Content' });
  fireEvent.change(content, { target: { value: 'Updated guide' } });
  fireEvent.keyDown(content, { key: 'Enter', ctrlKey: true });

  await waitFor(() =>
    expect(client.update).toHaveBeenCalledWith('newer', {
      content: 'Updated guide',
      contentType: 'text',
      title: newer.title,
      sourceApp: newer.sourceApp,
      sourceUrl: newer.sourceUrl,
      sourcePageTitle: newer.sourcePageTitle,
    }),
  );
  expect(client.list).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Saved')).toBeTruthy();
  expect(screen.getByText('Updated guide')).toBeTruthy();
  expect(
    screen
      .getByRole('option', { name: /Recent note/ })
      .getAttribute('aria-selected'),
  ).toBe('true');
});
test('shows one isolated pencil in the selected result title row', async () => {
  const { client } = setup();
  const search = await screen.findByRole('searchbox');
  const options = await screen.findAllByRole('option');
  fireEvent.keyDown(search, { key: 'ArrowDown' });

  const selected = options[0]!;
  const unselected = options[1]!;
  const edit = within(selected).getByRole('button', {
    name: 'Edit selected clip',
  });
  const titleRow = edit.closest('.launcher-title-row');
  expect(titleRow).not.toBeNull();
  expect(within(titleRow as HTMLElement).getByText('Recent note')).toBeTruthy();
  expect(
    within(unselected).queryByRole('button', { name: 'Edit selected clip' }),
  ).toBeNull();

  fireEvent.mouseDown(edit);
  fireEvent.click(edit);
  expect(client.copyContent).not.toHaveBeenCalled();
  expect(screen.getByRole('form', { name: 'Edit clip' })).toBeTruthy();
});
test('keeps an edit draft and exposes a safe retryable error when the clip disappeared', async () => {
  const { client } = setup();
  const search = await screen.findByRole('searchbox');
  await screen.findByRole('option', { name: /Recent note/ });
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  fireEvent.click(screen.getByRole('button', { name: 'Edit selected clip' }));
  const content = screen.getByRole('textbox', { name: 'Content' });
  fireEvent.change(content, { target: { value: 'Keep this edit' } });
  client.list.mockResolvedValueOnce([]);
  fireEvent.keyDown(content, { key: 'Enter', ctrlKey: true });

  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toBe('This clip is no longer available.');
  expect(content).toHaveProperty('value', 'Keep this edit');
  expect(client.update).not.toHaveBeenCalled();
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
  expect(screen.getAllByRole('option')[0]!.getAttribute('aria-selected')).toBe(
    'true',
  );
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  expect(screen.getAllByRole('option')[1]!.getAttribute('aria-selected')).toBe(
    'true',
  );
  expect(document.activeElement).toBe(search);
  fireEvent.change(search, { target: { value: 'CLAUDE local' } });
  expect(screen.getAllByRole('option')).toHaveLength(1);
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(client.copyContent).not.toHaveBeenCalled();
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  fireEvent.keyDown(search, { key: 'Enter' });
  await waitFor(() => expect(client.copyContent).toHaveBeenCalledWith('older'));
});
test('a failed hide can be retried without copying again', async () => {
  const { client, host } = setup();
  await screen.findByRole('option', { name: /Recent note/ });
  vi.mocked(host.hide).mockRejectedValueOnce(
    new Error('private native detail'),
  );
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
  await screen.findByRole('button', { name: 'Retry closing' });
  fireEvent.click(screen.getByRole('button', { name: 'Retry closing' }));
  await waitFor(() => expect(host.hide).toHaveBeenCalledTimes(2));
  expect(client.copyContent).not.toHaveBeenCalled();
});
test('deduplicates Enter, stays open, and supports repeated copies', async () => {
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
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  fireEvent.keyDown(search, { key: 'Enter' });
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(client.copyContent).toHaveBeenCalledTimes(1);
  expect(host.hide).not.toHaveBeenCalled();
  await act(async () => resolve());
  expect(host.hide).not.toHaveBeenCalled();
  expect(screen.getByText('Copied')).toBeTruthy();

  fireEvent.keyDown(search, { key: 'ArrowDown' });
  fireEvent.keyDown(search, { key: 'Enter' });
  await waitFor(() => expect(client.copyContent).toHaveBeenCalledTimes(2));
  expect(client.copyContent.mock.calls.map(([id]) => id)).toEqual([
    'newer',
    'older',
  ]);
  expect(host.hide).not.toHaveBeenCalled();
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
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'ArrowDown' });
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
  const error = await screen.findByRole('alert');
  expect(error.textContent).not.toContain('sensitive');
  expect(host.hide).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry copy' }));
  await waitFor(() => expect(client.copyContent).toHaveBeenCalledTimes(2));
  expect(host.hide).not.toHaveBeenCalled();
});

test('clip preview text remains naturally selectable', async () => {
  setup();
  await screen.findByRole('option', { name: /Recent note/ });
  const preview = document.querySelector('.launcher-preview');
  expect(preview).not.toBeNull();
  expect(fireEvent.mouseDown(preview!)).toBe(true);
});

test('a copy error with no selected result cannot dismiss the launcher through retry', async () => {
  const { client, host } = setup();
  await screen.findByRole('option', { name: /Recent note/ });
  client.copyContent.mockRejectedValueOnce(new Error('copy failed'));
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'ArrowDown' });
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
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'ArrowDown' });
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
  const loadAlert = await screen.findByRole('alert');
  expect(loadAlert.textContent).not.toContain('private');
  expect(loadAlert.closest('.launcher-state')).not.toBeNull();
  client.list.mockResolvedValueOnce([]);
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
  expect(
    (await screen.findByText('No clips yet')).closest('.launcher-state'),
  ).not.toBeNull();
  emit({ session: 3, visible: true });
  await screen.findByRole('option', { name: /Recent note/ });
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: 'missing' },
  });
  expect(
    screen.getByText('No matching clips').closest('.launcher-state'),
  ).not.toBeNull();
});

test('presents content-type labels and Windows shortcuts consistently', async () => {
  setup();
  const recent = await screen.findByRole('option', { name: /Recent note/ });
  expect(recent.textContent).toContain('Text');
  expect(recent.textContent).not.toContain('· text');
  expect(
    screen.getByText(
      '↑↓ Select · Enter Copy all · Ctrl+C Copy selection · Esc Close',
    ),
  ).toBeTruthy();
});
