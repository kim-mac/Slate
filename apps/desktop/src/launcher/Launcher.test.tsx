import type {
  Clip,
  ClipGroup,
  ClipInput,
  LibraryItem,
} from '@ai-clip-memory/shared';
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
import { libraryItemPreview, replaceLibraryClip } from '../lib/libraryItems';

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
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(initialClips: Array<Clip | LibraryItem> = [older, newer]) {
  let stored: LibraryItem[] = initialClips.map((item) =>
    'kind' in item ? item : { kind: 'clip', clip: item },
  );
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
    list: vi.fn().mockImplementation(async () => stored),
    create: vi.fn(async () => {
      const saved: Clip = {
        ...newer,
        id: 'created',
        title: null,
        content: 'Created locally',
        contentType: 'text' as const,
        sourceApp: null,
        sourceUrl: null,
        sourcePageTitle: null,
      };
      stored = [{ kind: 'clip', clip: saved }, ...stored];
      return saved;
    }),
    update: vi.fn(async (id: string, input: ClipInput) => {
      const saved = { ...newer, ...input, id };
      stored = replaceLibraryClip(stored, saved);
      return saved;
    }),
    delete: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
    copyContent: vi
      .fn<(id: string) => Promise<void>>()
      .mockResolvedValue(undefined),
    openSource: vi
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
  vi.useRealTimers();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

function previewGroup(
  members = [newer, older],
  title = 'Learning notes',
): ClipGroup {
  return {
    id: 'preview-group',
    title,
    members,
    isPinned: false,
    createdAt: newer.createdAt,
    updatedAt: newer.updatedAt,
  };
}

test.each(['mouse', 'Enter'] as const)(
  'group entry by %s deliberately focuses Back without scrolling',
  async (method) => {
    setup([{ kind: 'group', group: previewGroup() }]);
    const result = await screen.findByRole('option', {
      name: /Learning notes/,
    });
    const focus = vi.spyOn(HTMLButtonElement.prototype, 'focus');
    if (method === 'mouse') fireEvent.click(result);
    else {
      fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'ArrowDown' });
      fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
    }
    const back = await screen.findByRole('button', { name: 'Back to search' });
    await waitFor(() => expect(document.activeElement).toBe(back));
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
    fireEvent.keyDown(back, { key: 'Escape' });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('searchbox')),
    );
    focus.mockRestore();
  },
);

test('single-clicking a group opens the same member view as Enter without copying or hiding', async () => {
  const group = previewGroup();
  const { client, host } = setup([{ kind: 'group', group }]);
  fireEvent.click(
    await screen.findByRole('option', { name: /Learning notes/ }),
  );
  expect(
    await screen.findByRole('heading', { name: group.title }),
  ).toBeTruthy();
  expect(client.copyContent).not.toHaveBeenCalled();
  expect(host.hide).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Back to search' }));
  const search = await screen.findByRole('searchbox');
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(
    await screen.findByRole('heading', { name: group.title }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Copy Recent note' }));
  await waitFor(() =>
    expect(client.copyContent).toHaveBeenCalledExactlyOnceWith('newer'),
  );
  expect(screen.getByRole('heading', { name: group.title })).toBeTruthy();
});

test('group results show authoritative title, normalized member preview and all-member count without sidebar changes', async () => {
  const group = previewGroup(
    [
      { ...newer, content: '  Gradient\n descent  ' },
      { ...older, content: 'Regression\t example' },
      { ...older, id: 'duplicate', content: 'Gradient descent' },
      { ...older, id: 'empty', content: '  ' },
    ],
    'Python Learning Notes',
  );
  setup([{ kind: 'group', group }]);
  const result = await screen.findByRole('option', {
    name: /Python Learning Notes/,
  });
  expect(
    within(result).getByText('Gradient descent · Regression example'),
  ).toBeTruthy();
  expect(within(result).getByText('4 clips · Text')).toBeTruthy();
  expect(
    result.querySelector('.launcher-preview')?.getAttribute('tabindex'),
  ).toBeNull();
  expect(libraryItemPreview({ kind: 'group', group })).toBe('4 clips');
});

test('a group that disappears or stops matching clears stale selection instead of selecting another result', async () => {
  vi.useFakeTimers();
  const group = previewGroup();
  const { client } = setup([{ kind: 'group', group }]);
  await act(async () => vi.advanceTimersByTimeAsync(0));
  const search = screen.getByRole('searchbox');
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  expect(search.getAttribute('aria-activedescendant')).toBe(
    'result-preview-group',
  );
  client.list.mockResolvedValue([{ kind: 'clip', clip: older }]);
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(
    screen
      .getByRole('option', { name: /Older note/ })
      .getAttribute('aria-selected'),
  ).toBe('false');
  expect(search.getAttribute('aria-activedescendant')).toBeNull();
  client.list.mockResolvedValue([{ kind: 'group', group }]);
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(
    screen
      .getByRole('option', { name: /Learning notes/ })
      .getAttribute('aria-selected'),
  ).toBe('false');
  expect(search.getAttribute('aria-activedescendant')).toBeNull();
});

test('group refresh preserves row identity, focus, query and selection while refreshing title, previews and counts', async () => {
  vi.useFakeTimers();
  const group = previewGroup();
  const { client } = setup([{ kind: 'group', group }]);
  await act(async () => vi.advanceTimersByTimeAsync(0));
  const search = screen.getByRole('searchbox');
  fireEvent.change(search, { target: { value: 'notes' } });
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  search.focus();
  const row = screen.getByRole('option', { name: /Learning notes/ });
  const appended = { ...older, id: 'appended', content: 'Model evaluation' };
  const snapshots = [
    { ...group, title: 'Renamed notes' },
    { ...group, title: 'Renamed notes', members: [...group.members, appended] },
    {
      ...group,
      title: 'Renamed notes',
      members: [
        { ...newer, content: 'Edited member content' },
        older,
        appended,
      ],
    },
    { ...group, title: 'Renamed notes', members: [older, appended] },
  ];
  for (const current of snapshots) {
    client.list.mockResolvedValue([{ kind: 'group', group: current }]);
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(screen.getByRole('option', { name: /Renamed notes/ })).toBe(row);
    expect(row.getAttribute('aria-selected')).toBe('true');
    expect(row.querySelector('.launcher-meta')?.textContent).toBe(
      `${current.members.length} clips · Text`,
    );
    expect(row.querySelector('.launcher-preview')?.textContent).toContain(
      current.members[0]!.content,
    );
    expect(search).toHaveProperty('value', 'notes');
    expect(search.getAttribute('aria-activedescendant')).toBe(
      'result-preview-group',
    );
    expect(document.activeElement).toBe(search);
  }
});

test('a group renamed out of a query loses selection without selecting a matching neighbor', async () => {
  vi.useFakeTimers();
  const group = previewGroup([
    { ...newer, content: 'Alpha' },
    { ...older, content: 'Beta' },
  ]);
  const { client } = setup([{ kind: 'group', group }, older]);
  await act(async () => vi.advanceTimersByTimeAsync(0));
  const search = screen.getByRole('searchbox');
  fireEvent.change(search, { target: { value: 'notes' } });
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  client.list.mockResolvedValue([
    { kind: 'group', group: { ...group, title: 'Renamed collection' } },
    { kind: 'clip', clip: older },
  ]);
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(screen.getAllByRole('option')).toHaveLength(1);
  expect(screen.getByRole('option').getAttribute('aria-selected')).toBe(
    'false',
  );
  client.list.mockResolvedValue([
    { kind: 'group', group },
    { kind: 'clip', clip: older },
  ]);
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(
    screen
      .getByRole('option', { name: /Learning notes/ })
      .getAttribute('aria-selected'),
  ).toBe('false');
  expect(search).toHaveProperty('value', 'notes');
});

test('unmerge and dissolution clear the selected group and do not select a surviving clip', async () => {
  vi.useFakeTimers();
  const group = previewGroup();
  const { client } = setup([{ kind: 'group', group }]);
  await act(async () => vi.advanceTimersByTimeAsync(0));
  const search = screen.getByRole('searchbox');
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  client.list.mockResolvedValue([
    { kind: 'clip', clip: newer },
    { kind: 'clip', clip: older },
  ]);
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(search.getAttribute('aria-activedescendant')).toBeNull();
  expect(
    screen
      .getAllByRole('option')
      .every((row) => row.getAttribute('aria-selected') === 'false'),
  ).toBe(true);
});

test('open group refresh shows member edits and removals, then preserves unavailable and Back on dissolution', async () => {
  vi.useFakeTimers();
  const group = previewGroup();
  const { client } = setup([{ kind: 'group', group }]);
  await act(async () => vi.advanceTimersByTimeAsync(0));
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'ArrowDown' });
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
  const appended = {
    ...older,
    id: 'appended',
    title: 'Added member',
    content: 'Added content',
  };
  client.list.mockResolvedValue([
    {
      kind: 'group',
      group: {
        ...group,
        title: 'Fresh title',
        members: [{ ...newer, content: 'Edited content' }, appended],
      },
    },
  ]);
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(screen.getByRole('heading', { name: 'Fresh title' })).toBeTruthy();
  expect(screen.getByText('Edited content')).toBeTruthy();
  expect(screen.getByText('Added content')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Copy Older note' })).toBeNull();
  client.list.mockResolvedValue([{ kind: 'clip', clip: newer }]);
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(
    screen.getByText('This merged clip is no longer available.'),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(
    screen
      .getByRole('option', { name: /Recent note/ })
      .getAttribute('aria-selected'),
  ).toBe('false');
});

test.each(['Learning notes', 'Recent note', 'TypeScript', 'ChatGPT'])(
  'group preview preserves existing search for %s',
  async (query) => {
    const group = previewGroup();
    setup([{ kind: 'group', group }]);
    await screen.findByRole('option', { name: /Learning notes/ });
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: query },
    });
    expect(screen.getByRole('option', { name: /Learning notes/ })).toBeTruthy();
  },
);

test('Enter opens a group and member Copy passes only the original clip ID, never the preview', async () => {
  const original = '  Full raw\n' + '👨‍👩‍👧‍👦'.repeat(90) + '\nEnd of member  ';
  const member = { ...newer, content: original };
  const group = previewGroup([member, older]);
  const { client } = setup([{ kind: 'group', group }]);
  const row = await screen.findByRole('option', { name: /Learning notes/ });
  expect(row.querySelector('.launcher-preview')?.textContent).not.toBe(
    original,
  );
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'ArrowDown' });
  expect(screen.queryByRole('button', { name: 'Copy clip' })).toBeNull();
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
  expect(client.copyContent).not.toHaveBeenCalled();
  expect(
    screen.getByText(original, { normalizer: (text) => text }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Copy Recent note' }));
  await waitFor(() =>
    expect(client.copyContent).toHaveBeenCalledExactlyOnceWith(member.id),
  );
  expect(member.content).toBe(original);
});

test.each(['create', 'edit'])(
  'group refresh remains paused while a Quick Search %s draft is active',
  async (kind) => {
    vi.useFakeTimers();
    const group = previewGroup();
    const { client } = setup([{ kind: 'group', group }, older]);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    if (kind === 'create') {
      await act(async () =>
        fireEvent.click(screen.getByRole('button', { name: 'New clip' })),
      );
    } else {
      const search = screen.getByRole('searchbox');
      fireEvent.keyDown(search, { key: 'ArrowDown' });
      fireEvent.keyDown(search, { key: 'ArrowDown' });
      await act(async () =>
        fireEvent.click(
          screen.getByRole('button', { name: 'Edit selected clip' }),
        ),
      );
    }
    const input = screen.getByRole('textbox', { name: 'Content' });
    fireEvent.change(input, { target: { value: 'Preserved editor draft' } });
    client.list.mockResolvedValue([
      { kind: 'group', group: { ...group, title: 'Externally renamed' } },
    ]);
    await act(async () => vi.advanceTimersByTimeAsync(6_000));
    expect(client.list).toHaveBeenCalledOnce();
    expect(screen.getByRole('textbox', { name: 'Content' })).toBe(input);
    expect(input).toHaveProperty('value', 'Preserved editor draft');
    expect(client.update).not.toHaveBeenCalled();
    expect(client.create).not.toHaveBeenCalled();
  },
);

test('a merged result opens its member view and provides retrieval actions without management controls', async () => {
  const group: ClipGroup = {
    id: 'group-one',
    title: 'Merged research',
    isPinned: false,
    createdAt: '2026-09-03T00:00:00Z',
    updatedAt: '2026-09-03T00:00:00Z',
    members: [newer, older],
  };
  const { client } = setup([{ kind: 'group', group }]);
  await screen.findByRole('option', { name: /Merged research/ });
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'ArrowDown' });
  expect(screen.queryByRole('button', { name: 'Copy clip' })).toBeNull();
  expect(screen.getByText(/Enter Open/)).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
  expect(screen.getByRole('heading', { name: 'Merged research' })).toBeTruthy();
  expect(screen.getByText('TypeScript guide')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /Unmerge/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Copy Recent note' }));
  await waitFor(() =>
    expect(client.copyContent).toHaveBeenCalledWith(newer.id),
  );
});

test('merged member retrieval failures remain visible in the expanded view', async () => {
  const sourced = {
    ...newer,
    sourceUrl: 'https://example.com/source',
  };
  const group: ClipGroup = {
    id: 'group-one',
    title: 'Merged research',
    isPinned: false,
    createdAt: '2026-09-03T00:00:00Z',
    updatedAt: '2026-09-03T00:00:00Z',
    members: [sourced, older],
  };
  const { client } = setup([{ kind: 'group', group }]);
  client.openSource.mockRejectedValueOnce(new Error('private failure'));
  await screen.findByRole('option', { name: /Merged research/ });
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'ArrowDown' });
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });

  fireEvent.click(
    screen.getByRole('button', { name: 'Open source for Recent note' }),
  );

  expect((await screen.findByRole('alert')).textContent).toContain(
    'Clip source could not be opened.',
  );
  expect(screen.queryByText('private failure')).toBeNull();
});

test('merged result search matches member fields and Escape returns to preserved search', async () => {
  const group: ClipGroup = {
    id: 'group-one',
    title: 'Merged clips',
    isPinned: false,
    createdAt: '2026-09-03T00:00:00Z',
    updatedAt: '2026-09-03T00:00:00Z',
    members: [newer, older],
  };
  setup([{ kind: 'group', group }]);
  const search = await screen.findByRole('searchbox');
  fireEvent.change(search, { target: { value: 'TypeScript' } });
  expect(
    await screen.findByRole('option', { name: /Merged clips/ }),
  ).toBeTruthy();
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  fireEvent.keyDown(search, { key: 'Enter' });
  fireEvent.keyDown(screen.getByRole('main'), { key: 'Escape' });
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe(
    'TypeScript',
  );
});

test('silently discovers an external clip while the same launcher session stays visible', async () => {
  const captured = { ...newer, id: 'external', title: 'External capture' };
  vi.useFakeTimers();
  const { client } = setup();
  await act(async () => vi.advanceTimersByTimeAsync(0));
  const search = screen.getByRole('searchbox');
  screen.getByRole('option', { name: /Recent note/ });
  fireEvent.change(search, { target: { value: 'capture' } });
  client.list.mockResolvedValue([captured, older, newer]);

  await act(async () => vi.advanceTimersByTimeAsync(2_000));

  expect(client.list).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('option', { name: /External capture/ })).toBeTruthy();
  expect((search as HTMLInputElement).value).toBe('capture');
  expect(screen.queryByText('Loading clips…')).toBeNull();
});

test('refocusing an existing session silently refreshes without changing query, selection or feedback', async () => {
  const { client, emit } = setup();
  const search = await screen.findByRole('searchbox');
  await screen.findByRole('option', { name: /Recent note/ });
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  fireEvent.keyDown(search, { key: 'Enter' });
  await screen.findByText('Copied');
  fireEvent.change(search, { target: { value: 'note' } });
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  const external = { ...older, id: 'external', title: 'External note' };
  client.list.mockResolvedValue([external, older, newer]);

  emit({ session: 1, visible: true });

  await screen.findByRole('option', { name: /External note/ });
  expect(client.list).toHaveBeenCalledTimes(2);
  expect(search).toHaveProperty('value', 'note');
  expect(
    screen
      .getByRole('option', { name: /Recent note/ })
      .getAttribute('aria-selected'),
  ).toBe('true');
  expect(screen.getByText('Copied')).toBeTruthy();
  expect(screen.queryByText('Loading clips…')).toBeNull();
});

test('existing visible refresh updates a read-only group title without restarting Quick Search', async () => {
  vi.useFakeTimers();
  const group: ClipGroup = {
    id: 'group',
    title: 'Original group',
    members: [older, newer],
    isPinned: false,
    createdAt: newer.createdAt,
    updatedAt: newer.updatedAt,
  };
  const { client } = setup([{ kind: 'group', group }]);
  await act(async () => vi.advanceTimersByTimeAsync(0));
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'ArrowDown' });
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
  expect(screen.getByRole('heading', { name: 'Original group' })).toBeTruthy();
  client.list.mockResolvedValue([
    { kind: 'group', group: { ...group, title: 'Renamed elsewhere' } },
  ]);
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(
    screen.getByRole('heading', { name: 'Renamed elsewhere' }),
  ).toBeTruthy();
});

test('visible polling stops on hide and does not overlap an unfinished read', async () => {
  vi.useFakeTimers();
  const { client, emit } = setup();
  await act(async () => vi.advanceTimersByTimeAsync(0));
  const pending = deferred<Clip[]>();
  client.list.mockReturnValueOnce(pending.promise);

  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(client.list).toHaveBeenCalledTimes(2);
  await act(async () => vi.advanceTimersByTimeAsync(4_000));
  expect(client.list).toHaveBeenCalledTimes(2);

  emit({ session: 1, visible: false });
  await act(async () => pending.resolve([older, newer]));
  await act(async () => vi.advanceTimersByTimeAsync(6_000));
  expect(client.list).toHaveBeenCalledTimes(2);
});

test('polling pauses in Create and Edit without clearing their unsaved drafts', async () => {
  vi.useFakeTimers();
  const { client } = setup();
  await act(async () => vi.advanceTimersByTimeAsync(0));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'New clip' }));
  });
  let content = screen.getByRole('textbox', { name: 'Content' });
  fireEvent.change(content, { target: { value: 'Unsaved create draft' } });
  await act(async () => vi.advanceTimersByTimeAsync(6_000));
  expect(client.list).toHaveBeenCalledTimes(1);
  expect(content).toHaveProperty('value', 'Unsaved create draft');

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  });
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'ArrowDown' });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Edit selected clip' }));
  });
  content = screen.getByRole('textbox', { name: 'Content' });
  fireEvent.change(content, { target: { value: 'Unsaved edit draft' } });
  await act(async () => vi.advanceTimersByTimeAsync(6_000));
  expect(client.list).toHaveBeenCalledTimes(1);
  expect(content).toHaveProperty('value', 'Unsaved edit draft');
});

test('an old poll cannot erase a locally created clip', async () => {
  vi.useFakeTimers();
  const { client } = setup();
  await act(async () => vi.advanceTimersByTimeAsync(0));
  const stale = deferred<Clip[]>();
  client.list.mockReturnValueOnce(stale.promise);
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'New clip' }));
  });
  const content = screen.getByRole('textbox', { name: 'Content' });
  fireEvent.change(content, { target: { value: 'Created locally' } });
  fireEvent.keyDown(content, { key: 'Enter', ctrlKey: true });
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByRole('option', { name: /Created locally/ })).toBeTruthy();

  await act(async () => stale.resolve([older, newer]));
  expect(screen.getByRole('option', { name: /Created locally/ })).toBeTruthy();
});

test('an old poll cannot restore the pre-edit version', async () => {
  vi.useFakeTimers();
  const { client } = setup();
  await act(async () => vi.advanceTimersByTimeAsync(0));
  const stale = deferred<Clip[]>();
  client.list.mockReturnValueOnce(stale.promise);
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'ArrowDown' });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Edit selected clip' }));
  });
  const content = screen.getByRole('textbox', { name: 'Content' });
  fireEvent.change(content, { target: { value: 'Updated guide' } });
  fireEvent.keyDown(content, { key: 'Enter', ctrlKey: true });
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByText('Updated guide')).toBeTruthy();

  await act(async () => stale.resolve([older, newer]));
  expect(screen.getByText('Updated guide')).toBeTruthy();
  expect(screen.queryByText('TypeScript guide')).toBeNull();
});

test('an old poll cannot resurrect a locally deleted clip', async () => {
  vi.useFakeTimers();
  const { client } = setup();
  await act(async () => vi.advanceTimersByTimeAsync(0));
  const stale = deferred<Clip[]>();
  client.list.mockReturnValueOnce(stale.promise);
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'ArrowDown' });
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete selected clip' }),
    );
  });
  fireEvent.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Delete',
    }),
  );
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(screen.queryByRole('option', { name: /Recent note/ })).toBeNull();

  await act(async () => stale.resolve([older, newer]));
  expect(screen.queryByRole('option', { name: /Recent note/ })).toBeNull();
});

test('a poll from a hidden session cannot overwrite the next session', async () => {
  vi.useFakeTimers();
  const { client, emit } = setup();
  await act(async () => vi.advanceTimersByTimeAsync(0));
  const stale = deferred<Clip[]>();
  client.list.mockReturnValueOnce(stale.promise);
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  const replacement = { ...newer, id: 'replacement', title: 'Next session' };
  client.list.mockResolvedValueOnce([replacement]);
  emit({ session: 1, visible: false });
  emit({ session: 2, visible: true });
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByRole('option', { name: /Next session/ })).toBeTruthy();

  await act(async () => stale.resolve([older, newer]));
  expect(screen.getByRole('option', { name: /Next session/ })).toBeTruthy();
  expect(screen.queryByRole('option', { name: /Recent note/ })).toBeNull();
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

test('limits dragging to the header and opens Slate through the launcher host', async () => {
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

  fireEvent.click(screen.getByRole('button', { name: 'Open Slate' }));
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
  await screen.findByRole('option', { name: /Recent note/ });
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
  const content = await screen.findByRole('textbox', { name: 'Content' });
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

test.each(['create', 'edit'] as const)(
  'Quick Search %s retains focused submitted fields while pending and unlocks after failure',
  async (mode) => {
    const { client } = setup();
    await screen.findByRole('option', { name: /Recent note/ });
    if (mode === 'edit') {
      fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'ArrowDown' });
      fireEvent.click(
        screen.getByRole('button', { name: 'Edit selected clip' }),
      );
    } else fireEvent.click(screen.getByRole('button', { name: 'New clip' }));
    const content = await screen.findByRole<HTMLTextAreaElement>('textbox', {
      name: 'Content',
    });
    fireEvent.change(content, { target: { value: 'Submitted draft' } });
    act(() => {
      content.focus();
      content.setSelectionRange(1, 5);
    });
    let fail!: (error: Error) => void;
    const write = mode === 'create' ? client.create : client.update;
    write.mockReturnValueOnce(
      new Promise((_, reject) => {
        fail = reject;
      }),
    );
    fireEvent.keyDown(content, { key: 'Enter', ctrlKey: true });
    expect(content.readOnly).toBe(true);
    expect(content.disabled).toBe(false);
    expect(document.activeElement).toBe(content);
    expect([content.selectionStart, content.selectionEnd]).toEqual([1, 5]);
    expect(screen.getByRole('combobox')).toHaveProperty('disabled', true);
    fireEvent.change(content, { target: { value: 'Changed during save' } });
    expect(content.value).toBe('Submitted draft');
    fireEvent.keyDown(content, { key: 'Enter', ctrlKey: true, repeat: true });
    await waitFor(() => expect(write).toHaveBeenCalledOnce());
    await act(async () => fail(new Error('synthetic failure')));
    await screen.findByRole('alert');
    expect(content.readOnly).toBe(false);
    expect(content.value).toBe('Submitted draft');
    expect(screen.getByRole('combobox')).toHaveProperty('disabled', false);
    fireEvent.change(content, { target: { value: 'Retry draft' } });
    fireEvent.keyDown(content, { key: 'Enter', ctrlKey: true });
    await screen.findByRole('searchbox');
    expect(write).toHaveBeenCalledTimes(2);
  },
);
test('creates through the existing client, clears search, and selects the local result', async () => {
  const { client, host } = setup();
  const search = await screen.findByRole('searchbox');
  fireEvent.change(search, { target: { value: 'guide' } });
  fireEvent.click(screen.getByRole('button', { name: 'New clip' }));
  const content = await screen.findByRole('textbox', { name: 'Content' });
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
  const content = await screen.findByRole('textbox', { name: 'Content' });
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
  let content = await screen.findByRole('textbox', { name: 'Content' });
  fireEvent.change(content, { target: { value: 'Discard me' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await screen.findByRole('searchbox');
  fireEvent.click(screen.getByRole('button', { name: 'New clip' }));
  content = await screen.findByRole('textbox', { name: 'Content' });
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
  const content = await screen.findByRole('textbox', { name: 'Content' });
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
  expect(client.list).toHaveBeenCalledTimes(3);
  expect(screen.getByText('Saved')).toBeTruthy();
  expect(screen.getByText('Updated guide')).toBeTruthy();
  expect(
    screen
      .getByRole('option', { name: /Recent note/ })
      .getAttribute('aria-selected'),
  ).toBe('true');
});
test('an active edit resolves its clip ID after an external capture groups the member', async () => {
  const { client } = setup();
  const search = await screen.findByRole('searchbox');
  await screen.findAllByRole('option');
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  fireEvent.click(screen.getByRole('button', { name: 'Edit selected clip' }));
  const content = await screen.findByRole('textbox', { name: 'Content' });
  const group: ClipGroup = {
    id: 'external-auto-group',
    title: 'Stable group title',
    isPinned: true,
    createdAt: newer.createdAt,
    updatedAt: newer.createdAt,
    members: [newer, older],
  };
  client.list.mockResolvedValue([{ kind: 'group', group }]);
  fireEvent.change(content, { target: { value: 'Saved inside group' } });
  fireEvent.keyDown(content, { key: 'Enter', ctrlKey: true });
  await waitFor(() =>
    expect(client.update).toHaveBeenCalledWith(newer.id, {
      content: 'Saved inside group',
      contentType: newer.contentType,
      title: newer.title,
      sourceApp: newer.sourceApp,
      sourceUrl: newer.sourceUrl,
      sourcePageTitle: newer.sourcePageTitle,
    }),
  );
  await screen.findByText('Saved');
  expect(screen.getByRole('option', { selected: true }).textContent).toContain(
    group.title,
  );
  expect(screen.queryByRole('option', { name: /Recent note/ })).toBeNull();
});

test('shows isolated Copy, Edit and Delete actions for only the selected result', async () => {
  const { client } = setup();
  const search = await screen.findByRole('searchbox');
  const options = await screen.findAllByRole('option');
  fireEvent.keyDown(search, { key: 'ArrowDown' });

  const selected = options[0]!;
  const unselected = options[1]!;
  const edit = within(selected).getByRole('button', {
    name: 'Edit selected clip',
  });
  const remove = within(selected).getByRole('button', {
    name: 'Delete selected clip',
  });
  const titleRow = edit.closest('.launcher-title-row');
  expect(titleRow).not.toBeNull();
  expect(within(titleRow as HTMLElement).getByText('Recent note')).toBeTruthy();
  expect(
    within(titleRow as HTMLElement)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label')),
  ).toEqual(['Copy clip', 'Edit selected clip', 'Delete selected clip']);
  expect(
    within(unselected).queryByRole('button', { name: 'Copy clip' }),
  ).toBeNull();
  expect(
    within(unselected).queryByRole('button', { name: 'Edit selected clip' }),
  ).toBeNull();
  expect(
    within(unselected).queryByRole('button', {
      name: 'Delete selected clip',
    }),
  ).toBeNull();

  fireEvent.focus(remove);
  expect(await screen.findByText('Delete clip')).toBeTruthy();

  fireEvent.mouseDown(remove);
  fireEvent.click(remove);
  expect(client.copyContent).not.toHaveBeenCalled();
  expect(client.delete).not.toHaveBeenCalled();
  expect(selected.getAttribute('aria-selected')).toBe('true');
  const confirmation = await screen.findByRole('alertdialog', {
    name: 'Delete this clip?',
  });
  expect(confirmation.textContent).toContain(
    'This clip will be permanently deleted.',
  );
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(remove));

  fireEvent.mouseDown(edit);
  fireEvent.click(edit);
  expect(client.copyContent).not.toHaveBeenCalled();
  expect(client.delete).not.toHaveBeenCalled();
  expect(await screen.findByRole('form', { name: 'Edit clip' })).toBeTruthy();
});

test('a committed Quick Search Create recovers a failed refresh without saving twice', async () => {
  const { client, host } = setup();
  await screen.findAllByRole('option');
  fireEvent.click(screen.getByRole('button', { name: 'New clip' }));
  const content = await screen.findByRole('textbox', { name: 'Content' });
  fireEvent.change(content, { target: { value: 'Created locally' } });
  client.list.mockRejectedValueOnce(new Error('private SQL refresh failure'));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('Saved')).toBeTruthy();
  expect(screen.queryByRole('form', { name: 'Create clip' })).toBeNull();
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Clip saved, but the library could not refresh.',
  );
  expect(screen.getByRole('alert').textContent).not.toContain('private SQL');
  expect(client.create).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh clips' }));
  await screen.findByRole('option', { name: /Created locally/ });
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(client.create).toHaveBeenCalledOnce();
  expect(client.update).not.toHaveBeenCalled();
  expect(host.hide).not.toHaveBeenCalled();
});

test('Copy clip uses the Enter copy operation once without changing selection or focus', async () => {
  const { client, host } = setup();
  const search = await screen.findByRole('searchbox');
  await screen.findAllByRole('option');
  expect(screen.queryByRole('button', { name: 'Copy clip' })).toBeNull();
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  const selected = screen.getByRole('option', { selected: true });
  const copyButton = within(selected).getByRole('button', {
    name: 'Copy clip',
  });
  // Let the existing startup focus frame finish before interacting.
  await act(
    async () =>
      new Promise<void>((done) => requestAnimationFrame(() => done())),
  );
  copyButton.focus();
  fireEvent.mouseDown(copyButton);
  fireEvent.click(copyButton);
  await screen.findByText('Copied');
  expect(client.copyContent.mock.calls).toEqual([['newer']]);
  expect(document.activeElement).toBe(copyButton);
  expect(selected.getAttribute('aria-selected')).toBe('true');
  expect(host.hide).not.toHaveBeenCalled();
  expect(host.openTin).not.toHaveBeenCalled();
  expect(client.update).not.toHaveBeenCalled();
  expect(client.delete).not.toHaveBeenCalled();

  search.focus();
  fireEvent.keyDown(search, { key: 'Enter' });
  await waitFor(() =>
    expect(client.copyContent.mock.calls).toEqual([['newer'], ['newer']]),
  );
});

test('Copy clip retains the native button keyboard and tooltip contract', async () => {
  const { client } = setup();
  const search = await screen.findByRole('searchbox');
  await screen.findAllByRole('option');
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  const copyButton = screen.getByRole('button', { name: 'Copy clip' });
  expect(copyButton.tagName).toBe('BUTTON');
  expect(copyButton.getAttribute('type')).toBe('button');
  expect(copyButton.tabIndex).toBe(0);
  await act(
    async () =>
      new Promise<void>((done) => requestAnimationFrame(() => done())),
  );
  copyButton.focus();
  fireEvent.focus(copyButton);
  expect((await screen.findByText('Copy clip')).getAttribute('data-slot')).toBe(
    'tooltip-content',
  );
  expect(document.activeElement).toBe(copyButton);
  // JSDOM does not synthesize a native click from Enter. Verify the key stays
  // unhandled, then dispatch that click and assert there was no second pathway.
  expect(fireEvent.keyDown(copyButton, { key: 'Enter' })).toBe(true);
  expect(client.copyContent).not.toHaveBeenCalled();
  fireEvent.click(copyButton, { detail: 0 });
  await screen.findByText('Copied');
  expect(client.copyContent.mock.calls).toEqual([['newer']]);
});

test('Copy clip and Enter share one in-flight operation and re-enable after completion', async () => {
  const { client } = setup();
  const search = await screen.findByRole('searchbox');
  await screen.findAllByRole('option');
  const pending = deferred<void>();
  client.copyContent.mockReturnValueOnce(pending.promise);
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  const copyButton = screen.getByRole('button', { name: 'Copy clip' });
  fireEvent.click(copyButton);
  expect(copyButton).toHaveProperty('disabled', true);
  fireEvent.click(copyButton);
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(client.copyContent.mock.calls).toEqual([['newer']]);
  await act(async () => pending.resolve());
  expect(copyButton).toHaveProperty('disabled', false);
  fireEvent.click(copyButton);
  await waitFor(() => expect(client.copyContent).toHaveBeenCalledTimes(2));
});

test('Copy clip failures use the existing sanitized error and retry behavior', async () => {
  const { client, host } = setup();
  const search = await screen.findByRole('searchbox');
  await screen.findAllByRole('option');
  client.copyContent.mockRejectedValueOnce(
    new Error('sensitive clipboard details'),
  );
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  const copyButton = screen.getByRole('button', { name: 'Copy clip' });
  fireEvent.click(copyButton);
  const error = await screen.findByRole('alert');
  expect(error.textContent).toContain('Clip could not be copied.');
  expect(error.textContent).not.toContain('sensitive');
  expect(copyButton).toHaveProperty('disabled', false);
  expect(host.hide).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry copy' }));
  await screen.findByText('Copied');
  expect(client.copyContent.mock.calls).toEqual([['newer'], ['newer']]);
  expect(screen.queryByRole('alert')).toBeNull();
});

test('a dismissed button-copy session ignores stale completion', async () => {
  const { client, emit } = setup();
  const search = await screen.findByRole('searchbox');
  await screen.findAllByRole('option');
  const pending = deferred<void>();
  client.copyContent.mockReturnValueOnce(pending.promise);
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  fireEvent.click(screen.getByRole('button', { name: 'Copy clip' }));
  emit({ session: 1, visible: false });
  emit({ session: 2, visible: true });
  await screen.findAllByRole('option');
  await act(async () => pending.resolve());
  expect(screen.queryByText('Copied')).toBeNull();
  expect(client.copyContent).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'Copy clip' })).toBeNull();
});

test('Escape dismisses delete confirmation without hiding or deleting', async () => {
  const { client, host } = setup();
  const search = await screen.findByRole('searchbox');
  await screen.findByRole('option', { name: /Recent note/ });
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  fireEvent.click(screen.getByRole('button', { name: 'Delete selected clip' }));

  const confirmation = await screen.findByRole('alertdialog', {
    name: 'Delete this clip?',
  });
  fireEvent.keyDown(confirmation, { key: 'Escape' });

  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(client.delete).not.toHaveBeenCalled();
  expect(host.hide).not.toHaveBeenCalled();
  expect(screen.getByRole('option', { name: /Recent note/ })).toBeTruthy();
});

test('confirmed delete removes the clip, preserves query, selects the next result and focuses search', async () => {
  const { client, host } = setup();
  const search = await screen.findByRole('searchbox');
  await screen.findByRole('option', { name: /Recent note/ });
  fireEvent.change(search, { target: { value: 'note' } });
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  fireEvent.click(screen.getByRole('button', { name: 'Delete selected clip' }));
  fireEvent.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: 'Delete',
    }),
  );

  await waitFor(() => expect(client.delete).toHaveBeenCalledWith('newer'));
  expect(screen.queryByRole('option', { name: /Recent note/ })).toBeNull();
  expect(screen.queryByText('TypeScript guide')).toBeNull();
  expect(
    screen
      .getByRole('option', { name: /Older note/ })
      .getAttribute('aria-selected'),
  ).toBe('true');
  expect(search).toHaveProperty('value', 'note');
  expect(screen.getByText('Deleted')).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(search));
  expect(host.hide).not.toHaveBeenCalled();
});

test('delete selects the previous result when no next result remains', async () => {
  const { client } = setup();
  const search = await screen.findByRole('searchbox');
  await screen.findByRole('option', { name: /Recent note/ });
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  fireEvent.click(screen.getByRole('button', { name: 'Delete selected clip' }));
  fireEvent.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: 'Delete',
    }),
  );

  await waitFor(() => expect(client.delete).toHaveBeenCalledWith('older'));
  expect(
    screen
      .getByRole('option', { name: /Recent note/ })
      .getAttribute('aria-selected'),
  ).toBe('true');
});

test('delete leaves no selection and reuses the empty state when no clips remain', async () => {
  const { client } = setup([newer]);
  const search = await screen.findByRole('searchbox');
  await screen.findByRole('option', { name: /Recent note/ });
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  fireEvent.click(screen.getByRole('button', { name: 'Delete selected clip' }));
  fireEvent.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: 'Delete',
    }),
  );

  await waitFor(() => expect(client.delete).toHaveBeenCalledWith('newer'));
  expect(screen.queryByRole('option')).toBeNull();
  expect(screen.getByText('No clips yet')).toBeTruthy();
});

test('pending and failed deletion stays local, safe, retryable and deduplicated', async () => {
  const { client, host } = setup();
  const search = await screen.findByRole('searchbox');
  await screen.findByRole('option', { name: /Recent note/ });
  let rejectDelete!: (error: Error) => void;
  client.delete.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        rejectDelete = reject;
      }),
  );
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  fireEvent.click(screen.getByRole('button', { name: 'Delete selected clip' }));
  const confirmation = await screen.findByRole('alertdialog');
  const confirm = within(confirmation).getByRole('button', { name: 'Delete' });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(client.delete).toHaveBeenCalledTimes(1);
  expect(document.getElementById('result-newer')).not.toBeNull();

  await act(async () => rejectDelete(new Error('private database details')));
  const error = await within(confirmation).findByRole('alert');
  expect(error.textContent).toBe('Clip could not be deleted.');
  expect(error.textContent).not.toContain('private');
  expect(document.getElementById('result-newer')).not.toBeNull();
  expect(host.hide).not.toHaveBeenCalled();

  fireEvent.click(within(confirmation).getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(client.delete).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(screen.queryByRole('option', { name: /Recent note/ })).toBeNull(),
  );
});
test('keeps an edit draft and exposes a safe retryable error when the clip disappeared', async () => {
  const { client } = setup();
  const search = await screen.findByRole('searchbox');
  await screen.findByRole('option', { name: /Recent note/ });
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  fireEvent.click(screen.getByRole('button', { name: 'Edit selected clip' }));
  const content = await screen.findByRole('textbox', { name: 'Content' });
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
  await waitFor(() => expect(client.list).toHaveBeenCalledTimes(2));
  fireEvent.keyDown(search, { key: 'Escape' });
  expect(host.hide).toHaveBeenCalledWith(1);
  expect(client.copyContent).not.toHaveBeenCalled();
  emit({ session: 1, visible: false });
  emit({ session: 2, visible: true });
  await waitFor(() => expect(client.list).toHaveBeenCalledTimes(3));
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
