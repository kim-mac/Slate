import type {
  Clip,
  ClipGroup,
  ClipInput,
  LibraryItem,
} from '@ai-clip-memory/shared';
import {
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

function setup(initial: LibraryItem[] = [clipItem(older), clipItem(newer)]) {
  const client: ClipClient = {
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
  render(<App client={client} startupClient={startupClient} />);
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

test('Merge mode reuses the header, preserves cross-view ID selection, and exits with Cancel or Escape', async () => {
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
  await enterMergeMode();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.getByRole('button', { name: 'Merge' })).toBeTruthy();
});

test('Merge directly creates one persistent group in deterministic top-level order', async () => {
  const client = setup();
  await enterMergeMode();
  fireEvent.click(calendarSelect('Older note'));
  fireEvent.click(calendarSelect('Newer note'));
  fireEvent.click(screen.getByRole('button', { name: 'Merge selected' }));
  await waitFor(() => expect(client.merge).toHaveBeenCalledTimes(1));
  expect(client.merge).toHaveBeenCalledWith([
    { kind: 'clip', id: newer.id },
    { kind: 'clip', id: older.id },
  ]);
  expect(screen.queryByRole('dialog', { name: 'Create clip' })).toBeNull();
  expect(await screen.findByText('2 clips merged')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Open Shared page' })).toBeTruthy();
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
  fireEvent.focus(window);
  await waitFor(() => expect(calendarSelect('External clip')).toBeTruthy());
  expect(screen.getByText('2 selected')).toBeTruthy();
  expect(calendarSelect('External clip').getAttribute('aria-pressed')).toBe(
    'false',
  );
  vi.mocked(client.list).mockResolvedValue([clipItem(newer), external]);
  fireEvent.focus(window);
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
  fireEvent.click(screen.getByRole('button', { name: 'Unmerge Newer note' }));
  await waitFor(() =>
    expect(client.unmergeMember).toHaveBeenCalledWith(mergedGroup.id, newer.id),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Delete Older note' }));
  expect(screen.getByText(/Permanently delete “Older note”/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Delete clip' }));
  await waitFor(() =>
    expect(client.deleteGroupMember).toHaveBeenCalledWith(
      mergedGroup.id,
      older.id,
    ),
  );
});

test('group-level unmerge, delete, and pin use their atomic client operations', async () => {
  let client = setup([{ kind: 'group', group: mergedGroup }]);
  await screen.findByRole('button', { name: 'Open Shared page' });
  fireEvent.click(screen.getByRole('button', { name: 'Open Shared page' }));
  fireEvent.click(screen.getByRole('button', { name: 'Pin merged clip' }));
  await waitFor(() =>
    expect(client.setGroupPinned).toHaveBeenCalledWith(mergedGroup.id, true),
  );
  cleanup();
  client = setup([{ kind: 'group', group: mergedGroup }]);
  await screen.findByRole('button', { name: 'Open Shared page' });
  fireEvent.click(screen.getByRole('button', { name: 'Open Shared page' }));
  fireEvent.click(screen.getByRole('button', { name: 'Unmerge all clips' }));
  await waitFor(() =>
    expect(client.unmergeGroup).toHaveBeenCalledWith(mergedGroup.id),
  );
  cleanup();
  client = setup([{ kind: 'group', group: mergedGroup }]);
  await screen.findByRole('button', { name: 'Open Shared page' });
  fireEvent.click(screen.getByRole('button', { name: 'Open Shared page' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete merged clip' }));
  expect(screen.getByText(/Permanently delete all 2 clips/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Delete all 2 clips' }));
  await waitFor(() =>
    expect(client.deleteGroup).toHaveBeenCalledWith(mergedGroup.id),
  );
});
