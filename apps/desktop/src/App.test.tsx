import type { Clip, ClipInput } from '@ai-clip-memory/shared';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { App } from './App';
import type { ClipClient } from './clipClient';
import { getLauncherStatus } from './launcher/launcherClient';

vi.mock('./launcher/launcherClient', () => ({
  getLauncherStatus: vi.fn(async () => ({
    available: true,
    shortcut: 'Ctrl+Shift+Space',
    errorCode: null,
  })),
}));

const firstClip: Clip = {
  id: '029e215c-cdda-41ba-99c7-366219ad1219',
  content: 'A calm explanation of local-first software.',
  contentType: 'text',
  title: 'Local-first notes',
  sourceApp: 'Web',
  sourceUrl: 'https://example.com/local-first',
  sourcePageTitle: 'Local-first article',
  isPinned: false,
  createdAt: '2026-09-02T15:00:00.000Z',
  updatedAt: '2026-09-02T15:00:00.000Z',
};

const pinnedClip: Clip = {
  id: '68d5b96b-8219-4f64-9a63-9bde31a2c813',
  content: 'Use TypeScript discriminated unions for state.',
  contentType: 'code',
  title: 'TypeScript tip',
  sourceApp: 'ChatGPT',
  sourceUrl: null,
  sourcePageTitle: null,
  isPinned: true,
  createdAt: '2026-09-01T15:00:00.000Z',
  updatedAt: '2026-09-01T15:00:00.000Z',
};

function fakeClient(initialClips: Clip[] = []) {
  const methods = {
    list: vi.fn<ClipClient['list']>().mockResolvedValue(initialClips),
    create: vi.fn<ClipClient['create']>(),
    update: vi.fn<ClipClient['update']>(),
    delete: vi.fn<ClipClient['delete']>().mockResolvedValue(undefined),
    setPinned: vi.fn<ClipClient['setPinned']>(),
    copyContent: vi
      .fn<ClipClient['copyContent']>()
      .mockResolvedValue(undefined),
    openSource: vi.fn<ClipClient['openSource']>().mockResolvedValue(undefined),
  };
  return { client: methods satisfies ClipClient, ...methods };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('App', () => {
  test('rechecks launcher availability whenever the main window regains focus', async () => {
    vi.mocked(getLauncherStatus)
      .mockResolvedValueOnce({
        available: true,
        shortcut: 'Ctrl+Shift+Space',
        errorCode: null,
      })
      .mockResolvedValueOnce({
        available: false,
        shortcut: 'Ctrl+Shift+Space',
        errorCode: 'shortcut_unavailable',
      });
    render(<App client={fakeClient().client} />);
    await screen.findByRole('heading', { name: 'No clips yet' });
    fireEvent.focus(window);
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Another app',
    );
  });

  test('blocks every form dismissal while save is pending and preserves a failed draft', async () => {
    const fake = fakeClient();
    let reject!: (error: unknown) => void;
    fake.create.mockReturnValue(
      new Promise((_, fail) => {
        reject = fail;
      }),
    );
    render(<App client={fake.client} />);
    await screen.findByRole('heading', { name: 'No clips yet' });
    fireEvent.click(screen.getByRole('button', { name: 'New clip' }));
    const dialog = screen.getByRole('dialog', { name: 'Create clip' });
    const content = within(dialog).getByLabelText('Content');
    fireEvent.change(content, { target: { value: 'complete private draft' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save clip' }));
    const cancel = within(dialog).getByRole('button', {
      name: 'Cancel',
    }) as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
    fireEvent.click(cancel);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Create clip' })).toBeTruthy();
    reject(new Error('storage failed'));
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect((content as HTMLTextAreaElement).value).toBe(
      'complete private draft',
    );
  });
  test('distinguishes launcher startup failure from a shortcut conflict', async () => {
    vi.mocked(getLauncherStatus).mockResolvedValueOnce({
      available: false,
      shortcut: 'Ctrl+Shift+Space',
      errorCode: 'launcher_unavailable',
    });
    render(<App client={fakeClient().client} />);
    expect((await screen.findByRole('alert')).textContent).toContain(
      'could not start',
    );
    expect(screen.getByRole('alert').textContent).not.toContain('Another app');
  });
  test('reports an unavailable shortcut safely without disabling the library', async () => {
    vi.mocked(getLauncherStatus).mockResolvedValueOnce({
      available: false,
      shortcut: 'Ctrl+Shift+Space',
      errorCode: 'shortcut_unavailable',
    });
    render(<App client={fakeClient().client} />);
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Ctrl+Shift+Space',
    );
    expect(screen.getByRole('alert').closest('.content')).toBeNull();
    expect(screen.getByRole('button', { name: 'New clip' })).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'All Clips', level: 1 }),
    ).toBeTruthy();
  });
  test('collapses to icons and preserves filters, counts and selected clips', async () => {
    render(<App client={fakeClient([firstClip, pinnedClip]).client} />);
    await screen.findByText(firstClip.content, { selector: '.clip-content' });
    const sidebar = screen
      .getByRole('button', { name: 'All Clips' })
      .closest('[data-slot="sidebar"]')!;
    expect(sidebar.getAttribute('data-state')).toBe('expanded');
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'unions' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Toggle Sidebar', hidden: false }),
    );
    expect(sidebar.getAttribute('data-state')).toBe('collapsed');
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(
      screen.getByText(pinnedClip.content, { selector: '.clip-content' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pinned' }));
    expect(
      screen.getByRole('heading', { name: 'Pinned', level: 1 }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Search clips' }));
    expect(sidebar.getAttribute('data-state')).toBe('expanded');
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe(
      'unions',
    );
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));
    expect(
      document.querySelector('[data-slot="sidebar-menu-badge"]')?.textContent,
    ).toBe('2');
  });

  test('reveals collapsed search with Ctrl/Cmd+F and keeps icon actions usable', async () => {
    render(<App client={fakeClient().client} />);
    await screen.findByRole('heading', { name: 'No clips yet' });
    const toggle = screen.getByRole('button', { name: 'Toggle Sidebar' });
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
      fireEvent.click(toggle);
      fireEvent.keyDown(document.body, { key: 'f', ...modifier });
      expect(document.activeElement).toBe(screen.getByRole('searchbox'));
    }
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'New clip' }));
    expect(screen.getByRole('dialog', { name: 'Create clip' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Settings & About' }));
    expect(screen.getByText(/Your clips are stored locally/)).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'f', ctrlKey: true });
    expect(
      screen.getByRole('heading', { name: 'All Clips', level: 1 }),
    ).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));
  });

  test('guards sidebar shortcuts and does not persist sidebar state', async () => {
    const cookieWrite = vi.spyOn(document, 'cookie', 'set');
    render(<App client={fakeClient().client} />);
    await screen.findByRole('heading', { name: 'No clips yet' });
    const sidebar = screen
      .getByRole('button', { name: 'All Clips' })
      .closest('[data-slot="sidebar"]')!;
    fireEvent.keyDown(screen.getByRole('searchbox'), {
      key: 'b',
      ctrlKey: true,
    });
    expect(sidebar.getAttribute('data-state')).toBe('expanded');
    fireEvent.click(screen.getByRole('button', { name: 'New clip' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), {
      key: 'b',
      ctrlKey: true,
    });
    expect(sidebar.getAttribute('data-state')).toBe('expanded');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    for (const extra of [
      { repeat: true },
      { isComposing: true },
      { shiftKey: true },
      { altKey: true },
    ]) {
      fireEvent.keyDown(document.body, { key: 'b', ctrlKey: true, ...extra });
      expect(sidebar.getAttribute('data-state')).toBe('expanded');
    }
    fireEvent.keyDown(document.body, { key: 'b', ctrlKey: true });
    expect(sidebar.getAttribute('data-state')).toBe('collapsed');
    fireEvent.keyDown(document.body, { key: 'b', metaKey: true });
    expect(sidebar.getAttribute('data-state')).toBe('expanded');
    expect(cookieWrite).not.toHaveBeenCalled();
  });

  test('focuses search from the webview body before any control is clicked', async () => {
    const fake = fakeClient();
    render(<App client={fake.client} />);
    await screen.findByRole('heading', { name: 'No clips yet' });
    fireEvent.keyDown(document.body, { key: 'f', ctrlKey: true });
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));
  });
  test('blocks duplicate copy and refresh while an action is pending', async () => {
    const fake = fakeClient([firstClip]);
    let finish!: () => void;
    fake.copyContent.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    render(<App client={fake.client} />);
    await screen.findByText(firstClip.content, { selector: '.clip-content' });
    const row = screen.getByRole('button', { name: /Local-first notesA calm/ });
    fireEvent.keyDown(row, { key: 'c', ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(row, { key: 'c', ctrlKey: true, shiftKey: true });
    expect(fake.copyContent).toHaveBeenCalledTimes(1);
    expect(
      (screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    finish();
    await screen.findByText('Clip copied.');
  });

  test('keeps action errors visible through navigation until retry succeeds', async () => {
    const fake = fakeClient([firstClip]);
    fake.copyContent
      .mockRejectedValueOnce(new Error('sensitive details'))
      .mockResolvedValueOnce(undefined);
    render(<App client={fake.client} />);
    await screen.findByText(firstClip.content, { selector: '.clip-content' });
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Try the action again',
    );
    expect(screen.queryByText('sensitive details')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Pinned' }));
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'All Clips' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await screen.findByText('Clip copied.');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('falls back to the newest remaining selection after refresh removes it', async () => {
    const fake = fakeClient([firstClip, pinnedClip]);
    fake.list
      .mockResolvedValueOnce([firstClip, pinnedClip])
      .mockResolvedValueOnce([pinnedClip]);
    render(<App client={fake.client} />);
    await screen.findByRole('heading', { name: firstClip.title! });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByRole('heading', { name: pinnedClip.title! });
    expect(
      screen
        .getByRole('button', { name: 'All Clips' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  test('opens the type filter below the trigger instead of aligning over it', async () => {
    render(<App client={fakeClient().client} />);
    await screen.findByRole('heading', { name: 'No clips yet' });
    fireEvent.click(
      screen.getByRole('combobox', { name: 'Content type filter' }),
    );
    const popup = screen
      .getByRole('listbox')
      .closest('[data-slot="select-content"]')!;
    expect(popup.getAttribute('data-align-trigger')).toBe('false');
    expect(popup.getAttribute('data-side')).toBe('bottom');
    expect(popup.classList.contains('min-w-0')).toBe(true);
    expect(popup.classList.contains('min-w-36')).toBe(false);
    fireEvent.keyDown(screen.getByRole('option', { name: 'code' }), {
      key: 'Enter',
    });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(
      screen.getByRole('combobox', { name: 'Content type filter' }).textContent,
    ).toContain('code');
  });

  test('combines multi-term search and type filtering without changing counts', async () => {
    const fake = fakeClient([firstClip, pinnedClip]);
    render(<App client={fake.client} />);
    expect(
      screen.getByRole('combobox', { name: 'Content type filter' }).textContent,
    ).toContain('All types');
    await screen.findByText(firstClip.content, { selector: '.clip-content' });
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'CHATGPT unions' },
    });
    expect(
      screen.getByText(pinnedClip.content, { selector: '.clip-content' }),
    ).toBeTruthy();
    expect(screen.getByText('1 result')).toBeTruthy();
    const all = screen
      .getByRole('button', { name: 'All Clips' })
      .closest<HTMLElement>('[data-slot="sidebar-menu-item"]')!;
    expect(within(all).getByText('2')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('combobox', { name: 'Content type filter' }),
    );
    fireEvent.keyDown(screen.getByRole('option', { name: 'text' }), {
      key: 'Enter',
    });
    expect(
      screen.getByRole('heading', { name: 'No matching clips' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('2 results')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pinned' }));
    expect(
      screen.getByText(pinnedClip.content, { selector: '.clip-content' }),
    ).toBeTruthy();
    expect(
      screen.queryByText(firstClip.content, { selector: '.clip-content' }),
    ).toBeNull();
  });

  test('refresh discovers a new captured row without losing selection or query', async () => {
    const captured = {
      ...firstClip,
      id: 'capture',
      title: null,
      sourcePageTitle: 'New browser capture',
      createdAt: '2026-09-03T12:00:00.000Z',
    };
    const fake = fakeClient([firstClip]);
    fake.list
      .mockResolvedValueOnce([firstClip])
      .mockResolvedValueOnce([captured, firstClip]);
    render(<App client={fake.client} />);
    await screen.findByText(firstClip.content, { selector: '.clip-content' });
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'local' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByText('New browser capture');
    expect(
      screen.getByRole('heading', { name: firstClip.title! }),
    ).toBeTruthy();
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe(
      'local',
    );
  });

  test('initial failure offers Retry instead of falsely claiming an empty library', async () => {
    const fake = fakeClient();
    fake.list
      .mockRejectedValueOnce(new Error('private path'))
      .mockResolvedValueOnce([firstClip]);
    render(<App client={fake.client} />);
    await screen.findByRole('button', { name: 'Retry' });
    expect(screen.queryByRole('heading', { name: 'No clips yet' })).toBeNull();
    expect(screen.queryByText('private path')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText(firstClip.content, { selector: '.clip-content' });
  });

  test('refresh failure preserves the library and remains retryable', async () => {
    const fake = fakeClient([firstClip]);
    fake.list
      .mockResolvedValueOnce([firstClip])
      .mockRejectedValueOnce(new Error('private'));
    render(<App client={fake.client} />);
    await screen.findByText(firstClip.content, { selector: '.clip-content' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByRole('button', { name: 'Retry' });
    expect(
      screen.getByText(firstClip.content, { selector: '.clip-content' }),
    ).toBeTruthy();
  });

  test('supports app search, result focus and copy shortcuts with editable/dialog guards', async () => {
    const fake = fakeClient([firstClip, pinnedClip]);
    render(<App client={fake.client} />);
    await screen.findByText(firstClip.content, { selector: '.clip-content' });
    const search = screen.getByRole('searchbox');
    const shell = search.closest('.app-shell')!;
    fireEvent.keyDown(shell, { key: 'f', ctrlKey: true });
    expect(document.activeElement).toBe(search);
    fireEvent.keyDown(search, { key: 'c', ctrlKey: true, shiftKey: true });
    expect(fake.copyContent).not.toHaveBeenCalled();
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(document.activeElement?.classList.contains('clip-list-item')).toBe(
      true,
    );
    fireEvent.keyDown(document.activeElement!, {
      key: 'c',
      metaKey: true,
      shiftKey: true,
    });
    await waitFor(() =>
      expect(fake.copyContent).toHaveBeenCalledWith(firstClip.id),
    );
    expect(screen.getByRole('status').textContent).toContain('Clip copied.');
    fireEvent.click(
      screen.getByRole('button', { name: 'Dismiss notification' }),
    );
    expect(screen.queryByText('Clip copied.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'New clip' }));
    const dialog = screen.getByRole('dialog');
    const content = within(dialog).getByLabelText('Content');
    content.focus();
    expect(fireEvent.keyDown(content, { key: 'f', ctrlKey: true })).toBe(false);
    expect(document.activeElement).toBe(content);
    expect(
      fireEvent.keyDown(content, { key: 'c', ctrlKey: true, shiftKey: true }),
    ).toBe(false);
    expect(fake.copyContent).toHaveBeenCalledTimes(1);
  });

  test('shows the empty library after loading an empty database', async () => {
    const { client } = fakeClient();
    render(<App client={client} />);

    expect(
      await screen.findByRole('heading', { name: 'No clips yet' }),
    ).toBeTruthy();
    expect(
      screen.getByText('Create a clip here or save one from your browser.'),
    ).toBeTruthy();
  });

  test('keeps local status, search, and create controls in the sidebar', async () => {
    const { client } = fakeClient();
    render(<App client={client} />);
    await screen.findByRole('heading', { name: 'No clips yet' });

    const sidebar = screen
      .getByRole('navigation', { name: 'Clip library' })
      .closest<HTMLElement>('[data-slot="sidebar"]');

    expect(sidebar).not.toBeNull();
    expect(within(sidebar!).getByText('Local only')).toBeTruthy();
    expect(
      within(sidebar!).getByRole('searchbox', { name: 'Search clips' }),
    ).toBeTruthy();
    expect(
      within(sidebar!).getByRole('button', { name: 'New clip' }),
    ).toBeTruthy();
  });

  test('renders clips, real counts, and the selected clip detail', async () => {
    const { client } = fakeClient([firstClip, pinnedClip]);
    render(<App client={client} />);

    expect(
      await screen.findByText(firstClip.content, { selector: '.clip-content' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: firstClip.title! }),
    ).toBeTruthy();
    const allClipsItem = screen
      .getByRole('button', { name: 'All Clips' })
      .closest<HTMLElement>('[data-slot="sidebar-menu-item"]');
    const pinnedItem = screen
      .getByRole('button', { name: 'Pinned' })
      .closest<HTMLElement>('[data-slot="sidebar-menu-item"]');

    expect(allClipsItem).not.toBeNull();
    expect(pinnedItem).not.toBeNull();
    expect(within(allClipsItem!).getByText('2')).toBeTruthy();
    expect(within(pinnedItem!).getByText('1')).toBeTruthy();
  });

  test('filters the loaded list with case-insensitive substring search', async () => {
    const { client } = fakeClient([firstClip, pinnedClip]);
    render(<App client={client} />);
    await screen.findByText(firstClip.content, { selector: '.clip-content' });

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search clips' }), {
      target: { value: 'TYPESCRIPT' },
    });

    expect(
      screen.getByText(pinnedClip.content, { selector: '.clip-content' }),
    ).toBeTruthy();
    expect(
      screen.queryByText(firstClip.content, { selector: '.clip-content' }),
    ).toBeNull();
  });

  test('creates a manual local clip', async () => {
    const created: Clip = {
      ...firstClip,
      id: 'f2b31d7e-1343-4eef-bd60-136fdf9e0788',
      content: '  Preserve this content.  ',
      contentType: 'prompt',
      title: 'New prompt',
      sourceApp: null,
      sourceUrl: null,
      sourcePageTitle: null,
    };
    const fake = fakeClient();
    fake.create.mockResolvedValue(created);
    render(<App client={fake.client} />);
    await screen.findByRole('heading', { name: 'No clips yet' });

    fireEvent.click(screen.getByRole('button', { name: 'New clip' }));
    const dialog = screen.getByRole('dialog', { name: 'Create clip' });
    fireEvent.change(within(dialog).getByLabelText('Content'), {
      target: { value: created.content },
    });
    fireEvent.click(
      within(dialog).getByRole('combobox', { name: 'Content type' }),
    );
    fireEvent.click(screen.getByRole('option', { name: 'prompt' }));
    fireEvent.change(within(dialog).getByLabelText('Title'), {
      target: { value: created.title },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save clip' }));

    await waitFor(() =>
      expect(fake.create).toHaveBeenCalledWith({
        content: created.content,
        contentType: 'prompt',
        title: 'New prompt',
        sourceApp: null,
        sourceUrl: null,
        sourcePageTitle: null,
      } satisfies ClipInput),
    );
    expect(
      screen.getByText(
        (_, element) =>
          element?.classList.contains('clip-content') === true &&
          element.textContent === created.content,
      ),
    ).toBeTruthy();
  });

  test('keeps a failed create error visible inside the open dialog', async () => {
    const fake = fakeClient();
    fake.create.mockRejectedValue({
      code: 'invalid_input',
      message: 'Content is required.',
    });
    render(<App client={fake.client} />);
    await screen.findByRole('heading', { name: 'No clips yet' });

    fireEvent.click(screen.getByRole('button', { name: 'New clip' }));
    const dialog = screen.getByRole('dialog', { name: 'Create clip' });
    fireEvent.change(within(dialog).getByLabelText('Content'), {
      target: { value: 'Valid local content' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save clip' }));

    await waitFor(() => expect(fake.create).toHaveBeenCalledTimes(1));
    expect(within(dialog).getByRole('alert').textContent).toContain(
      'Content is required.',
    );
  });

  test('edits a clip using full-replacement input', async () => {
    const updated: Clip = {
      ...firstClip,
      content: 'Updated content',
      title: null,
      updatedAt: '2026-09-02T16:00:00.000Z',
    };
    const fake = fakeClient([firstClip]);
    fake.update.mockResolvedValue(updated);
    render(<App client={fake.client} />);
    await screen.findByText(firstClip.content, { selector: '.clip-content' });

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit clip' });
    fireEvent.change(within(dialog).getByLabelText('Content'), {
      target: { value: updated.content },
    });
    fireEvent.change(within(dialog).getByLabelText('Title'), {
      target: { value: '' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Save changes' }),
    );

    await waitFor(() =>
      expect(fake.update).toHaveBeenCalledWith(firstClip.id, {
        content: 'Updated content',
        contentType: 'text',
        title: null,
        sourceApp: 'Web',
        sourceUrl: 'https://example.com/local-first',
        sourcePageTitle: 'Local-first article',
      } satisfies ClipInput),
    );
    expect(
      screen.getByText('Updated content', { selector: '.clip-content' }),
    ).toBeTruthy();
  });

  test('cancels create without calling the client', async () => {
    const fake = fakeClient();
    render(<App client={fake.client} />);
    await screen.findByRole('heading', { name: 'No clips yet' });

    fireEvent.click(screen.getByRole('button', { name: 'New clip' }));
    const dialog = screen.getByRole('dialog', { name: 'Create clip' });
    fireEvent.change(within(dialog).getByLabelText('Content'), {
      target: { value: 'Do not save this' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fake.create).not.toHaveBeenCalled();
    expect(fake.update).not.toHaveBeenCalled();
  });

  test('cancels deletion without calling the client', async () => {
    const fake = fakeClient([firstClip]);
    render(<App client={fake.client} />);
    await screen.findByText(firstClip.content, { selector: '.clip-content' });

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const alert = screen.getByRole('alertdialog', { name: 'Delete clip?' });
    fireEvent.click(within(alert).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(fake.delete).not.toHaveBeenCalled();
  });

  test('deletes a clip after alert-dialog confirmation', async () => {
    const fake = fakeClient([firstClip]);
    render(<App client={fake.client} />);
    await screen.findByText(firstClip.content, { selector: '.clip-content' });

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const alert = screen.getByRole('alertdialog', { name: 'Delete clip?' });
    fireEvent.click(within(alert).getByRole('button', { name: 'Delete clip' }));

    await waitFor(() => expect(fake.delete).toHaveBeenCalledWith(firstClip.id));
    expect(screen.getByRole('heading', { name: 'No clips yet' })).toBeTruthy();
  });

  test('pins and unpins a clip', async () => {
    const fake = fakeClient([firstClip]);
    fake.setPinned
      .mockResolvedValueOnce({ ...firstClip, isPinned: true })
      .mockResolvedValueOnce(firstClip);
    render(<App client={fake.client} />);
    await screen.findByText(firstClip.content, { selector: '.clip-content' });

    fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
    await screen.findByRole('button', { name: 'Unpin' });
    const pinnedItem = screen
      .getByRole('button', { name: 'Pinned' })
      .closest<HTMLElement>('[data-slot="sidebar-menu-item"]');
    expect(pinnedItem).not.toBeNull();
    expect(within(pinnedItem!).getByText('1')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Unpin' }));
    await waitFor(() => expect(fake.setPinned).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Pin' })).toBeTruthy();
  });

  test('copies content and opens the stored source through the client', async () => {
    const fake = fakeClient([firstClip]);
    render(<App client={fake.client} />);
    await screen.findByText(firstClip.content, { selector: '.clip-content' });

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await screen.findByText('Clip copied.');
    fireEvent.click(screen.getByRole('button', { name: 'Open source' }));

    await waitFor(() => {
      expect(fake.copyContent).toHaveBeenCalledWith(firstClip.id);
      expect(fake.openSource).toHaveBeenCalledWith(firstClip.id);
    });
  });

  test('keeps local-first privacy information in settings', async () => {
    const { client } = fakeClient();
    render(<App client={client} />);

    fireEvent.click(screen.getByRole('button', { name: 'Settings & About' }));

    expect(
      screen.getByText(
        'Your clips are stored locally on this computer. No account or cloud connection is required.',
      ),
    ).toBeTruthy();
  });
});
