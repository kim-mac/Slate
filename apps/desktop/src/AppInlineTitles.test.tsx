import type { Clip, ClipGroup, LibraryItem } from '@ai-clip-memory/shared';
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

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

async function setup(
  grouped = false,
  explicit: string | null = 'Original title',
) {
  const safety = installationSafetyFixture();
  const clip: Clip = {
    ...safetyClip,
    title: explicit,
    content: 'Original content',
    sourcePageTitle: 'Derived title',
  };
  const second = { ...clip, id: 'second', title: 'Second member' };
  const group: ClipGroup = {
    id: 'group',
    title: 'Group title',
    titleState: 'state-1',
    members: [clip, second],
    isPinned: false,
    createdAt: clip.createdAt,
    updatedAt: clip.updatedAt,
  };
  let items: LibraryItem[] = grouped
    ? [{ kind: 'group', group }]
    : [{ kind: 'clip', clip }];
  let close: (() => void) | undefined;
  const client = {
    ...tauriClipClient,
    list: vi.fn(async () => items),
    update: vi.fn<typeof tauriClipClient.update>(async (id, input, guard) => {
      let result: Clip | undefined;
      const update = (saved: Clip) => {
        if (saved.id !== id) return saved;
        if (
          guard &&
          'titleEdit' in guard &&
          saved.title !== guard.titleEdit.expectedTitle
        )
          throw { code: 'clip_changed' };
        result = {
          ...saved,
          ...(guard && 'titleEdit' in guard
            ? { title: input.title?.trim() || null }
            : { content: input.content }),
        };
        return result;
      };
      items = items.map((item) =>
        item.kind === 'clip'
          ? { ...item, clip: update(item.clip) }
          : {
              ...item,
              group: { ...item.group, members: item.group.members.map(update) },
            },
      );
      if (!result) throw { code: 'clip_changed' };
      return result;
    }),
    renameGroup: vi.fn<typeof tauriClipClient.renameGroup>(
      async (id: string, title: string, expectedState: string) => {
        const current = items.find(
          (item) => item.kind === 'group' && item.group.id === id,
        );
        if (
          current?.kind !== 'group' ||
          current.group.titleState !== expectedState
        )
          throw { code: 'group_changed' };
        const updated = {
          ...current.group,
          title: title.trim(),
          titleState: 'state-2',
        };
        items = [{ kind: 'group', group: updated }];
        return updated;
      },
    ),
    copyContent: vi.fn(async () => undefined),
    openSource: vi.fn(async () => undefined),
    deleteGroupMember: vi.fn(async () => undefined),
  };
  const hide = vi.fn(async () => undefined);
  render(
    <App
      client={client}
      safetyClient={{
        ...safety.client,
        onCloseRequested: async (callback) => {
          close = callback;
          return () => undefined;
        },
        hideMainAfterSave: hide,
      }}
      startupClient={{
        getEnabled: async () => false,
        setEnabled: async (v) => v,
      }}
    />,
  );
  fireEvent.click(
    (
      await screen.findByText(
        grouped ? group.title : explicit || 'Derived title',
      )
    ).closest('button')!,
  );
  await screen.findByRole('heading', {
    name: grouped ? group.title : explicit || 'Derived title',
  });
  return {
    clip,
    group,
    client,
    safety,
    hide,
    close: () => close?.(),
    replace: (next: LibraryItem[]) => {
      items = next;
    },
    read: () => items,
  };
}

async function title(value: string, group = false) {
  fireEvent.click(
    screen.getByRole('button', {
      name: group ? 'Edit group title' : 'Edit clip title',
    }),
  );
  const input = await screen.findByRole<HTMLInputElement>('textbox', {
    name: group ? 'Group title' : 'Clip title',
  });
  fireEvent.change(input, { target: { value } });
  return input;
}

test('clip title Enter uses title-only compare-and-set and releases the inline lease', async () => {
  const f = await setup();
  const input = await title('  Renamed title  ');
  fireEvent.keyDown(input, { key: 'Enter' });
  await screen.findByRole('heading', { name: 'Renamed title' });
  expect(f.client.update).toHaveBeenCalledExactlyOnceWith(
    f.clip.id,
    expect.objectContaining({ title: 'Renamed title' }),
    { titleEdit: { expectedTitle: 'Original title' } },
  );
  expect(f.safety.client.release).toHaveBeenCalledOnce();
});

test('unchanged derived title remains NULL and whitespace clears an explicit title', async () => {
  const f = await setup(false, null);
  fireEvent.click(screen.getByRole('button', { name: 'Edit clip title' }));
  await screen.findByRole('textbox', { name: 'Clip title' });
  fireEvent.click(screen.getByRole('button', { name: 'Save clip title' }));
  await waitFor(() => expect(f.client.update).toHaveBeenCalledOnce());
  expect(f.client.update.mock.calls[0]![1].title).toBeNull();
  await waitFor(() =>
    expect(screen.queryByRole('textbox', { name: 'Clip title' })).toBeNull(),
  );
  const input = await title('   ');
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(f.client.update).toHaveBeenCalledTimes(2));
  expect(f.client.update.mock.calls[1]![1].title).toBeNull();
});

test('Escape cancels and IME Enter does not save', async () => {
  const f = await setup();
  const input = await title('Draft title');
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  expect(f.client.update).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Escape' });
  await waitFor(() =>
    expect(screen.queryByRole('textbox', { name: 'Clip title' })).toBeNull(),
  );
  expect(f.client.update).not.toHaveBeenCalled();
  expect(screen.getByRole('heading', { name: 'Original title' })).toBeTruthy();
});

test('clearing an explicit clip title restores the existing displayed fallback', async () => {
  const f = await setup();
  const input = await title('   ');
  fireEvent.keyDown(input, { key: 'Enter' });
  await screen.findByRole('heading', { name: 'Derived title' });
  expect(f.client.update).toHaveBeenCalledExactlyOnceWith(
    f.clip.id,
    expect.objectContaining({ title: null }),
    { titleEdit: { expectedTitle: 'Original title' } },
  );
});

test('title leases block preparation acknowledgements and close saves before hiding', async () => {
  const f = await setup();
  await title('Saved on close');
  await act(async () => f.safety.emit({ generation: 2, preparing: true }));
  expect(f.safety.client.acknowledge).not.toHaveBeenCalled();
  await act(async () => f.safety.emit({ generation: 3, preparing: false }));
  await act(async () => f.close());
  await waitFor(() => expect(f.hide).toHaveBeenCalledOnce());
  expect(f.client.update).toHaveBeenCalledOnce();
  expect(f.safety.client.release).toHaveBeenCalledOnce();
  expect(
    vi.mocked(f.safety.client.release).mock.invocationCallOrder[0],
  ).toBeLessThan(f.hide.mock.invocationCallOrder[0]!);
});

test('group title uses authoritative expected state and becomes searchable', async () => {
  const f = await setup(true);
  const input = await title('Renamed collection', true);
  fireEvent.keyDown(input, { key: 'Enter' });
  await screen.findByRole('heading', { name: 'Renamed collection' });
  expect(f.client.renameGroup).toHaveBeenCalledExactlyOnceWith(
    'group',
    'Renamed collection',
    'state-1',
  );
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search clips' }), {
    target: { value: 'Renamed collection' },
  });
  expect(
    screen.getByText('Renamed collection', {
      selector: '.clip-list-title span',
    }),
  ).toBeTruthy();
});

test('blank group title retains draft, lease, and Escape cancellation', async () => {
  const f = await setup(true);
  const input = await title('   ', true);
  fireEvent.keyDown(input, { key: 'Enter' });
  await screen.findByRole('alert');
  expect(f.client.renameGroup).not.toHaveBeenCalled();
  expect(f.safety.client.release).not.toHaveBeenCalled();
  expect(input.value).toBe('   ');
  fireEvent.keyDown(input, { key: 'Escape' });
  await waitFor(() => expect(f.safety.client.release).toHaveBeenCalledOnce());
});

test('failed title save blocks switching to content, preserves draft and permits retry', async () => {
  const f = await setup();
  f.client.update.mockRejectedValueOnce(new Error('database busy'));
  await title('Preserved draft');
  fireEvent.click(screen.getByRole('button', { name: 'Edit content' }));
  await screen.findByRole('alert');
  expect(
    screen.getByRole<HTMLInputElement>('textbox', { name: 'Clip title' }).value,
  ).toBe('Preserved draft');
  expect(screen.queryByRole('textbox', { name: 'Clip content' })).toBeNull();
  expect(f.safety.client.release).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Edit content' }));
  await screen.findByRole('textbox', { name: 'Clip content' });
  expect(f.client.update).toHaveBeenCalledTimes(2);
});

test('menu order, disabled source, keyboard and Delete confirmation use existing handlers', async () => {
  const f = await setup(true);
  const trigger = screen.getByRole('button', {
    name: 'Actions for Original title',
  });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const menu = await screen.findByRole('menu');
  await waitFor(() =>
    expect(document.activeElement).toBe(
      within(menu).getByRole('menuitem', { name: 'Edit' }),
    ),
  );
  expect(
    within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent),
  ).toEqual(['Edit', 'Open source', 'Unmerge', 'Delete']);
  expect(
    within(menu)
      .getByRole('menuitem', { name: 'Open source' })
      .getAttribute('aria-disabled'),
  ).toBe('true');
  fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
  await screen.findByRole('alertdialog');
  expect(f.client.deleteGroupMember).not.toHaveBeenCalled();
});

test('menu waits for title save and lease cleanup, coalescing blur and click', async () => {
  const f = await setup(true);
  const save = deferred<ClipGroup>();
  f.client.renameGroup.mockReturnValueOnce(save.promise);
  const input = await title('Saved collection', true);
  const trigger = screen.getByRole('button', {
    name: 'Actions for Original title',
  });
  fireEvent.blur(input, { relatedTarget: trigger });
  fireEvent.click(trigger);
  fireEvent.click(trigger);
  expect(screen.queryByRole('menu')).toBeNull();
  expect(f.client.renameGroup).toHaveBeenCalledOnce();
  await act(async () =>
    save.resolve({ ...f.group, title: 'Saved collection' }),
  );
  await screen.findByRole('menu');
  expect(f.safety.client.release).toHaveBeenCalledOnce();
});

test('failed save prevents menu opening and close request keeps title draft protected', async () => {
  const f = await setup(true);
  f.client.renameGroup.mockRejectedValue(new Error('busy'));
  await title('Draft collection', true);
  fireEvent.click(
    screen.getByRole('button', { name: 'Actions for Original title' }),
  );
  await screen.findByRole('alert');
  expect(screen.queryByRole('menu')).toBeNull();
  await act(async () => f.close());
  expect(f.hide).not.toHaveBeenCalled();
  expect(
    screen.getByRole<HTMLInputElement>('textbox', { name: 'Group title' })
      .value,
  ).toBe('Draft collection');
});

test('UTF-8 limit rejects a title without truncation or releasing its lease', async () => {
  const f = await setup();
  const value = '😀'.repeat(4097);
  const input = await title(value);
  fireEvent.keyDown(input, { key: 'Enter' });
  await screen.findByText(/at most 16 KiB/);
  expect(input.value).toBe(value);
  expect(f.client.update).not.toHaveBeenCalled();
  expect(f.safety.client.release).not.toHaveBeenCalled();
});

test.each(['clip', 'group'])(
  'a concurrent %s rename preserves the stale draft until explicit cancellation',
  async (kind) => {
    const f = await setup(kind === 'group');
    const input = await title('My draft', kind === 'group');
    f.replace(
      kind === 'group'
        ? [
            {
              kind: 'group',
              group: {
                ...f.group,
                title: 'External title',
                titleState: 'external',
              },
            },
          ]
        : [{ kind: 'clip', clip: { ...f.clip, title: 'External title' } }],
    );
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText(/changed or was deleted/);
    expect(input.value).toBe('My draft');
    expect(f.safety.client.release).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' });
    await screen.findByRole('heading', { name: 'External title' });
  },
);

test.each(['save', 'cancel'])(
  'a clip becoming grouped keeps the title input mounted through %s',
  async (action) => {
    const f = await setup();
    const input = await title('My draft');
    f.replace([
      {
        kind: 'group',
        group: { ...f.group, members: [f.clip, f.group.members[1]!] },
      },
    ]);
    await act(async () => fireEvent.focus(window));
    expect(screen.getByRole('textbox', { name: 'Clip title' })).toBe(input);
    fireEvent.keyDown(input, { key: action === 'save' ? 'Enter' : 'Escape' });
    await screen.findByRole('heading', { name: f.group.title });
    expect(f.client.update).toHaveBeenCalledTimes(action === 'save' ? 1 : 0);
  },
);

test.each(['dissolved', 'deleted', 'appended'])(
  'group %s never silently drops a title draft or recreates a group',
  async (change) => {
    const f = await setup(true);
    const input = await title('My collection', true);
    f.replace(
      change === 'deleted'
        ? []
        : change === 'dissolved'
          ? [{ kind: 'clip', clip: f.clip }]
          : [
              {
                kind: 'group',
                group: {
                  ...f.group,
                  titleState: 'appended',
                  members: [...f.group.members, { ...f.clip, id: 'new' }],
                },
              },
            ],
    );
    await act(async () => fireEvent.focus(window));
    expect(screen.getByRole('textbox', { name: 'Group title' })).toBe(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText(/changed or was deleted/);
    expect(input.value).toBe('My collection');
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Group title' })).toBeNull(),
    );
    expect(f.client.renameGroup).toHaveBeenCalledOnce();
  },
);

test('external deletion followed by a failed read keeps the retained title editor cancellable', async () => {
  const f = await setup();
  const input = await title('Recoverable draft');
  f.replace([]);
  await act(async () => fireEvent.focus(window));
  f.client.list.mockRejectedValue(new Error('read failed'));
  await act(async () => fireEvent.focus(window));
  expect(screen.getByRole('textbox', { name: 'Clip title' })).toBe(input);
  expect(input.value).toBe('Recoverable draft');
  fireEvent.keyDown(input, { key: 'Escape' });
  await waitFor(() => expect(f.safety.client.release).toHaveBeenCalledOnce());
  expect(f.client.update).not.toHaveBeenCalled();
});

test('content-to-title switching saves once before acquiring the next lease', async () => {
  const f = await setup();
  fireEvent.click(screen.getByRole('button', { name: 'Edit content' }));
  fireEvent.change(
    await screen.findByRole('textbox', { name: 'Clip content' }),
    { target: { value: 'New content' } },
  );
  fireEvent.click(screen.getByRole('button', { name: 'Edit clip title' }));
  const input = await screen.findByRole('textbox', { name: 'Clip title' });
  expect(input).toHaveProperty('value', 'Original title');
  expect(f.client.update).toHaveBeenCalledOnce();
  expect(f.safety.client.acquire).toHaveBeenCalledTimes(2);
  expect(f.safety.client.release).toHaveBeenCalledOnce();
});

test('a deferred standalone title switch refuses a clip that became a group member', async () => {
  const f = await setup();
  fireEvent.click(screen.getByRole('button', { name: 'Edit content' }));
  await screen.findByRole('textbox', { name: 'Clip content' });
  f.replace([{ kind: 'group', group: f.group }]);
  fireEvent.click(screen.getByRole('button', { name: 'Edit clip title' }));
  await screen.findByText(/This clip or group changed/);
  expect(screen.queryByRole('textbox', { name: 'Clip title' })).toBeNull();
  expect(f.safety.client.acquire).toHaveBeenCalledOnce();
  expect(f.safety.client.release).toHaveBeenCalledOnce();
});

test('pasting line breaks into a title is rejected rather than silently flattening text', async () => {
  const f = await setup();
  const input = await title('Draft');
  fireEvent.paste(input, { clipboardData: { getData: () => 'first\nsecond' } });
  await screen.findByText(/Titles cannot contain line breaks/);
  expect(input.value).toBe('Draft');
  expect(f.client.update).not.toHaveBeenCalled();
});

test('outside click, blur, checkmark and Copy share one save and one deferred action', async () => {
  const f = await setup();
  const pending = deferred<Clip>();
  f.client.update.mockReturnValueOnce(pending.promise);
  const input = await title('Saved');
  const copy = screen.getByRole('button', { name: 'Copy' });
  fireEvent.blur(input, { relatedTarget: copy });
  fireEvent.click(screen.getByRole('button', { name: 'Save clip title' }));
  fireEvent.click(copy);
  fireEvent.click(copy);
  expect(f.client.update).toHaveBeenCalledOnce();
  expect(f.client.copyContent).not.toHaveBeenCalled();
  await act(async () => pending.resolve({ ...f.clip, title: 'Saved' }));
  await waitFor(() => expect(f.client.copyContent).toHaveBeenCalledOnce());
  expect(f.safety.client.release).toHaveBeenCalledOnce();
});

test('a committed title retries safety cleanup without repeating persistence after failed reads', async () => {
  const f = await setup();
  f.client.list.mockRejectedValue(new Error('read busy'));
  vi.mocked(f.safety.client.release).mockRejectedValueOnce(
    new Error('ack busy'),
  );
  await title('Saved');
  fireEvent.click(screen.getByRole('button', { name: 'Save clip title' }));
  await screen.findByText(/Title saved, but safety cleanup failed/);
  f.client.list.mockResolvedValue(f.read());
  fireEvent.click(screen.getByRole('button', { name: 'Save clip title' }));
  await waitFor(() =>
    expect(screen.queryByRole('textbox', { name: 'Clip title' })).toBeNull(),
  );
  expect(f.client.update).toHaveBeenCalledOnce();
  expect(f.safety.client.release).toHaveBeenCalledTimes(2);
});

test('member menu Escape restores focus and opening never adds title pencils to members', async () => {
  await setup(true);
  const trigger = screen.getByRole('button', {
    name: 'Actions for Original title',
  });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const menu = await screen.findByRole('menu');
  fireEvent.keyDown(menu, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(
    screen.getAllByRole('button', { name: 'Edit group title' }),
  ).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'Edit clip title' })).toBeNull();
});

test('saving or cancelling a group title does not refocus Back or scroll the existing viewport', async () => {
  const f = await setup(true);
  const viewport = document.querySelector(
    '.merged-clip-detail [data-slot="scroll-area-viewport"]',
  )!;
  viewport.scrollTop = 420;
  const back = vi.spyOn(
    screen.getByRole('button', { name: 'Back to calendar' }),
    'focus',
  );
  const focus = vi.spyOn(HTMLInputElement.prototype, 'focus');
  fireEvent.click(screen.getByRole('button', { name: 'Edit group title' }));
  const input = await screen.findByRole('textbox', { name: 'Group title' });
  expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
  fireEvent.change(input, { target: { value: 'Renamed group' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await screen.findByRole('heading', { name: 'Renamed group' });
  expect(f.client.renameGroup).toHaveBeenCalledOnce();
  expect(back).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Edit group title' }));
  fireEvent.keyDown(
    await screen.findByRole('textbox', { name: 'Group title' }),
    { key: 'Escape' },
  );
  await waitFor(() =>
    expect(screen.queryByRole('textbox', { name: 'Group title' })).toBeNull(),
  );
  expect(back).not.toHaveBeenCalled();
  expect(
    document.querySelector(
      '.merged-clip-detail [data-slot="scroll-area-viewport"]',
    ),
  ).toBe(viewport);
  expect(viewport.scrollTop).toBe(420);
  focus.mockRestore();
});
