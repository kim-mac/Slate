import type { Clip, ClipInput, LibraryItem } from '@ai-clip-memory/shared';
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
import { App } from './App';
import { tauriClipClient } from './clipClient';
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
afterEach(cleanup);

async function setup() {
  const safety = installationSafetyFixture();
  const clip: Clip = {
    ...safetyClip,
    title: 'First note',
    content: '  original\n**Markdown**  ',
    sourceApp: 'Chrome',
    sourceUrl: 'https://example.com/',
    sourcePageTitle: 'Original source',
    isPinned: true,
  };
  const second = {
    ...clip,
    id: 'second',
    title: 'Second note',
    content: 'Other clip',
  };
  let persisted = clip;
  const client = {
    ...tauriClipClient,
    list: vi.fn(async (): Promise<LibraryItem[]> => [
      { kind: 'clip' as const, clip: persisted },
      { kind: 'clip' as const, clip: second },
    ]),
    update: vi.fn(async (_id: string, input: ClipInput) => {
      persisted = { ...persisted, ...input, updatedAt: '2026-10-21T00:00:00Z' };
      return persisted;
    }),
    copyContent: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    setPinned: vi.fn(async (_id: string, isPinned: boolean) => ({
      ...persisted,
      isPinned,
    })),
  };
  render(
    <App
      client={client}
      safetyClient={safety.client}
      startupClient={{
        getEnabled: async () => false,
        setEnabled: async (v) => v,
      }}
    />,
  );
  const preview = await screen.findByText('original **Markdown**', {
    selector: '.clip-list-preview',
    exact: false,
  });
  fireEvent.click(preview.closest('button')!);
  await screen.findByRole('button', { name: 'Edit content' });
  return {
    clip,
    client,
    safety,
    savedContent: () => persisted.content,
    setPersisted: (saved: Clip) => {
      persisted = saved;
    },
  };
}
async function edit(content = 'New content') {
  fireEvent.click(screen.getByRole('button', { name: 'Edit content' }));
  const textarea = await screen.findByRole<HTMLTextAreaElement>('textbox', {
    name: 'Clip content',
  });
  fireEvent.change(textarea, { target: { value: content } });
  return textarea;
}

test('single click preserves viewing and selection; double-click enters a focused raw-text editor', async () => {
  const { clip, safety } = await setup();
  const content = screen.getByText('original **Markdown**', {
    selector: '.clip-content',
    exact: false,
  });
  fireEvent.click(content);
  expect(screen.queryByRole('textbox', { name: 'Clip content' })).toBeNull();
  fireEvent.doubleClick(content);
  const editor = await screen.findByRole<HTMLTextAreaElement>('textbox', {
    name: 'Clip content',
  });
  expect(editor.value).toBe(clip.content);
  expect(document.activeElement).toBe(editor);
  expect(safety.client.acquire).toHaveBeenCalledWith(1, 'inline');
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('pencil and checkmark persist only content while preserving every metadata field', async () => {
  const { clip, client, safety } = await setup();
  await edit('  New content\n# literal markdown  ');
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByRole('button', { name: 'Edit content' });
  expect(client.update).toHaveBeenCalledExactlyOnceWith(
    clip.id,
    {
      title: clip.title,
      contentType: clip.contentType,
      sourceApp: clip.sourceApp,
      sourceUrl: clip.sourceUrl,
      sourcePageTitle: clip.sourcePageTitle,
      content: '  New content\n# literal markdown  ',
    },
    { expectedContent: clip.content },
  );
  expect(screen.getByRole('button', { name: 'Unpin' })).toBeTruthy();
  expect(safety.client.release).toHaveBeenCalledOnce();
});

test('clicking elsewhere saves; save control focus does not cause a second save', async () => {
  const { client } = await setup();
  const editor = await edit();
  const save = screen.getByRole('button', { name: 'Save changes' });
  fireEvent.blur(editor, { relatedTarget: save });
  expect(client.update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('heading', { name: 'First note' }));
  await screen.findByRole('button', { name: 'Edit content' });
  expect(client.update).toHaveBeenCalledOnce();
});

test('an inline draft stays mounted through a grouping refresh and lease release', async () => {
  const { clip, client, safety } = await setup();
  const editor = await edit('Saved grouped draft');
  const refreshing = deferred<LibraryItem[]>();
  const releasing = deferred<void>();
  client.list.mockReturnValueOnce(refreshing.promise);
  vi.mocked(safety.client.release).mockReturnValueOnce(releasing.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(client.update).toHaveBeenCalledOnce());
  expect(editor).toHaveProperty('value', 'Saved grouped draft');
  expect(safety.client.release).not.toHaveBeenCalled();
  const group: LibraryItem = {
    kind: 'group',
    group: {
      id: 'new-auto-group',
      title: 'Stable automatic title',
      isPinned: true,
      createdAt: clip.createdAt,
      updatedAt: clip.updatedAt,
      members: [
        { ...clip, content: 'Saved grouped draft' },
        {
          ...clip,
          id: 'other-member',
          title: 'Other member',
          content: 'Other member unchanged',
        },
      ],
    },
  };
  await act(async () => refreshing.resolve([group]));
  await waitFor(() => expect(safety.client.release).toHaveBeenCalledOnce());
  expect(screen.getByRole('textbox', { name: 'Clip content' })).toHaveProperty(
    'value',
    'Saved grouped draft',
  );
  await act(async () => releasing.resolve());
  expect(
    await screen.findByRole('heading', { name: 'Stable automatic title' }),
  ).toBeTruthy();
  expect(screen.queryByRole('textbox', { name: 'Clip content' })).toBeNull();
  expect(
    screen.getByText('Other member unchanged', { selector: '.clip-content' }),
  ).toBeTruthy();
  expect(client.update).toHaveBeenCalledOnce();
});

test.each([
  'Back to calendar',
  'Second note',
  'Settings',
  'Copy',
  'Unpin',
  'Edit',
  'Delete',
])('%s waits for the one pending save before acting', async (action) => {
  const { client, clip, setPersisted } = await setup();
  const pending = deferred<Clip>();
  client.update.mockImplementation(async (_id, input) => {
    const saved = await pending.promise;
    return { ...saved, ...input };
  });
  // This case checks ordering; the dedicated Copy test below checks persisted bytes.
  client.copyContent.mockImplementation(async () => undefined);
  await edit();
  const target =
    action === 'Second note'
      ? screen
          .getByText('Other clip', { selector: '.clip-list-preview' })
          .closest('button')!
      : screen.getByRole('button', { name: action });
  fireEvent.click(target);
  await waitFor(() => expect(client.update).toHaveBeenCalledOnce());
  expect(screen.getByRole('textbox', { name: 'Clip content' })).toBeTruthy();
  expect(client.copyContent).not.toHaveBeenCalled();
  expect(client.setPinned).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('alertdialog')).toBeNull();
  await act(async () => {
    setPersisted({ ...clip, content: 'New content' });
    pending.resolve({ ...clip, content: 'New content' });
  });
  await waitFor(() =>
    expect(screen.queryByRole('textbox', { name: 'Clip content' })).toBeNull(),
  );
  if (action === 'Back to calendar')
    expect(screen.queryByRole('button', { name: 'Edit content' })).toBeNull();
  if (action === 'Second note')
    expect(screen.getByRole('heading', { name: 'Second note' })).toBeTruthy();
  if (action === 'Settings')
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
  if (action === 'Copy') expect(client.copyContent).toHaveBeenCalledOnce();
  if (action === 'Unpin')
    expect(client.setPinned).toHaveBeenCalledExactlyOnceWith(clip.id, false);
  if (action === 'Edit')
    expect(
      within(
        await screen.findByRole('dialog', { name: 'Edit clip' }),
      ).getByLabelText<HTMLTextAreaElement>('Content').value,
    ).toBe('New content');
  if (action === 'Delete')
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
});

test('Copy reads persisted content after a successful inline save', async () => {
  const { client, savedContent } = await setup();
  await edit();
  fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
  await waitFor(() => expect(client.copyContent).toHaveBeenCalledOnce());
  expect(savedContent()).toBe('New content');
  expect(client.update.mock.invocationCallOrder[0]!).toBeLessThan(
    client.copyContent.mock.invocationCallOrder[0]!,
  );
  expect(client.update).toHaveBeenCalledOnce();
});

test.each([false, true])(
  'deferred Delete reconciles a group discovered during inline save (refresh fails: %s)',
  async (refreshFails) => {
    const { clip, client, safety } = await setup();
    const survivor = { ...clip, id: 'survivor', title: 'Surviving member' };
    const grouped: LibraryItem[] = [
      {
        kind: 'group',
        group: {
          id: 'captured-group',
          title: 'Captured group',
          isPinned: true,
          createdAt: clip.createdAt,
          updatedAt: clip.updatedAt,
          members: [{ ...clip, content: 'Saved before delete' }, survivor],
        },
      },
    ];
    client.list.mockResolvedValueOnce(grouped).mockResolvedValueOnce(grouped);
    if (refreshFails)
      client.list.mockRejectedValueOnce(new Error('Private refresh failure'));
    else client.list.mockResolvedValueOnce([{ kind: 'clip', clip: survivor }]);
    await edit('Saved before delete');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const confirmation = await screen.findByRole('alertdialog');
    fireEvent.click(
      within(confirmation).getByRole('button', { name: 'Delete clip' }),
    );
    await waitFor(() =>
      expect(client.delete).toHaveBeenCalledExactlyOnceWith(clip.id),
    );
    await waitFor(() => expect(client.list).toHaveBeenCalledTimes(4));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search clips' }), {
      target: { value: 'Surviving member' },
    });
    expect(await screen.findByText('Surviving member')).toBeTruthy();
    expect(
      screen.queryByRole('heading', { name: 'Captured group' }),
    ).toBeNull();
    if (refreshFails) {
      expect(
        await screen.findByText(
          /Clip deleted, but the library could not refresh/,
        ),
      ).toBeTruthy();
      expect(screen.queryByText('Private refresh failure')).toBeNull();
      client.list.mockResolvedValueOnce([{ kind: 'clip', clip: survivor }]);
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      await waitFor(() => expect(client.list).toHaveBeenCalledTimes(5));
      expect(client.delete).toHaveBeenCalledOnce();
    }
    expect(client.update).toHaveBeenCalledOnce();
    expect(safety.client.release).toHaveBeenCalledTimes(2);
  },
);

test('Escape cancels, Enter and Ctrl+Enter do not save, and unchanged saves validate original content', async () => {
  const { client, clip } = await setup();
  const editor = await edit();
  fireEvent.keyDown(editor, { key: 'Enter' });
  fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
  expect(client.update).not.toHaveBeenCalled();
  fireEvent.keyDown(editor, { key: 'Escape' });
  await screen.findByRole('button', { name: 'Edit content' });
  expect(client.update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Edit content' }));
  await screen.findByRole('textbox', { name: 'Clip content' });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByRole('button', { name: 'Edit content' });
  expect(client.update).toHaveBeenCalledExactlyOnceWith(
    clip.id,
    expect.objectContaining({ content: clip.content }),
    { expectedContent: clip.content },
  );
});

test('save failure retains draft and lease, blocks navigation, and permits retry or explicit Escape cancellation', async () => {
  const { client, safety } = await setup();
  client.update.mockRejectedValueOnce(new Error('Synthetic failure'));
  await edit();
  fireEvent.click(screen.getByRole('button', { name: 'Back to calendar' }));
  await screen.findByText(/Could not save content/);
  const editor = screen.getByRole<HTMLTextAreaElement>('textbox', {
    name: 'Clip content',
  });
  expect(editor.value).toBe('New content');
  expect(safety.client.release).not.toHaveBeenCalled();
  fireEvent.keyDown(editor, { key: 'Escape' });
  await screen.findByRole('button', { name: 'Edit content' });
  expect(safety.client.release).toHaveBeenCalledOnce();
});

test('rapid save and outside actions use one write and one deferred action', async () => {
  const { client, clip, safety } = await setup();
  const pending = deferred<Clip>();
  client.update.mockReturnValue(pending.promise);
  await edit();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
  fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
  await waitFor(() => expect(client.update).toHaveBeenCalledOnce());
  await act(async () => pending.resolve({ ...clip, content: 'New content' }));
  await waitFor(() => expect(client.copyContent).toHaveBeenCalledOnce());
  expect(safety.client.release).toHaveBeenCalledOnce();
});

test('keyboard focus departure saves, while ordinary selection and clipboard shortcuts do not', async () => {
  const { client } = await setup();
  const editor = await edit();
  editor.setSelectionRange(0, 3);
  fireEvent.keyDown(editor, { key: 'c', ctrlKey: true });
  expect(client.update).not.toHaveBeenCalled();
  expect(editor.selectionEnd).toBe(3);
  fireEvent.blur(editor, {
    relatedTarget: screen.getByRole('button', { name: 'Back to calendar' }),
  });
  await screen.findByRole('button', { name: 'Edit content' });
  expect(client.update).toHaveBeenCalledOnce();
});

test('inline editing blocks installation acknowledgements and retains the draft through preparation', async () => {
  const { safety } = await setup();
  await edit();
  act(() => safety.emit({ generation: 1, preparing: true }));
  expect(safety.client.acknowledge).not.toHaveBeenCalled();
  expect(
    screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Clip content' })
      .value,
  ).toBe('New content');
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Clip content' }), {
    key: 'Escape',
  });
  await waitFor(() => expect(safety.client.release).toHaveBeenCalledOnce());
});

test('a lost lease-release acknowledgement retries cleanup without repeating persistence', async () => {
  const { client, safety } = await setup();
  safety.client.release = vi
    .fn()
    .mockRejectedValueOnce(new Error('release failed'))
    .mockResolvedValue(undefined);
  await edit();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText(/saved.*safety/i);
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByRole('button', { name: 'Edit content' });
  expect(client.update).toHaveBeenCalledOnce();
  expect(safety.client.release).toHaveBeenCalledTimes(2);
});

test.each(['New clip', 'Refresh'])(
  'focus departure does not swallow the intended %s action during a save',
  async (action) => {
    const { client, clip } = await setup();
    const pending = deferred<Clip>();
    client.update.mockReturnValue(pending.promise);
    const editor = await edit();
    const button = screen.getByRole<HTMLButtonElement>('button', {
      name: action,
    });
    fireEvent.blur(editor, { relatedTarget: button });
    await waitFor(() => expect(client.update).toHaveBeenCalledOnce());
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(client.list).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => pending.resolve({ ...clip, content: 'New content' }));
    if (action === 'New clip')
      expect(
        await screen.findByRole('dialog', { name: 'Create clip' }),
      ).toBeTruthy();
    // Initial load, post-save membership reconciliation, then the user's Refresh.
    else await waitFor(() => expect(client.list).toHaveBeenCalledTimes(3));
  },
);

test.each(['content', 'title', 'invalid title'] as const)(
  'a previous success is cleared before an inline %s failure without discarding the draft',
  async (mode) => {
    const { client } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await screen.findByText('Clip copied.');
    client.update.mockRejectedValueOnce(new Error('Synthetic failure'));
    const title = mode !== 'content';
    fireEvent.click(
      screen.getByRole('button', {
        name: title ? 'Edit clip title' : 'Edit content',
      }),
    );
    const input = await screen.findByRole<
      HTMLInputElement | HTMLTextAreaElement
    >('textbox', { name: title ? 'Clip title' : 'Clip content' });
    const value =
      mode === 'invalid title' ? 'x'.repeat(16 * 1024 + 1) : 'Retained draft';
    fireEvent.change(input, { target: { value } });
    fireEvent.click(
      screen.getByRole('button', {
        name: title ? 'Save clip title' : 'Save changes',
      }),
    );
    await screen.findByText(
      mode === 'invalid title' ? /Titles must be at most/ : /Could not save/,
    );
    expect(input.value).toBe(value);
    expect(screen.queryByText('Clip copied.')).toBeNull();
    expect(client.update).toHaveBeenCalledTimes(
      mode === 'invalid title' ? 0 : 1,
    );
  },
);

test('save failure can be retried without losing the draft or replaying failed navigation', async () => {
  const { client } = await setup();
  client.update.mockRejectedValueOnce(new Error('Synthetic failure'));
  await edit();
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  await screen.findByText(/Could not save content/);
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByRole('button', { name: 'Edit content' });
  expect(client.update).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('heading', { name: 'First note' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Settings' })).toBeNull();
});

test('rapid entry waits for one editor lease and blocks competing full-dialog navigation', async () => {
  const { safety } = await setup();
  const pending = deferred<{ generation: number; leaseId: number }>();
  safety.client.acquire = vi.fn(() => pending.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Edit content' }));
  fireEvent.doubleClick(
    screen.getByText('original **Markdown**', {
      selector: '.clip-content',
      exact: false,
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  await waitFor(() => expect(safety.client.acquire).toHaveBeenCalledOnce());
  expect(screen.queryByRole('textbox', { name: 'Clip content' })).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  await act(async () => pending.resolve({ generation: 1, leaseId: 1 }));
  expect(
    await screen.findByRole('textbox', { name: 'Clip content' }),
  ).toBeTruthy();
});

test('double-click preserves the selection position and raw content', async () => {
  await setup();
  const content = screen.getByText('original **Markdown**', {
    selector: '.clip-content',
    exact: false,
  });
  const selection = window.getSelection()!;
  const range = document.createRange();
  range.setStart(content.firstChild!, 2);
  range.setEnd(content.firstChild!, 6);
  selection.removeAllRanges();
  selection.addRange(range);
  fireEvent.doubleClick(content);
  const editor = await screen.findByRole<HTMLTextAreaElement>('textbox', {
    name: 'Clip content',
  });
  expect(editor.selectionStart).toBe(6);
  expect(editor.value).toContain('**Markdown**');
  selection.removeAllRanges();
});

test('pending full Edit lease acquisition excludes the inline editor', async () => {
  const { safety } = await setup();
  const pending = deferred<{ generation: number; leaseId: number }>();
  safety.client.acquire = vi.fn(() => pending.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  await waitFor(() => expect(safety.client.acquire).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: 'Edit content' }));
  await act(async () => {
    await Promise.resolve();
  });
  expect(safety.client.acquire).toHaveBeenCalledOnce();
  await act(async () => pending.resolve({ generation: 1, leaseId: 1 }));
  expect(await screen.findByRole('dialog', { name: 'Edit clip' })).toBeTruthy();
  expect(screen.queryByRole('textbox', { name: 'Clip content' })).toBeNull();
});

test('keyboard focus leaving the WebView also commits safely', async () => {
  const { client } = await setup();
  const editor = await edit();
  fireEvent.blur(editor, { relatedTarget: null });
  await waitFor(() => expect(client.update).toHaveBeenCalledOnce());
  await screen.findByRole('button', { name: 'Edit content' });
});
