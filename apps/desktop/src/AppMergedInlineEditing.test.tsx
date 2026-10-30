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

async function setup() {
  const safety = installationSafetyFixture();
  let closeRequested: (() => void) | undefined;
  const onCloseRequested = vi.fn(async (receive: () => void) => {
    closeRequested = receive;
    return () => undefined;
  });
  const hideMainAfterSave = vi.fn(async () => undefined);
  const first: Clip = {
    ...safetyClip,
    id: 'first',
    title: 'First member',
    content: 'First content',
    sourceUrl: 'https://example.com/document',
    sourcePageTitle: 'Source title',
    isPinned: true,
  };
  const second: Clip = {
    ...first,
    id: 'second',
    title: 'Second member',
    content: 'Second content',
  };
  const group: ClipGroup = {
    id: 'group',
    title: 'Stable group title',
    isPinned: false,
    createdAt: first.createdAt,
    updatedAt: first.updatedAt,
    members: [first, second],
  };
  let items: LibraryItem[] = [{ kind: 'group', group }];
  const client = {
    ...tauriClipClient,
    list: vi.fn(async () => items),
    update: vi.fn(async (id, input, guard?) => {
      let result: Clip | undefined;
      items = items.map((item) => {
        const update = (clip: Clip): Clip => {
          if (clip.id !== id) return clip;
          if (guard && clip.content !== guard.expectedContent)
            throw new Error('content_conflict');
          const updated: Clip = {
            ...clip,
            ...(guard ? { content: input.content } : input),
            updatedAt: '2026-10-21T20:00:00Z',
          };
          result = updated;
          return updated;
        };
        return item.kind === 'clip'
          ? { ...item, clip: update(item.clip) }
          : {
              ...item,
              group: { ...item.group, members: item.group.members.map(update) },
            };
      });
      if (!result) throw new Error('not_found');
      return result;
    }) as typeof tauriClipClient.update,
    copyContent: vi.fn(async () => undefined),
    openSource: vi.fn(async () => undefined),
    setGroupPinned: vi.fn(async (_id, isPinned) => ({ ...group, isPinned })),
    unmergeMember: vi.fn(async () => undefined),
    unmergeGroup: vi.fn(async () => undefined),
    deleteGroupMember: vi.fn(async () => undefined),
    deleteGroup: vi.fn(async () => undefined),
  };
  render(
    <App
      client={client}
      safetyClient={{ ...safety.client, onCloseRequested, hideMainAfterSave }}
      startupClient={{
        getEnabled: async () => false,
        setEnabled: async (v) => v,
      }}
    />,
  );
  fireEvent.click(
    (await screen.findByText('Stable group title')).closest('button')!,
  );
  await screen.findByRole('heading', { name: 'Stable group title' });
  return {
    client,
    safety,
    first,
    second,
    group,
    read: () => items,
    replace: (next: LibraryItem[]) => {
      items = next;
    },
    close: () => closeRequested?.(),
    hideMainAfterSave,
  };
}

async function edit(title = 'First member', value = 'Edited member content') {
  fireEvent.click(
    screen.getByRole('button', { name: `Edit content: ${title}` }),
  );
  const input = await screen.findByRole<HTMLTextAreaElement>('textbox', {
    name: `Clip content: ${title}`,
  });
  fireEvent.change(input, { target: { value } });
  return input;
}

test('a member menu read superseded by focus refresh cannot restore removed membership or open its menu', async () => {
  const f = await setup();
  const stale = deferred<LibraryItem[]>();
  f.client.list.mockReturnValueOnce(stale.promise);
  fireEvent.click(
    screen.getByRole('button', { name: 'Actions for Second member' }),
  );
  await waitFor(() => expect(f.client.list).toHaveBeenCalledTimes(2));
  const third = {
    ...f.second,
    id: 'third',
    title: 'Third member',
    content: 'New membership',
  };
  f.replace([
    { kind: 'group', group: { ...f.group, members: [f.first, third] } },
    { kind: 'clip', clip: f.second },
  ]);
  fireEvent.focus(window);
  await waitFor(() => expect(f.client.list).toHaveBeenCalledTimes(3));
  await screen.findByText('New membership');
  await act(async () => stale.resolve([{ kind: 'group', group: f.group }]));
  expect(screen.getByText('New membership')).toBeTruthy();
  expect(screen.queryByRole('menu')).toBeNull();
  expect(screen.getByText(/This clip or group changed/)).toBeTruthy();
});

test('pending post-save reconciliation blocks focus reads and resolves current external membership', async () => {
  const f = await setup();
  const stale = deferred<LibraryItem[]>();
  await edit();
  f.client.list.mockReturnValueOnce(stale.promise);
  fireEvent.click(
    screen.getByRole('button', { name: 'Save changes: First member' }),
  );
  await waitFor(() => expect(f.client.list).toHaveBeenCalledTimes(2));
  f.replace([
    { kind: 'clip', clip: { ...f.first, content: 'Edited member content' } },
    { kind: 'clip', clip: f.second },
  ]);
  fireEvent.focus(window);
  expect(f.client.list).toHaveBeenCalledTimes(2);
  await act(async () => stale.resolve(f.read()));
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  expect(screen.queryByRole('heading', { name: f.group.title })).toBeNull();
  expect(screen.getByRole('button', { name: 'Edit content' })).toBeTruthy();
});

test('cancel reconciliation superseded by focus refresh cannot restore old group membership', async () => {
  const f = await setup();
  const stale = deferred<LibraryItem[]>();
  const input = await edit();
  f.client.list.mockReturnValueOnce(stale.promise);
  fireEvent.keyDown(input, { key: 'Escape' });
  await waitFor(() => expect(f.client.list).toHaveBeenCalledTimes(2));
  f.replace([
    { kind: 'clip', clip: f.first },
    { kind: 'clip', clip: f.second },
  ]);
  fireEvent.focus(window);
  await waitFor(() => expect(f.client.list).toHaveBeenCalledTimes(3));
  await act(async () => stale.resolve([{ kind: 'group', group: f.group }]));
  expect(screen.queryAllByText(f.group.title)).toHaveLength(0);
});

test('member pencil and checkmark use guarded content-only update and preserve group and metadata', async () => {
  const f = await setup();
  await edit();
  fireEvent.click(
    screen.getByRole('button', { name: 'Save changes: First member' }),
  );
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  expect(f.client.update).toHaveBeenCalledExactlyOnceWith(
    f.first.id,
    expect.objectContaining({ content: 'Edited member content' }),
    { expectedContent: f.first.content },
  );
  expect(f.read()).toEqual([
    {
      kind: 'group',
      group: {
        ...f.group,
        members: [
          {
            ...f.first,
            content: 'Edited member content',
            updatedAt: '2026-10-21T20:00:00Z',
          },
          f.second,
        ],
      },
    },
  ]);
  expect(f.safety.client.release).toHaveBeenCalledOnce();
});

test('switching members waits for one save and cleanup before acquiring the next lease', async () => {
  const f = await setup();
  const saved = deferred<Clip>();
  vi.mocked(f.client.update).mockReturnValueOnce(saved.promise);
  await edit();
  fireEvent.click(
    screen.getByRole('button', { name: 'Edit content: Second member' }),
  );
  await waitFor(() => expect(f.client.update).toHaveBeenCalledOnce());
  expect(f.safety.client.acquire).toHaveBeenCalledTimes(1);
  await act(async () =>
    saved.resolve({ ...f.first, content: 'Edited member content' }),
  );
  expect(
    await screen.findByRole('textbox', { name: 'Clip content: Second member' }),
  ).toBeTruthy();
  expect(f.safety.client.acquire).toHaveBeenCalledTimes(2);
  expect(f.safety.client.release).toHaveBeenCalledOnce();
});

test('failed member switch keeps the original draft and Escape cancels without another write', async () => {
  const f = await setup();
  vi.mocked(f.client.update).mockRejectedValueOnce(new Error('conflict'));
  const input = await edit();
  fireEvent.click(
    screen.getByRole('button', { name: 'Edit content: Second member' }),
  );
  await screen.findByText(/Could not save content/);
  expect(input).toHaveProperty('value', 'Edited member content');
  expect(f.safety.client.acquire).toHaveBeenCalledOnce();
  expect(f.safety.client.release).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  expect(f.client.update).toHaveBeenCalledOnce();
});

test.each([false, true])(
  'native Close waits for save and hides only on success (failure: %s)',
  async (fails) => {
    const f = await setup();
    let rejectSave!: (error: Error) => void;
    let resolveSave!: (clip: Clip) => void;
    const pending = new Promise<Clip>((resolve, reject) => {
      resolveSave = resolve;
      rejectSave = reject;
    });
    vi.mocked(f.client.update).mockReturnValueOnce(pending);
    await edit();
    act(() => {
      f.close();
      f.close();
    });
    await waitFor(() => expect(f.client.update).toHaveBeenCalledOnce());
    expect(f.hideMainAfterSave).not.toHaveBeenCalled();
    if (fails) {
      await act(async () =>
        rejectSave(new Error('synthetic persistence failure')),
      );
      await screen.findByText(/Could not save content/);
      expect(
        screen.getByRole('textbox', { name: 'Clip content: First member' }),
      ).toBeTruthy();
      expect(f.hideMainAfterSave).not.toHaveBeenCalled();
    } else {
      await act(async () =>
        resolveSave({ ...f.first, content: 'Edited member content' }),
      );
      await waitFor(() => expect(f.hideMainAfterSave).toHaveBeenCalledOnce());
      expect(f.safety.client.release).toHaveBeenCalledOnce();
    }
  },
);

test('external append refreshes members without replacing the active textarea or draft', async () => {
  const f = await setup();
  const input = await edit();
  f.replace([
    {
      kind: 'group',
      group: {
        ...f.group,
        members: [
          ...f.group.members,
          {
            ...f.second,
            id: 'third',
            title: 'Third member',
            content: 'Captured later',
          },
        ],
      },
    },
  ]);
  fireEvent.focus(window);
  await screen.findByText('Captured later');
  expect(
    screen.getByRole('textbox', { name: 'Clip content: First member' }),
  ).toBe(input);
  expect(input).toHaveProperty('value', 'Edited member content');
  expect(f.safety.client.release).not.toHaveBeenCalled();
});

test.each(['save', 'cancel'])(
  'external unmerge and group dissolution retain the draft until %s and then select the actual clip',
  async (action) => {
    const f = await setup();
    const input = await edit();
    f.replace([
      { kind: 'clip', clip: f.first },
      { kind: 'clip', clip: f.second },
    ]);
    fireEvent.focus(window);
    await screen.findByText(/This group is no longer available/);
    expect(
      screen.getByRole('textbox', { name: 'Clip content: First member' }),
    ).toBe(input);
    if (action === 'save')
      fireEvent.click(
        screen.getByRole('button', { name: 'Save changes: First member' }),
      );
    else fireEvent.keyDown(input, { key: 'Escape' });
    expect(
      await screen.findByRole('button', { name: 'Edit content' }),
    ).toBeTruthy();
    expect(
      screen.queryByRole('heading', { name: 'Stable group title' }),
    ).toBeNull();
    expect(f.read().every((item) => item.kind === 'clip')).toBe(true);
    expect(f.client.unmergeMember).not.toHaveBeenCalled();
  },
);

test.each(['save', 'cancel'])(
  'external unmerge retains the member editor while its group survives, then %s resolves actual membership',
  async (action) => {
    const f = await setup();
    const input = await edit();
    const third = {
      ...f.second,
      id: 'third',
      title: 'Third member',
      content: 'Third original content',
    };
    const remaining = { ...f.group, members: [f.second, third] };
    f.replace([
      { kind: 'group', group: remaining },
      { kind: 'clip', clip: f.first },
    ]);
    fireEvent.focus(window);
    await screen.findByText(/This clip is no longer in this group/);
    expect(
      screen.getByRole('textbox', { name: 'Clip content: First member' }),
    ).toBe(input);
    expect(screen.getByText('Third original content')).toBeTruthy();
    if (action === 'save')
      fireEvent.click(
        screen.getByRole('button', { name: 'Save changes: First member' }),
      );
    else fireEvent.keyDown(input, { key: 'Escape' });
    expect(
      await screen.findByRole('button', { name: 'Edit content' }),
    ).toBeTruthy();
    expect(f.read().find((item) => item.kind === 'group')).toEqual({
      kind: 'group',
      group: remaining,
    });
    expect(f.client.unmergeMember).not.toHaveBeenCalled();
  },
);

test('concurrent metadata changes are preserved by the content-only save', async () => {
  const f = await setup();
  await edit();
  const latest = {
    ...f.first,
    title: 'New external title',
    sourceApp: 'New app',
    sourceUrl: 'https://example.com/changed-source',
    sourcePageTitle: 'New page',
    isPinned: false,
  };
  f.replace([
    { kind: 'group', group: { ...f.group, members: [latest, f.second] } },
  ]);
  fireEvent.click(
    screen.getByRole('button', { name: 'Save changes: First member' }),
  );
  await waitFor(() =>
    expect(screen.queryByRole('textbox', { name: /Clip content/ })).toBeNull(),
  );
  expect(f.read()).toEqual([
    {
      kind: 'group',
      group: {
        ...f.group,
        members: [
          {
            ...latest,
            content: 'Edited member content',
            updatedAt: '2026-10-21T20:00:00Z',
          },
          f.second,
        ],
      },
    },
  ]);
});

test.each(['deleted', 'changed'])(
  'external %s clip rejects saving, retains draft and can be explicitly cancelled',
  async (change) => {
    const f = await setup();
    const input = await edit();
    f.replace(
      change === 'deleted'
        ? [{ kind: 'clip', clip: f.second }]
        : [
            {
              kind: 'group',
              group: {
                ...f.group,
                members: [
                  {
                    ...f.first,
                    content: 'Newer external content',
                    title: 'Externally changed title',
                  },
                  f.second,
                ],
              },
            },
          ],
    );
    fireEvent.focus(window);
    await waitFor(() => expect(f.client.list).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: /Save changes:/ }));
    await screen.findByText(/Could not save content/);
    expect(input).toHaveProperty('value', 'Edited member content');
    expect(f.safety.client.release).not.toHaveBeenCalled();
    expect(JSON.stringify(f.read())).not.toContain('Edited member content');
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() =>
      expect(
        screen.queryByRole('textbox', { name: /Clip content/ }),
      ).toBeNull(),
    );
    expect(f.safety.client.release).toHaveBeenCalledOnce();
  },
);

test.each([
  'Pin merged clip',
  'Unmerge First member',
  'Unmerge all clips',
  'Edit Second member',
  'Delete First member',
  'Delete merged clip',
  'Open source',
  'Back to calendar',
])(
  '%s waits for the shared member save and runs at most once',
  async (action) => {
    const f = await setup();
    const save = deferred<Clip>();
    vi.mocked(f.client.update).mockReturnValueOnce(save.promise);
    await edit();
    const menuAction = (
      {
        'Unmerge First member': ['First member', 'Unmerge'],
        'Edit Second member': ['Second member', 'Edit'],
        'Delete First member': ['First member', 'Delete'],
        'Open source': ['Second member', 'Open source'],
      } as Record<string, string[]>
    )[action];
    const target = screen.getByRole('button', {
      name: menuAction ? `Actions for ${menuAction[0]}` : action,
    });
    fireEvent.click(target);
    await waitFor(() => expect(f.client.update).toHaveBeenCalledOnce());
    fireEvent.click(target);
    expect(f.client.setGroupPinned).not.toHaveBeenCalled();
    expect(f.client.unmergeMember).not.toHaveBeenCalled();
    expect(f.client.unmergeGroup).not.toHaveBeenCalled();
    expect(f.client.openSource).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await act(async () =>
      save.resolve({ ...f.first, content: 'Edited member content' }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('textbox', { name: /Clip content/ }),
      ).toBeNull(),
    );
    if (menuAction)
      fireEvent.click(
        await screen.findByRole('menuitem', { name: menuAction[1]! }),
      );
    if (action === 'Pin merged clip')
      await waitFor(() =>
        expect(f.client.setGroupPinned).toHaveBeenCalledExactlyOnceWith(
          f.group.id,
          true,
        ),
      );
    if (action === 'Unmerge First member')
      await waitFor(() =>
        expect(f.client.unmergeMember).toHaveBeenCalledExactlyOnceWith(
          f.group.id,
          f.first.id,
        ),
      );
    if (action === 'Unmerge all clips')
      await waitFor(() =>
        expect(f.client.unmergeGroup).toHaveBeenCalledExactlyOnceWith(
          f.group.id,
        ),
      );
    if (action === 'Open source')
      await waitFor(() =>
        expect(f.client.openSource).toHaveBeenCalledExactlyOnceWith(
          f.second.id,
        ),
      );
    if (action === 'Edit Second member')
      expect(
        await screen.findByRole('dialog', { name: 'Edit clip' }),
      ).toBeTruthy();
    if (action.startsWith('Delete'))
      expect(await screen.findByRole('alertdialog')).toBeTruthy();
    expect(f.client.update).toHaveBeenCalledOnce();
  },
);

test('a deferred member action rejects a stale target rather than unmerging another membership', async () => {
  const f = await setup();
  const save = deferred<Clip>();
  vi.mocked(f.client.update).mockReturnValueOnce(save.promise);
  await edit();
  fireEvent.click(
    screen.getByRole('button', { name: 'Actions for Second member' }),
  );
  await waitFor(() => expect(f.client.update).toHaveBeenCalledOnce());
  f.replace([
    { kind: 'clip', clip: f.first },
    { kind: 'clip', clip: f.second },
  ]);
  await act(async () =>
    save.resolve({ ...f.first, content: 'Edited member content' }),
  );
  await screen.findByText(/This clip or group changed/);
  expect(f.client.unmergeMember).not.toHaveBeenCalled();
});

test('checkmark plus blur shares one save and member drafts block update acknowledgements', async () => {
  const f = await setup();
  const input = await edit();
  const save = deferred<Clip>();
  vi.mocked(f.client.update).mockReturnValueOnce(save.promise);
  const checkmark = screen.getByRole('button', {
    name: 'Save changes: First member',
  });
  fireEvent.blur(input, { relatedTarget: checkmark });
  fireEvent.click(checkmark);
  fireEvent.blur(input, { relatedTarget: null });
  await waitFor(() => expect(f.client.update).toHaveBeenCalledOnce());
  act(() => f.safety.emit({ generation: 1, preparing: true }));
  expect(f.safety.client.acknowledge).not.toHaveBeenCalled();
  expect(input).toHaveProperty('value', 'Edited member content');
  await act(async () =>
    save.resolve({ ...f.first, content: 'Edited member content' }),
  );
  expect(f.client.update).toHaveBeenCalledOnce();
});

test('member double-click uses the shared raw-text editor and Escape leaves content untouched', async () => {
  const f = await setup();
  fireEvent.doubleClick(
    screen.getByText('First content', { selector: '.clip-content' }),
  );
  const input = await screen.findByRole('textbox', {
    name: 'Clip content: First member',
  });
  expect(document.activeElement).toBe(input);
  expect(input).toHaveProperty('value', f.first.content);
  fireEvent.change(input, { target: { value: 'Cancelled text' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  await waitFor(() =>
    expect(screen.queryByRole('textbox', { name: /Clip content/ })).toBeNull(),
  );
  expect(f.client.update).not.toHaveBeenCalled();
  expect(f.read()).toEqual([{ kind: 'group', group: f.group }]);
});

test('member save failure permits explicit retry without replaying the failed navigation', async () => {
  const f = await setup();
  vi.mocked(f.client.update).mockRejectedValueOnce(
    new Error('private storage details'),
  );
  await edit();
  fireEvent.click(screen.getByRole('button', { name: 'Back to calendar' }));
  await screen.findByText(/Could not save content/);
  expect(screen.queryByText('private storage details')).toBeNull();
  fireEvent.click(
    screen.getByRole('button', { name: 'Save changes: First member' }),
  );
  await waitFor(() =>
    expect(screen.queryByRole('textbox', { name: /Clip content/ })).toBeNull(),
  );
  expect(
    screen.getByRole('heading', { name: 'Stable group title' }),
  ).toBeTruthy();
  expect(f.client.update).toHaveBeenCalledTimes(2);
  expect(f.safety.client.release).toHaveBeenCalledOnce();
});

test('a structured content conflict is explained without exposing backend details', async () => {
  const f = await setup();
  vi.mocked(f.client.update).mockRejectedValueOnce({
    code: 'clip_changed',
    message: 'private backend details',
  });
  await edit();
  fireEvent.click(
    screen.getByRole('button', { name: 'Save changes: First member' }),
  );
  await screen.findByText(/this clip changed or was deleted/);
  expect(screen.queryByText('private backend details')).toBeNull();
  expect(f.safety.client.release).not.toHaveBeenCalled();
});

test('Close after a lost cleanup acknowledgement retries cleanup without repeating persistence', async () => {
  const f = await setup();
  let nativeReleased = false;
  vi.mocked(f.safety.client.release).mockImplementation(async () => {
    if (!nativeReleased) {
      nativeReleased = true; // Native release completed before its reply was lost.
      throw new Error('lost response');
    }
    // The exact already-released lease is acknowledged on retry.
  });
  await edit();
  act(() => f.close());
  await screen.findByText(/Content saved, but safety cleanup failed/);
  expect(nativeReleased).toBe(true);
  expect(f.hideMainAfterSave).not.toHaveBeenCalled();
  act(() => f.close());
  await waitFor(() => expect(f.hideMainAfterSave).toHaveBeenCalledOnce());
  expect(f.client.update).toHaveBeenCalledOnce();
  expect(f.safety.client.release).toHaveBeenCalledTimes(2);
});

test('switching groups saves the current member before navigating to the actual group', async () => {
  const f = await setup();
  const next = {
    ...f.group,
    id: 'next-group',
    title: 'Next group',
    members: f.group.members.map((clip) => ({
      ...clip,
      id: `${clip.id}-next`,
    })),
  };
  f.replace([...f.read(), { kind: 'group', group: next }]);
  fireEvent.focus(window);
  await screen.findByText('Next group');
  const save = deferred<Clip>();
  vi.mocked(f.client.update).mockReturnValueOnce(save.promise);
  await edit();
  fireEvent.click(screen.getByText('Next group').closest('button')!);
  await waitFor(() => expect(f.client.update).toHaveBeenCalledOnce());
  expect(
    screen.getByRole('textbox', { name: 'Clip content: First member' }),
  ).toBeTruthy();
  await act(async () =>
    save.resolve({ ...f.first, content: 'Edited member content' }),
  );
  expect(
    await screen.findByRole('heading', { name: 'Next group' }),
  ).toBeTruthy();
});

test('a pending authoritative action read admits only its original deferred action', async () => {
  const f = await setup();
  const reading = deferred<LibraryItem[]>();
  await edit();
  f.client.list
    .mockResolvedValueOnce(f.read())
    .mockResolvedValueOnce(f.read())
    .mockReturnValueOnce(reading.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Pin merged clip' }));
  await waitFor(() => expect(f.client.list).toHaveBeenCalledTimes(4));
  fireEvent.click(screen.getByRole('button', { name: 'Unmerge all clips' }));
  expect(f.client.unmergeGroup).not.toHaveBeenCalled();
  await act(async () => reading.resolve(f.read()));
  await waitFor(() => expect(f.client.setGroupPinned).toHaveBeenCalledOnce());
  expect(f.client.unmergeGroup).not.toHaveBeenCalled();
  expect(f.client.update).toHaveBeenCalledOnce();
});

test('navigation cannot hide a deferred member menu while its authoritative target read is pending', async () => {
  const f = await setup();
  const reading = deferred<LibraryItem[]>();
  await edit();
  f.client.list
    .mockResolvedValueOnce(f.read())
    .mockResolvedValueOnce(f.read())
    .mockReturnValueOnce(reading.promise);
  fireEvent.click(
    screen.getByRole('button', { name: 'Actions for Second member' }),
  );
  await waitFor(() => expect(f.client.list).toHaveBeenCalledTimes(4));
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  await act(async () => reading.resolve(f.read()));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
  expect(await screen.findByRole('dialog', { name: 'Edit clip' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Settings' })).toBeNull();
});

test('switching to a surviving member restores detail mode if the saved member disappears before reconciliation', async () => {
  const f = await setup();
  const save = deferred<Clip>();
  vi.mocked(f.client.update).mockReturnValueOnce(save.promise);
  await edit();
  fireEvent.click(
    screen.getByRole('button', { name: 'Edit content: Second member' }),
  );
  await waitFor(() => expect(f.client.update).toHaveBeenCalledOnce());
  f.replace([{ kind: 'clip', clip: f.second }]);
  await act(async () =>
    save.resolve({ ...f.first, content: 'Edited member content' }),
  );
  expect(
    await screen.findByRole('textbox', { name: 'Clip content' }),
  ).toHaveProperty('value', f.second.content);
  expect(f.safety.client.acquire).toHaveBeenCalledTimes(2);
});

test('menu reads and library refreshes preserve the group viewport and never refocus Back', async () => {
  const f = await setup();
  const viewport = document.querySelector(
    '.merged-clip-detail [data-slot="scroll-area-viewport"]',
  )!;
  const member = screen.getByRole('region', { name: 'Second member' });
  viewport.scrollTop = 420;
  const back = screen.getByRole('button', { name: 'Back to calendar' });
  const focus = vi.spyOn(back, 'focus');
  f.replace(
    f
      .read()
      .map((item) =>
        item.kind === 'group' ? { ...item, group: { ...item.group } } : item,
      ),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Actions for Second member' }),
  );
  await screen.findByRole('menuitem', { name: 'Edit' });
  expect(focus).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Edit' }), {
    key: 'Escape',
  });
  fireEvent.focus(window);
  await waitFor(() =>
    expect(f.client.list.mock.calls.length).toBeGreaterThanOrEqual(3),
  );
  expect(focus).not.toHaveBeenCalled();
  expect(
    document.querySelector(
      '.merged-clip-detail [data-slot="scroll-area-viewport"]',
    ),
  ).toBe(viewport);
  expect(screen.getByRole('region', { name: 'Second member' })).toBe(member);
  expect(viewport.scrollTop).toBe(420);
});

test('member inline start, save and cancellation use scroll-safe focus without refocusing Back', async () => {
  const f = await setup();
  const viewport = document.querySelector(
    '.merged-clip-detail [data-slot="scroll-area-viewport"]',
  )!;
  viewport.scrollTop = 420;
  const back = vi.spyOn(
    screen.getByRole('button', { name: 'Back to calendar' }),
    'focus',
  );
  const focus = vi.spyOn(HTMLTextAreaElement.prototype, 'focus');
  await edit('Second member');
  expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
  fireEvent.click(
    screen.getByRole('button', { name: 'Save changes: Second member' }),
  );
  await waitFor(() => expect(f.safety.client.release).toHaveBeenCalledOnce());
  expect(back).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Edit content: Second member' }),
    ),
  );
  await edit('Second member', 'Cancel this draft');
  fireEvent.keyDown(
    screen.getByRole('textbox', { name: 'Clip content: Second member' }),
    { key: 'Escape' },
  );
  await waitFor(() => expect(f.safety.client.release).toHaveBeenCalledTimes(2));
  expect(back).not.toHaveBeenCalled();
  expect(viewport.scrollTop).toBe(420);
  focus.mockRestore();
});

test('Copy All passes displayed IDs once, waits for saved content and does not navigate', async () => {
  const f = await setup();
  const save = deferred<Clip>();
  vi.mocked(f.client.update).mockReturnValueOnce(save.promise);
  await edit('Second member', 'Latest saved text');
  const copy = screen.getByRole('button', { name: 'Copy all clips' });
  fireEvent.click(copy);
  fireEvent.click(copy);
  await waitFor(() => expect(f.client.update).toHaveBeenCalledOnce());
  expect(f.client.copyContent).not.toHaveBeenCalled();
  await act(async () =>
    save.resolve({ ...f.second, content: 'Latest saved text' }),
  );
  await waitFor(() =>
    expect(f.client.copyContent).toHaveBeenCalledExactlyOnceWith('group', [
      'first',
      'second',
    ]),
  );
  expect(await screen.findByText('All clips copied.')).toBeTruthy();
  expect(screen.getByRole('heading', { name: f.group.title })).toBeTruthy();
});

test.each(['Copy all clips', 'Copy clip: First member'])(
  'failed save blocks %s, preserves the draft and allows a safe retry',
  async (action) => {
    const f = await setup();
    vi.mocked(f.client.update).mockRejectedValueOnce(new Error('save failed'));
    await edit();
    fireEvent.click(screen.getByRole('button', { name: action }));
    await screen.findByText(/Could not save content/);
    expect(f.client.copyContent).not.toHaveBeenCalled();
    expect(
      screen.getByRole('textbox', { name: 'Clip content: First member' }),
    ).toHaveProperty('value', 'Edited member content');
    fireEvent.click(screen.getByRole('button', { name: action }));
    await waitFor(() => expect(f.client.copyContent).toHaveBeenCalledOnce());
    expect(f.client.update).toHaveBeenCalledTimes(2);
  },
);

test('Copy All preserves displayed order and viewport through clipboard failure, single-flight retry and empty feedback', async () => {
  const f = await setup();
  f.replace([
    { kind: 'group', group: { ...f.group, members: [f.second, f.first] } },
  ]);
  fireEvent.focus(window);
  await waitFor(() =>
    expect(
      within(document.querySelector<HTMLElement>('.merged-clip-members')!)
        .getAllByRole('region')
        .map((node) => node.getAttribute('aria-label')),
    ).toEqual(['Second member', 'First member']),
  );
  const viewport = document.querySelector(
    '.merged-clip-detail [data-slot="scroll-area-viewport"]',
  )!;
  viewport.scrollTop = 420;
  const back = vi.spyOn(
    screen.getByRole('button', { name: 'Back to calendar' }),
    'focus',
  );
  f.client.copyContent.mockRejectedValueOnce({
    code: 'clipboard_unavailable',
    message: 'Could not copy clip content.',
  });
  const button = screen.getByRole<HTMLButtonElement>('button', {
    name: 'Copy all clips',
  });
  fireEvent.click(button);
  await screen.findByText(/Could not copy clip content\./);
  expect(f.client.copyContent).toHaveBeenCalledExactlyOnceWith('group', [
    'second',
    'first',
  ]);
  const pending = deferred<undefined>();
  f.client.copyContent.mockReturnValueOnce(pending.promise);
  fireEvent.click(button);
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(f.client.copyContent).toHaveBeenCalledTimes(2);
  await act(async () => pending.resolve(undefined));
  await screen.findByText('All clips copied.');
  f.client.copyContent.mockRejectedValueOnce({
    code: 'empty_content',
    message: 'This group has no content to copy.',
  });
  fireEvent.click(button);
  await screen.findByText(/This group has no content to copy\./);
  expect(back).not.toHaveBeenCalled();
  expect(viewport.scrollTop).toBe(420);
  expect(
    document.querySelector(
      '.merged-clip-detail [data-slot="scroll-area-viewport"]',
    ),
  ).toBe(viewport);
  expect(f.client.update).not.toHaveBeenCalled();
});

test('individual member copy saves first, copies only that member and preserves scroll on failure and retry', async () => {
  const f = await setup();
  const viewport = document.querySelector(
    '.merged-clip-detail [data-slot="scroll-area-viewport"]',
  )!;
  viewport.scrollTop = 420;
  const back = vi.spyOn(
    screen.getByRole('button', { name: 'Back to calendar' }),
    'focus',
  );
  f.client.copyContent.mockRejectedValueOnce({
    code: 'clipboard_unavailable',
    message: 'Could not copy clip content.',
  });
  await edit('Second member');
  fireEvent.click(
    screen.getByRole('button', { name: 'Copy clip: Second member' }),
  );
  await screen.findByText(/Could not copy clip content\./);
  expect(f.client.update).toHaveBeenCalledOnce();
  expect(f.client.copyContent).toHaveBeenCalledExactlyOnceWith('second');
  expect(back).not.toHaveBeenCalled();
  expect(viewport.scrollTop).toBe(420);
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(
    screen.getByRole('button', { name: 'Copy clip: Second member' }),
  );
  await screen.findByText('Clip copied.');
  expect(f.client.copyContent).toHaveBeenCalledTimes(2);
  expect(
    screen.queryByRole('textbox', { name: 'Clip content: Second member' }),
  ).toBeNull();
});

test.each(['unmerge', 'delete'] as const)(
  'removing a focused member by %s focuses a surviving member without scrolling to Back',
  async (action) => {
    const f = await setup();
    const third = { ...f.second, id: 'third', title: 'Third member' };
    f.replace([
      {
        kind: 'group',
        group: { ...f.group, members: [f.first, f.second, third] },
      },
    ]);
    fireEvent.focus(window);
    const member = await screen.findByRole('region', { name: 'Second member' });
    const viewport = document.querySelector(
      '.merged-clip-detail [data-slot="scroll-area-viewport"]',
    )!;
    viewport.scrollTop = 420;
    const back = vi.spyOn(
      screen.getByRole('button', { name: 'Back to calendar' }),
      'focus',
    );
    const removing = deferred<undefined>();
    const remove = async () => {
      await removing.promise;
      f.replace([
        { kind: 'group', group: { ...f.group, members: [f.first, third] } },
      ]);
      return undefined;
    };
    f.client.unmergeMember.mockImplementationOnce(remove);
    f.client.deleteGroupMember.mockImplementationOnce(remove);
    const trigger = within(member).getByRole('button', {
      name: 'Actions for Second member',
    });
    act(() => trigger.focus());
    fireEvent.click(trigger);
    const item = await screen.findByRole('menuitem', {
      name: action === 'unmerge' ? 'Unmerge' : 'Delete',
    });
    act(() => item.focus());
    fireEvent.click(item);
    if (action === 'delete') {
      const dialog = await screen.findByRole('alertdialog');
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Delete clip' }),
      );
    }
    await waitFor(() => expect(trigger).toHaveProperty('disabled', true));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await act(async () => removing.resolve(undefined));
    await waitFor(() =>
      expect(
        screen.queryByRole('region', { name: 'Second member' }),
      ).toBeNull(),
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Third member' })).getByRole(
          'button',
          { name: 'Copy clip: Third member' },
        ),
      ).toBe(document.activeElement),
    );
    expect(back).not.toHaveBeenCalled();
    expect(viewport.scrollTop).toBe(420);
  },
);

test('delayed post-save reconciliation returns focus to the member action after controls become enabled', async () => {
  const f = await setup();
  const reading = deferred<LibraryItem[]>();
  f.client.list
    .mockImplementationOnce(async () => f.read())
    .mockReturnValueOnce(reading.promise);
  await edit('Second member');
  fireEvent.click(
    screen.getByRole('button', { name: 'Save changes: Second member' }),
  );
  const action = await screen.findByRole('button', {
    name: 'Edit content: Second member',
  });
  await waitFor(() => expect(action).toHaveProperty('disabled', true));
  await act(async () => reading.resolve(f.read()));
  await waitFor(() => expect(action).toBe(document.activeElement));
});

test('Copy All waits for lease release and retries failed cleanup without rewriting saved content', async () => {
  const f = await setup();
  const releasing = deferred<void>();
  vi.mocked(f.safety.client.release)
    .mockReturnValueOnce(releasing.promise)
    .mockRejectedValueOnce(new Error('cleanup acknowledgement lost'));
  await edit();
  fireEvent.click(screen.getByRole('button', { name: 'Copy all clips' }));
  await waitFor(() => expect(f.safety.client.release).toHaveBeenCalledOnce());
  expect(f.client.copyContent).not.toHaveBeenCalled();
  await act(async () => releasing.resolve());
  await waitFor(() => expect(f.client.copyContent).toHaveBeenCalledOnce());

  await edit('Second member');
  fireEvent.click(screen.getByRole('button', { name: 'Copy all clips' }));
  await screen.findByText(/Content saved, but safety cleanup failed/);
  expect(f.client.copyContent).toHaveBeenCalledOnce();
  expect(f.client.update).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: 'Copy all clips' }));
  await waitFor(() => expect(f.client.copyContent).toHaveBeenCalledTimes(2));
  expect(f.client.update).toHaveBeenCalledTimes(2);
});
