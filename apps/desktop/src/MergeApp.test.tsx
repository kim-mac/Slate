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
import { App } from './App';
import type { ClipClient } from './clipClient';
import type { StartupClient } from './startupClient';
import { installationSafetyFixture } from './test/installationSafety';

const month = new Date();
const timestamp = (day: number) =>
  new Date(month.getFullYear(), month.getMonth(), day, 12).toISOString();
const older: Clip = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Older note',
  content: 'Older content',
  contentType: 'code',
  sourceApp: 'Browser',
  sourceUrl: 'https://example.com/shared',
  sourcePageTitle: 'Shared page',
  isPinned: true,
  createdAt: timestamp(9),
  updatedAt: timestamp(9),
};
const newer: Clip = {
  ...older,
  id: '00000000-0000-4000-8000-000000000002',
  title: 'Newer note',
  content: 'Newer content',
  createdAt: timestamp(10),
  updatedAt: timestamp(10),
};
const clipItem = (clip: Clip): LibraryItem => ({ kind: 'clip', clip });
const mergedGroup: ClipGroup = {
  id: '00000000-0000-4000-8000-000000000010',
  title: 'Shared page',
  isPinned: false,
  createdAt: timestamp(11),
  updatedAt: timestamp(11),
  members: [newer, older],
};

function setup(
  initial: LibraryItem[] = [clipItem(older), clipItem(newer)],
  safety = installationSafetyFixture(),
) {
  const client: ClipClient = {
    renameGroup: vi.fn(),
    list: vi.fn().mockResolvedValue(initial),
    create: vi.fn().mockImplementation(async (input: ClipInput) => ({
      ...input,
      id: '00000000-0000-4000-8000-000000000003',
      isPinned: false,
      createdAt: timestamp(12),
      updatedAt: timestamp(12),
    })),
    update: vi.fn(),
    delete: vi.fn(),
    setPinned: vi.fn(),
    copyContent: vi.fn(),
    openSource: vi.fn(),
    merge: vi.fn().mockResolvedValue(mergedGroup),
    unmergeMember: vi.fn().mockResolvedValue(undefined),
    unmergeGroup: vi.fn().mockResolvedValue(undefined),
    deleteGroupMember: vi.fn().mockResolvedValue(undefined),
    deleteGroup: vi.fn().mockResolvedValue(undefined),
    setGroupPinned: vi
      .fn()
      .mockResolvedValue({ ...mergedGroup, isPinned: true }),
  };
  const startupClient: StartupClient = {
    getEnabled: vi.fn().mockResolvedValue(false),
    setEnabled: vi.fn().mockResolvedValue(false),
  };
  render(
    <App
      client={client}
      startupClient={startupClient}
      safetyClient={safety.client}
    />,
  );
  return client;
}

async function enterMergeMode() {
  await screen.findByRole('button', { name: 'Open Newer note' });
  fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
}

function calendarSelect(title: string): HTMLButtonElement {
  return within(
    document.querySelector<HTMLElement>('.memory-calendar')!,
  ).getByRole('button', { name: `Select ${title}` }) as HTMLButtonElement;
}

async function memberAction(title: string, action: string) {
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${title}` }));
  fireEvent.click(await screen.findByRole('menuitem', { name: action }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

test('Merge mode reuses the header, preserves cross-view ID selection, and exits with Cancel', async () => {
  setup();
  await enterMergeMode();
  expect(screen.queryByRole('toolbar', { name: 'Merge selection' })).toBeNull();
  expect(screen.getByText('0 selected')).toBeTruthy();
  fireEvent.click(calendarSelect('Newer note'));
  const sidebar = screen.getByRole('navigation', { name: 'Clip library' });
  expect(
    within(sidebar)
      .getByRole('button', { name: /Newer note/ })
      .getAttribute('aria-pressed'),
  ).toBe('true');
  fireEvent.click(within(sidebar).getByRole('button', { name: /Older note/ }));
  expect(screen.getByText('2 selected')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('button', { name: 'Merge' })).toBeTruthy();
});

test('Escape exits Merge mode', async () => {
  setup();
  await enterMergeMode();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.getByRole('button', { name: 'Merge' })).toBeTruthy();
});

test('Merge sends the user selection order rather than sorting titles by library order', async () => {
  const client = setup();
  await enterMergeMode();
  fireEvent.click(calendarSelect('Older note'));
  fireEvent.click(calendarSelect('Newer note'));
  fireEvent.click(screen.getByRole('button', { name: 'Merge selected' }));
  await waitFor(() => expect(client.merge).toHaveBeenCalledTimes(1));
  expect(client.merge).toHaveBeenCalledWith([
    { kind: 'clip', id: older.id },
    { kind: 'clip', id: newer.id },
  ]);
  expect(screen.queryByRole('dialog', { name: 'Create clip' })).toBeNull();
  expect(await screen.findByText('2 clips merged')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Open Shared page' })).toBeTruthy();
});

test('Create reconciles automatic membership and opens the containing group', async () => {
  const client = setup([clipItem(older)]);
  await screen.findByRole('button', { name: 'Open Older note' });
  vi.mocked(client.create).mockResolvedValue(newer);
  vi.mocked(client.list).mockResolvedValue([
    { kind: 'group', group: mergedGroup },
  ]);
  fireEvent.click(screen.getByRole('button', { name: 'New clip' }));
  const dialog = await screen.findByRole('dialog', { name: 'Create clip' });
  fireEvent.change(within(dialog).getByLabelText('Content'), {
    target: { value: newer.content },
  });
  fireEvent.change(within(dialog).getByLabelText('Source URL'), {
    target: { value: newer.sourceUrl },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save clip' }));
  expect(
    await screen.findByRole('heading', { name: mergedGroup.title }),
  ).toBeTruthy();
  expect(client.create).toHaveBeenCalledTimes(1);
  expect(
    screen.getByText(newer.content, { selector: '.clip-content' }),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Open Newer note' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Open Older note' })).toBeNull();
});

test('a committed Create survives refresh failure without offering a duplicate save', async () => {
  const client = setup();
  await screen.findByRole('button', { name: 'Open Older note' });
  vi.mocked(client.list).mockRejectedValue(new Error('private SQL details'));
  fireEvent.click(screen.getByRole('button', { name: 'New clip' }));
  const dialog = await screen.findByRole('dialog', { name: 'Create clip' });
  fireEvent.change(within(dialog).getByLabelText('Content'), {
    target: { value: 'Committed capture' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save clip' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(
    await screen.findByText(/Clip saved, but the library could not refresh/),
  ).toBeTruthy();
  expect(client.create).toHaveBeenCalledTimes(1);
  vi.mocked(client.list).mockResolvedValue([
    { kind: 'group', group: mergedGroup },
  ]);
  await act(async () => fireEvent.focus(window));
  await screen.findByRole('button', { name: 'Open Shared page' });
  expect(client.create).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() =>
    expect(
      screen.queryByText(/Clip saved, but the library could not refresh/),
    ).toBeNull(),
  );
});

test('member Edit reuses the full dialog and preserves group identity and title', async () => {
  const client = setup([{ kind: 'group', group: mergedGroup }]);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Open Shared page' }),
  );
  await memberAction('Older note', 'Edit');
  const dialog = await screen.findByRole('dialog', { name: 'Edit clip' });
  expect(within(dialog).getByLabelText('Content')).toHaveProperty(
    'value',
    older.content,
  );
  const updated = { ...older, content: 'Updated member' };
  vi.mocked(client.update).mockResolvedValue(updated);
  vi.mocked(client.list).mockResolvedValue([
    { kind: 'group', group: { ...mergedGroup, members: [newer, updated] } },
  ]);
  fireEvent.change(within(dialog).getByLabelText('Content'), {
    target: { value: updated.content },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(client.update).toHaveBeenCalledExactlyOnceWith(older.id, {
    content: updated.content,
    contentType: older.contentType,
    title: older.title,
    sourceApp: older.sourceApp,
    sourceUrl: older.sourceUrl,
    sourcePageTitle: older.sourcePageTitle,
  });
  expect(screen.getByRole('heading', { name: mergedGroup.title })).toBeTruthy();
  expect(
    screen.getByText(updated.content, { selector: '.clip-content' }),
  ).toBeTruthy();
  expect(
    screen.getByText(newer.content, { selector: '.clip-content' }),
  ).toBeTruthy();
  expect(client.unmergeMember).not.toHaveBeenCalled();
});

test('member Edit retains the draft and its lease after persistence failure', async () => {
  const safety = installationSafetyFixture();
  const client = setup([{ kind: 'group', group: mergedGroup }], safety);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Open Shared page' }),
  );
  await memberAction('Older note', 'Edit');
  const dialog = await screen.findByRole('dialog', { name: 'Edit clip' });
  vi.mocked(client.update).mockRejectedValue(new Error('private SQL failure'));
  fireEvent.change(within(dialog).getByLabelText('Content'), {
    target: { value: 'Keep this draft' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  await within(dialog).findByRole('alert');
  expect(within(dialog).getByLabelText('Content')).toHaveProperty(
    'value',
    'Keep this draft',
  );
  expect(safety.client.acquire).toHaveBeenCalledWith(1, 'editor');
  expect(safety.client.release).not.toHaveBeenCalled();
  expect(client.unmergeMember).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(safety.client.release).toHaveBeenCalledOnce();
  expect(screen.getByRole('heading', { name: mergedGroup.title })).toBeTruthy();
});

test('search and calendar navigation hide selected items without changing membership', async () => {
  const client = setup();
  await enterMergeMode();
  fireEvent.click(calendarSelect('Older note'));
  fireEvent.click(calendarSelect('Newer note'));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search clips' }), {
    target: { value: 'Newer' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
  expect(screen.getByText('2 selected')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Merge selected' }));
  await waitFor(() => expect(client.merge).toHaveBeenCalledTimes(1));
});

test('refresh keeps valid IDs, ignores arrivals, and prunes a missing selected item', async () => {
  const client = setup();
  await enterMergeMode();
  fireEvent.click(calendarSelect('Older note'));
  fireEvent.click(calendarSelect('Newer note'));
  const external = clipItem({
    ...newer,
    id: 'external',
    title: 'External clip',
  });
  vi.mocked(client.list).mockResolvedValue([
    clipItem(older),
    clipItem(newer),
    external,
  ]);
  await act(async () => fireEvent.focus(window));
  await waitFor(() => expect(calendarSelect('External clip')).toBeTruthy());
  expect(screen.getByText('2 selected')).toBeTruthy();
  expect(calendarSelect('External clip').getAttribute('aria-pressed')).toBe(
    'false',
  );
  vi.mocked(client.list).mockResolvedValue([clipItem(newer), external]);
  await act(async () => fireEvent.focus(window));
  await waitFor(() => expect(screen.getByText('1 selected')).toBeTruthy());
});

test('same exact source URLs receive a subtle hint without automatic selection', async () => {
  setup();
  await enterMergeMode();
  fireEvent.click(calendarSelect('Older note'));
  const candidate = calendarSelect('Newer note');
  expect(candidate.getAttribute('data-same-source-hint')).toBe('true');
  expect(candidate.getAttribute('aria-pressed')).toBe('false');
});

test('group detail exposes members and management actions', async () => {
  const client = setup([{ kind: 'group', group: mergedGroup }]);
  await screen.findByRole('button', { name: 'Open Shared page' });
  fireEvent.click(screen.getByRole('button', { name: 'Open Shared page' }));
  expect(screen.getByRole('heading', { name: 'Shared page' })).toBeTruthy();
  expect(screen.getByText('Newer content')).toBeTruthy();
  expect(screen.getByText('Older content')).toBeTruthy();
  await memberAction('Newer note', 'Unmerge');
  await waitFor(() =>
    expect(client.unmergeMember).toHaveBeenCalledWith(mergedGroup.id, newer.id),
  );
  await memberAction('Older note', 'Delete');
  expect(
    await screen.findByText(/Permanently delete “Older note”/),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Delete clip' }));
  await waitFor(() =>
    expect(client.deleteGroupMember).toHaveBeenCalledWith(
      mergedGroup.id,
      older.id,
    ),
  );
});

test('group pin uses its atomic client operation', async () => {
  const client = setup([{ kind: 'group', group: mergedGroup }]);
  await screen.findByRole('button', { name: 'Open Shared page' });
  fireEvent.click(screen.getByRole('button', { name: 'Open Shared page' }));
  fireEvent.click(screen.getByRole('button', { name: 'Pin merged clip' }));
  await waitFor(() =>
    expect(client.setGroupPinned).toHaveBeenCalledWith(mergedGroup.id, true),
  );
});

test('whole-group unmerge uses its atomic client operation', async () => {
  const client = setup([{ kind: 'group', group: mergedGroup }]);
  await screen.findByRole('button', { name: 'Open Shared page' });
  fireEvent.click(screen.getByRole('button', { name: 'Open Shared page' }));
  fireEvent.click(screen.getByRole('button', { name: 'Unmerge all clips' }));
  await waitFor(() =>
    expect(client.unmergeGroup).toHaveBeenCalledWith(mergedGroup.id),
  );
});

test('whole-group delete uses its atomic client operation after confirmation', async () => {
  const client = setup([{ kind: 'group', group: mergedGroup }]);
  await screen.findByRole('button', { name: 'Open Shared page' });
  fireEvent.click(screen.getByRole('button', { name: 'Open Shared page' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete merged clip' }));
  expect(
    await screen.findByText(/Permanently delete all 2 clips/),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Delete all 2 clips' }));
  await waitFor(() =>
    expect(client.deleteGroup).toHaveBeenCalledWith(
      mergedGroup.id,
      mergedGroup.members.map((clip) => clip.id),
    ),
  );
});

test('group confirmation reads authoritative membership before showing its scope', async () => {
  const client = setup([{ kind: 'group', group: mergedGroup }]);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Open Shared page' }),
  );
  const expanded = {
    ...mergedGroup,
    members: [
      ...mergedGroup.members,
      { ...older, id: 'third', title: 'Third clip' },
    ],
  };
  vi.mocked(client.list).mockResolvedValue([
    { kind: 'group', group: expanded },
  ]);
  fireEvent.click(screen.getByRole('button', { name: 'Delete merged clip' }));
  expect(
    await screen.findByRole('button', { name: 'Delete all 3 clips' }),
  ).toBeTruthy();
  expect(client.deleteGroup).not.toHaveBeenCalled();
});

test('stale group deletion refreshes for review without automatically confirming again', async () => {
  const safety = installationSafetyFixture();
  const client = setup([{ kind: 'group', group: mergedGroup }], safety);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Open Shared page' }),
  );
  const detail = document.querySelector('.merged-clip-detail');
  const viewport = detail!.querySelector<HTMLElement>(
    '[data-slot="scroll-area-viewport"]',
  )!;
  viewport.scrollTop = 120;
  fireEvent.click(screen.getByRole('button', { name: 'Delete merged clip' }));
  const confirm = await screen.findByRole('button', {
    name: 'Delete all 2 clips',
  });
  const expanded = {
    ...mergedGroup,
    members: [
      ...mergedGroup.members,
      { ...older, id: 'third', title: 'Third clip', content: 'New capture' },
    ],
  };
  vi.mocked(client.list).mockResolvedValue([
    { kind: 'group', group: expanded },
  ]);
  vi.mocked(client.deleteGroup).mockRejectedValueOnce({
    code: 'group_changed',
    message: 'This group changed. Review its clips before deleting.',
  });
  fireEvent.click(confirm);
  expect(
    await screen.findByText(
      /This group changed\. Review its clips before deleting\./,
    ),
  ).toBeTruthy();
  expect(await screen.findByText('New capture')).toBeTruthy();
  const alert = screen.getByRole('alert');
  expect(alert.closest('.content')).toBeNull();
  expect(alert.closest('.clip-feedback-error')).not.toBeNull();
  expect(document.querySelector('.content')!.children).toHaveLength(1);
  expect(document.querySelector('.merged-clip-detail')).toBe(detail);
  expect(detail!.querySelector('[data-slot="scroll-area-viewport"]')).toBe(
    viewport,
  );
  expect(viewport.scrollTop).toBe(120);
  expect(client.deleteGroup).toHaveBeenCalledTimes(1);
  expect(client.deleteGroup).toHaveBeenCalledWith(mergedGroup.id, [
    newer.id,
    older.id,
  ]);
  expect(screen.queryByRole('alertdialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(client.deleteGroup).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Delete merged clip' }));
  expect(
    await screen.findByRole('button', { name: 'Delete all 3 clips' }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(client.deleteGroup).toHaveBeenCalledTimes(1);
  expect(safety.client.release).toHaveBeenCalledTimes(2);
});

test('group confirmation fails closed and releases its lease when the authoritative read fails', async () => {
  const safety = installationSafetyFixture();
  const client = setup([{ kind: 'group', group: mergedGroup }], safety);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Open Shared page' }),
  );
  vi.mocked(client.list).mockRejectedValue(new Error('synthetic read failure'));
  fireEvent.click(screen.getByRole('button', { name: 'Delete merged clip' }));
  expect(
    await screen.findByText(
      /Could not load this group\. Refresh the library and try again\./,
    ),
  ).toBeTruthy();
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(client.deleteGroup).not.toHaveBeenCalled();
  await waitFor(() => expect(safety.client.release).toHaveBeenCalledTimes(1));
  expect(screen.getByText('Older content')).toBeTruthy();
});

test('a group that disappears before opening cannot acquire a deletion confirmation', async () => {
  const safety = installationSafetyFixture();
  const client = setup([{ kind: 'group', group: mergedGroup }], safety);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Open Shared page' }),
  );
  vi.mocked(client.list).mockResolvedValue([clipItem(older), clipItem(newer)]);
  fireEvent.click(screen.getByRole('button', { name: 'Delete merged clip' }));
  expect(
    await screen.findByText(
      /This clip or group changed or is no longer available/,
    ),
  ).toBeTruthy();
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(client.deleteGroup).not.toHaveBeenCalled();
  await waitFor(() => expect(safety.client.release).toHaveBeenCalledTimes(1));
});

test('fresh confirmation after a same-count replacement submits the newly reviewed IDs only', async () => {
  const client = setup([{ kind: 'group', group: mergedGroup }]);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Open Shared page' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Delete merged clip' }));
  const confirm = await screen.findByRole('button', {
    name: 'Delete all 2 clips',
  });
  const replacement = {
    ...older,
    id: 'replacement',
    content: 'Replacement content',
  };
  vi.mocked(client.list).mockResolvedValue([
    { kind: 'group', group: { ...mergedGroup, members: [newer, replacement] } },
  ]);
  vi.mocked(client.deleteGroup).mockRejectedValueOnce({
    code: 'group_changed',
    message: 'This group changed. Review its clips before deleting.',
  });
  fireEvent.click(confirm);
  expect(await screen.findByText('Replacement content')).toBeTruthy();
  expect(client.deleteGroup).toHaveBeenCalledExactlyOnceWith(mergedGroup.id, [
    newer.id,
    older.id,
  ]);
  fireEvent.click(screen.getByRole('button', { name: 'Delete merged clip' }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Delete all 2 clips' }),
  );
  await waitFor(() => expect(client.deleteGroup).toHaveBeenCalledTimes(2));
  expect(vi.mocked(client.deleteGroup).mock.calls[1]).toEqual([
    mergedGroup.id,
    [newer.id, replacement.id],
  ]);
  expect(await screen.findByText('2 clips deleted.')).toBeTruthy();
});

test('canceling the original confirmation never deletes or silently expands its count', async () => {
  const safety = installationSafetyFixture();
  const client = setup([{ kind: 'group', group: mergedGroup }], safety);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Open Shared page' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Delete merged clip' }));
  await screen.findByRole('button', { name: 'Delete all 2 clips' });
  vi.mocked(client.list).mockResolvedValue([
    {
      kind: 'group',
      group: {
        ...mergedGroup,
        members: [...mergedGroup.members, { ...older, id: 'third' }],
      },
    },
  ]);
  fireEvent.focus(window);
  expect(
    screen.queryByRole('button', { name: 'Delete all 3 clips' }),
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(client.deleteGroup).not.toHaveBeenCalled();
  expect(safety.client.release).toHaveBeenCalledTimes(1);
});

test('pending confirmed deletion is single-flight and retains its lease until completion', async () => {
  const safety = installationSafetyFixture();
  const client = setup([{ kind: 'group', group: mergedGroup }], safety);
  let resolve!: () => void;
  vi.mocked(client.deleteGroup).mockImplementation(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'Open Shared page' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Delete merged clip' }));
  const confirm = await screen.findByRole('button', {
    name: 'Delete all 2 clips',
  });
  act(() => {
    fireEvent.click(confirm);
    fireEvent.click(confirm);
  });
  expect(client.deleteGroup).toHaveBeenCalledExactlyOnceWith(mergedGroup.id, [
    newer.id,
    older.id,
  ]);
  expect(safety.client.release).not.toHaveBeenCalled();
  await act(async () => resolve());
  expect(await screen.findByText('2 clips deleted.')).toBeTruthy();
  await waitFor(() => expect(safety.client.release).toHaveBeenCalledTimes(1));
});

test('stale rejection with a failed refresh does not permit a cached destructive retry', async () => {
  const safety = installationSafetyFixture();
  const client = setup([{ kind: 'group', group: mergedGroup }], safety);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Open Shared page' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Delete merged clip' }));
  const confirm = await screen.findByRole('button', {
    name: 'Delete all 2 clips',
  });
  vi.mocked(client.list).mockRejectedValue(new Error('synthetic read failure'));
  vi.mocked(client.deleteGroup).mockRejectedValue({
    code: 'group_changed',
    message: 'This group changed. Review its clips before deleting.',
  });
  fireEvent.click(confirm);
  expect(
    await screen.findByText(
      /This group changed\. Review its clips before deleting\./,
    ),
  ).toBeTruthy();
  await waitFor(() => expect(safety.client.release).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Delete merged clip' }));
  expect(
    await screen.findByText(
      /Could not load this group\. Refresh the library and try again\./,
    ),
  ).toBeTruthy();
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(client.deleteGroup).toHaveBeenCalledTimes(1);
});
