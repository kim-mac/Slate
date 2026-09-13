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

const currentMonthLabel = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  year: 'numeric',
}).format(new Date());
const currentMonthClip: Clip = {
  ...firstClip,
  createdAt: new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    11,
    12,
  ).toISOString(),
};

function currentDayClips(): Clip[] {
  return [
    currentMonthClip,
    {
      ...currentMonthClip,
      id: 'calendar-day-two',
      title: 'Second calendar memory',
      content: 'Second same-day memory',
    },
    {
      ...currentMonthClip,
      id: 'calendar-day-three',
      title: 'Third calendar memory',
      content: 'Unique overflow filter target',
    },
  ];
}

function currentDayLabel(): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(currentMonthClip.createdAt));
}

async function waitForCalendar() {
  return screen.findByRole('heading', { name: currentMonthLabel });
}

async function openClipFromSidebar(clip: Clip) {
  const sidebar = screen
    .getByRole('navigation', { name: 'Clip library' })
    .closest<HTMLElement>('[data-slot="sidebar"]')!;
  const preview = await within(sidebar).findByText(clip.content, {
    selector: '.clip-list-preview',
  });
  fireEvent.click(preview.closest('button')!);
  return screen.findByText(clip.content, { selector: '.clip-content' });
}

async function openCalendarActions(title: string) {
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${title}` }));
  return screen.findByRole('menu', undefined, { timeout: 3_000 });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('App', () => {
  test('opens on the calendar and preserves an explicitly opened detail across section and filter changes', async () => {
    render(<App client={fakeClient([firstClip, pinnedClip]).client} />);

    expect(
      await screen.findByRole('heading', { name: currentMonthLabel }),
    ).toBeTruthy();
    expect(
      screen.queryByText(firstClip.content, { selector: '.clip-content' }),
    ).toBeNull();

    const sidebar = screen
      .getByRole('navigation', { name: 'Clip library' })
      .closest<HTMLElement>('[data-slot="sidebar"]')!;
    fireEvent.click(
      within(sidebar)
        .getByText(firstClip.content, { selector: '.clip-list-preview' })
        .closest('button')!,
    );
    expect(
      screen.getByText(firstClip.content, { selector: '.clip-content' }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'All Clips' }));
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'no matching result' },
    });
    expect(
      screen.getByText(firstClip.content, { selector: '.clip-content' }),
    ).toBeTruthy();
  });

  test('opens calendar clips in the existing detail and restores calendar focus on Back', async () => {
    render(<App client={fakeClient([currentMonthClip]).client} />);
    await waitForCalendar();
    const calendarClip = screen.getByRole('button', {
      name: `Open ${currentMonthClip.title!}`,
    });

    fireEvent.click(calendarClip);
    const back = await screen.findByRole('button', {
      name: 'Back to calendar',
    });
    await waitFor(() => expect(document.activeElement).toBe(back));
    expect(
      screen.getByText(currentMonthClip.content, { selector: '.clip-content' }),
    ).toBeTruthy();

    fireEvent.click(back);
    await waitForCalendar();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', {
          name: `Open ${currentMonthClip.title!}`,
        }),
      ),
    );
  });

  test('falls back to the originating day when a calendar card disappears before Back', async () => {
    render(<App client={fakeClient([currentMonthClip]).client} />);
    await waitForCalendar();
    fireEvent.click(
      screen.getByRole('button', {
        name: `Open ${currentMonthClip.title!}`,
      }),
    );
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'does not match' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Back to calendar' }));

    const dayLabel = new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date(currentMonthClip.createdAt));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('gridcell', { name: dayLabel }),
      ),
    );
  });

  test('does not steal focus from Search when filtering removes the previously focused calendar clip', async () => {
    render(<App client={fakeClient([currentMonthClip]).client} />);
    await waitForCalendar();
    screen
      .getByRole('button', { name: `Open ${currentMonthClip.title!}` })
      .focus();

    const searchbox = screen.getByRole('searchbox');
    searchbox.focus();
    fireEvent.change(searchbox, {
      target: { value: 'does not match the calendar clip' },
    });

    await waitFor(() => expect(document.activeElement).toBe(searchbox));
  });

  test('does not steal focus from the type filter when it removes the previously focused calendar action', async () => {
    render(<App client={fakeClient([currentMonthClip]).client} />);
    await waitForCalendar();
    screen
      .getByRole('button', { name: `Actions for ${currentMonthClip.title!}` })
      .focus();

    fireEvent.click(screen.getByRole('combobox', { name: 'Filter clips' }));
    fireEvent.keyDown(screen.getByRole('option', { name: 'Code' }), {
      key: 'Enter',
    });

    const typeFilter = screen.getByRole('combobox', {
      name: 'Filter clips: Code',
    });
    await waitFor(() => expect(document.activeElement).toBe(typeFilter));
  });

  test('opens calendar clips in Detail through keyboard activation', async () => {
    render(<App client={fakeClient([currentMonthClip]).client} />);
    await waitForCalendar();
    const calendarClip = screen.getByRole('button', {
      name: `Open ${currentMonthClip.title!}`,
    });

    calendarClip.focus();
    fireEvent.keyDown(calendarClip, { key: 'Enter' });

    expect(
      await screen.findByText(currentMonthClip.content, {
        selector: '.clip-content',
      }),
    ).toBeTruthy();
  });

  test('Back preserves the visible month, search, type filter, and sidebar scope', async () => {
    const previousDate = new Date(
      new Date().getFullYear(),
      new Date().getMonth() - 1,
      12,
      12,
    );
    const previousClip: Clip = {
      ...firstClip,
      id: 'previous-month',
      contentType: 'code',
      createdAt: previousDate.toISOString(),
      updatedAt: previousDate.toISOString(),
    };
    const previousMonthLabel = new Intl.DateTimeFormat(undefined, {
      month: 'long',
      year: 'numeric',
    }).format(previousDate);
    render(<App client={fakeClient([previousClip]).client} />);
    await waitForCalendar();
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    await screen.findByRole('heading', { name: previousMonthLabel });
    fireEvent.click(
      screen.getByRole('button', { name: `Open ${previousClip.title!}` }),
    );
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'does not match the open clip' },
    });
    fireEvent.click(screen.getByRole('combobox', { name: 'Filter clips' }));
    const textOption = screen.getByRole('option', { name: 'Text' });
    fireEvent.keyDown(textOption, { key: 'Enter' });
    fireEvent.keyDown(textOption, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Pinned' }));

    expect(
      screen.getByText(previousClip.content, { selector: '.clip-content' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to calendar' }));

    expect(
      screen.getByRole('heading', { name: previousMonthLabel }),
    ).toBeTruthy();
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe(
      'does not match the open clip',
    );
    expect(
      screen.getByRole('combobox', { name: 'Filter clips: Text' }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: 'Pinned' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    const dayLabel = new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(previousDate);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('gridcell', { name: dayLabel }),
      ),
    );
  });

  test('restores a sidebar-origin row on Back and falls back to the month heading if it disappears', async () => {
    render(<App client={fakeClient([currentMonthClip]).client} />);
    await waitForCalendar();
    const sidebar = screen
      .getByRole('navigation', { name: 'Clip library' })
      .closest<HTMLElement>('[data-slot="sidebar"]')!;
    const row = within(sidebar)
      .getByText(currentMonthClip.content, { selector: '.clip-list-preview' })
      .closest<HTMLButtonElement>('button')!;
    fireEvent.click(row);
    fireEvent.click(screen.getByRole('button', { name: 'Back to calendar' }));
    await waitFor(() => expect(document.activeElement).toBe(row));

    fireEvent.click(row);
    fireEvent.click(screen.getByRole('button', { name: 'All Clips' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to calendar' }));
    const heading = await screen.findByRole('heading', {
      name: currentMonthLabel,
    });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  test('opens a created clip in Detail and returns to its local creation month', async () => {
    const createdDate = new Date(2025, 1, 15, 12);
    const created: Clip = {
      ...firstClip,
      id: 'created-in-february',
      title: 'Created memory',
      content: 'A newly created memory',
      createdAt: createdDate.toISOString(),
      updatedAt: createdDate.toISOString(),
    };
    const fake = fakeClient();
    fake.create.mockResolvedValue(created);
    render(<App client={fake.client} />);
    await waitForCalendar();
    fireEvent.click(screen.getByRole('button', { name: 'New clip' }));
    const dialog = screen.getByRole('dialog', { name: 'Create clip' });
    fireEvent.change(within(dialog).getByLabelText('Content'), {
      target: { value: created.content },
    });
    fireEvent.change(within(dialog).getByLabelText('Title'), {
      target: { value: created.title },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save clip' }));

    expect(
      await screen.findByRole('heading', { name: created.title! }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to calendar' }));
    expect(
      screen.getByRole('heading', {
        name: new Intl.DateTimeFormat(undefined, {
          month: 'long',
          year: 'numeric',
        }).format(createdDate),
      }),
    ).toBeTruthy();
  });

  test('keeps calendar placement while editing and pinning an open clip', async () => {
    const updated = {
      ...currentMonthClip,
      title: 'Updated calendar memory',
      content: 'Updated without moving dates',
    };
    const fake = fakeClient([currentMonthClip]);
    fake.update.mockResolvedValue(updated);
    fake.setPinned.mockResolvedValue({ ...updated, isPinned: true });
    render(<App client={fake.client} />);
    await waitForCalendar();
    fireEvent.click(
      screen.getByRole('button', {
        name: `Open ${currentMonthClip.title!}`,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit clip' });
    fireEvent.change(within(dialog).getByLabelText('Content'), {
      target: { value: updated.content },
    });
    fireEvent.change(within(dialog).getByLabelText('Title'), {
      target: { value: updated.title },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Save changes' }),
    );
    await screen.findByRole('heading', { name: updated.title });
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
    await screen.findByRole('button', { name: 'Unpin' });
    fireEvent.click(screen.getByRole('button', { name: 'Back to calendar' }));

    expect(await waitForCalendar()).toBeTruthy();
    expect(
      screen.getByRole('button', { name: `Open ${updated.title}` }),
    ).toBeTruthy();
    expect(fake.update.mock.calls[0]?.[1]).not.toHaveProperty('createdAt');
    expect(fake.setPinned).toHaveBeenCalledWith(currentMonthClip.id, true);
  });

  test('reuses App copy, edit, pin, and delete flows from calendar actions without opening Detail', async () => {
    const pinned = { ...currentMonthClip, isPinned: true };
    const fake = fakeClient([currentMonthClip]);
    fake.setPinned.mockResolvedValue(pinned);
    render(<App client={fake.client} />);
    await waitForCalendar();
    const actionsName = `Actions for ${currentMonthClip.title!}`;

    fireEvent.click(
      within(await openCalendarActions(currentMonthClip.title!)).getByRole(
        'menuitem',
        { name: 'Copy' },
      ),
    );
    await waitFor(() =>
      expect(fake.copyContent).toHaveBeenCalledWith(currentMonthClip.id),
    );
    expect(
      screen.queryByRole('button', { name: 'Back to calendar' }),
    ).toBeNull();

    fireEvent.click(
      within(await openCalendarActions(currentMonthClip.title!)).getByRole(
        'menuitem',
        { name: 'Edit' },
      ),
    );
    expect(screen.getByRole('dialog', { name: 'Edit clip' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(
      within(await openCalendarActions(currentMonthClip.title!)).getByRole(
        'menuitem',
        { name: 'Pin' },
      ),
    );
    await waitFor(() =>
      expect(fake.setPinned).toHaveBeenCalledWith(currentMonthClip.id, true),
    );
    expect(
      screen.queryByRole('button', { name: 'Back to calendar' }),
    ).toBeNull();

    fireEvent.click(
      within(await openCalendarActions(currentMonthClip.title!)).getByRole(
        'menuitem',
        { name: 'Delete' },
      ),
    );
    const alert = screen.getByRole('alertdialog', { name: 'Delete clip?' });
    expect(fake.delete).not.toHaveBeenCalled();
    fireEvent.click(within(alert).getByRole('button', { name: 'Delete clip' }));
    await waitFor(() =>
      expect(fake.delete).toHaveBeenCalledWith(currentMonthClip.id),
    );
    expect(screen.queryByRole('button', { name: actionsName })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Back to calendar' }),
    ).toBeNull();
  });

  test('does not queue stale App focus after deleting a clip in Calendar', async () => {
    const fake = fakeClient([currentMonthClip]);
    render(<App client={fake.client} />);
    await waitForCalendar();

    fireEvent.click(
      within(await openCalendarActions(currentMonthClip.title!)).getByRole(
        'menuitem',
        { name: 'Delete' },
      ),
    );
    fireEvent.click(
      within(
        screen.getByRole('alertdialog', { name: 'Delete clip?' }),
      ).getByRole('button', { name: 'Delete clip' }),
    );

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('gridcell', { name: currentDayLabel() }),
      ),
    );
    const pinned = screen.getByRole('button', { name: 'Pinned' });
    pinned.focus();
    fireEvent.click(pinned);

    await waitFor(() => expect(document.activeElement).toBe(pinned));
  });

  test('does not queue stale App focus when delayed Detail deletion resolves after Back', async () => {
    const fake = fakeClient([currentMonthClip]);
    let resolveDelete!: () => void;
    fake.delete.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveDelete = resolve;
      }),
    );
    render(<App client={fake.client} />);
    await waitForCalendar();
    fireEvent.click(
      screen.getByRole('button', {
        name: `Open ${currentMonthClip.title!}`,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(
      within(
        screen.getByRole('alertdialog', { name: 'Delete clip?' }),
      ).getByRole('button', { name: 'Delete clip' }),
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Back to calendar' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', {
          name: `Open ${currentMonthClip.title!}`,
        }),
      ),
    );

    resolveDelete();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('gridcell', { name: currentDayLabel() }),
      ),
    );
    const pinned = screen.getByRole('button', { name: 'Pinned' });
    pinned.focus();
    fireEvent.click(pinned);

    await waitFor(() => expect(document.activeElement).toBe(pinned));
  });

  test('keeps a newer Detail selection when an earlier clip deletion resolves', async () => {
    const secondClip: Clip = {
      ...currentMonthClip,
      id: 'calendar-selection-b',
      title: 'Second selected clip',
      content: 'Second clip remains selected.',
    };
    const fake = fakeClient([currentMonthClip, secondClip]);
    let resolveDelete!: () => void;
    fake.delete.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveDelete = resolve;
      }),
    );
    render(<App client={fake.client} />);
    await waitForCalendar();
    await openClipFromSidebar(currentMonthClip);

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(
      within(
        screen.getByRole('alertdialog', { name: 'Delete clip?' }),
      ).getByRole('button', { name: 'Delete clip' }),
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    await openClipFromSidebar(secondClip);
    const back = screen.getByRole('button', { name: 'Back to calendar' });
    await waitFor(() => expect(document.activeElement).toBe(back));

    resolveDelete();

    await waitFor(() =>
      expect(fake.delete).toHaveBeenCalledWith(currentMonthClip.id),
    );
    const sidebar = screen
      .getByRole('navigation', { name: 'Clip library' })
      .closest<HTMLElement>('[data-slot="sidebar"]')!;
    await waitFor(() =>
      expect(
        within(sidebar).queryByText(currentMonthClip.content, {
          selector: '.clip-list-preview',
        }),
      ).toBeNull(),
    );
    expect(
      screen.getByText(secondClip.content, { selector: '.clip-content' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back to calendar' })).toBe(back);
    expect(document.activeElement).toBe(back);
  });

  test('opens the existing Detail from calendar Preview', async () => {
    render(<App client={fakeClient([currentMonthClip]).client} />);
    await waitForCalendar();
    fireEvent.click(
      within(await openCalendarActions(currentMonthClip.title!)).getByRole(
        'menuitem',
        { name: 'Preview' },
      ),
    );

    expect(
      await screen.findByText(currentMonthClip.content, {
        selector: '.clip-content',
      }),
    ).toBeTruthy();
  });

  test('updates the calendar label after editing directly from its action menu', async () => {
    const updated = {
      ...currentMonthClip,
      title: 'Renamed from calendar',
    };
    const fake = fakeClient([currentMonthClip]);
    fake.update.mockResolvedValue(updated);
    render(<App client={fake.client} />);
    await waitForCalendar();
    fireEvent.click(
      within(await openCalendarActions(currentMonthClip.title!)).getByRole(
        'menuitem',
        { name: 'Edit' },
      ),
    );
    const dialog = screen.getByRole('dialog', { name: 'Edit clip' });
    fireEvent.change(within(dialog).getByLabelText('Title'), {
      target: { value: updated.title },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Save changes' }),
    );

    expect(
      await screen.findByRole('button', { name: `Open ${updated.title}` }),
    ).toBeTruthy();
    expect(fake.update.mock.calls[0]?.[1]).not.toHaveProperty('createdAt');
    expect(
      screen.queryByRole('button', { name: 'Back to calendar' }),
    ).toBeNull();
  });

  test('keeps an open day overflow coherent as the existing search filter changes', async () => {
    render(<App client={fakeClient(currentDayClips()).client} />);
    await waitForCalendar();
    fireEvent.click(
      screen.getByRole('button', {
        name: `Show 1 more clip for ${currentDayLabel()}`,
      }),
    );
    expect(screen.getByText('3 matching clips')).toBeTruthy();

    const searchbox = screen.getByRole('searchbox', { hidden: true });
    fireEvent.change(searchbox, {
      target: { value: 'unique overflow' },
    });
    expect(await screen.findByText('1 matching clip')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.change(searchbox, {
      target: { value: 'no matching calendar clip' },
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('gridcell', { name: currentDayLabel() }),
      ),
    );
  });

  test('keeps overflow deletion keyboard-safe through the existing confirmation dialog', async () => {
    const clipsForDay = currentDayClips();
    render(<App client={fakeClient(clipsForDay).client} />);
    await waitForCalendar();
    fireEvent.click(
      screen.getByRole('button', {
        name: `Show 1 more clip for ${currentDayLabel()}`,
      }),
    );
    const dayDialog = screen.getByRole('dialog');
    const trigger = within(dayDialog).getByRole('button', {
      name: `Actions for ${clipsForDay[2]!.title!}`,
    });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    const confirmation = screen.getByRole('alertdialog', {
      name: 'Delete clip?',
    });
    expect(document.body.contains(dayDialog)).toBe(true);
    fireEvent.click(
      within(confirmation).getByRole('button', { name: 'Cancel' }),
    );

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('dialog')).toBe(dayDialog);
    await waitFor(() =>
      expect(dayDialog.contains(document.activeElement)).toBe(true),
    );
  });

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
    await waitForCalendar();
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
    await waitForCalendar();
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
    expect(screen.getByRole('region', { name: 'All Clips' })).toBeTruthy();
  });
  test('collapses to icons while preserving toolbar filters, counts and selected clips', async () => {
    render(<App client={fakeClient([firstClip, pinnedClip]).client} />);
    await openClipFromSidebar(firstClip);
    const sidebar = screen
      .getByRole('button', { name: 'All Clips' })
      .closest<HTMLElement>('[data-slot="sidebar"]')!;
    expect(sidebar.getAttribute('data-state')).toBe('expanded');
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'unions' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Toggle Sidebar', hidden: false }),
    );
    expect(sidebar.getAttribute('data-state')).toBe('collapsed');
    expect(within(sidebar).queryByLabelText('All Clips results')).toBeNull();
    expect(within(sidebar).queryByLabelText('Pinned results')).toBeNull();
    expect(
      screen.getByRole('heading', { name: firstClip.title! }),
    ).toBeTruthy();
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe(
      'unions',
    );
    const privacy = screen.getByLabelText('Local only');
    expect(privacy.tabIndex).toBe(0);
    expect(privacy.closest('[data-slot="tooltip-trigger"]')).not.toBeNull();
    expect(
      screen.getByText(firstClip.content, { selector: '.clip-content' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pinned' }));
    expect(screen.getByRole('region', { name: 'Pinned' })).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'f', ctrlKey: true });
    expect(sidebar.getAttribute('data-state')).toBe('collapsed');
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe(
      'unions',
    );
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));
    expect(
      document.querySelector('[data-slot="sidebar-menu-badge"]')?.textContent,
    ).toBe('2');
  });

  test('focuses toolbar search with Ctrl/Cmd+F and keeps primary actions usable', async () => {
    render(<App client={fakeClient().client} />);
    await waitForCalendar();
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
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Pinned' }));
    fireEvent.click(screen.getByRole('button', { name: 'Privacy & About' }));
    expect(screen.getByText(/Your clips are stored locally/)).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'f', ctrlKey: true });
    expect(screen.getByRole('region', { name: 'All Clips' })).toBeTruthy();
    expect(screen.getByLabelText('All Clips results')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));
  });

  test('guards sidebar shortcuts and does not persist sidebar state', async () => {
    const cookieWrite = vi.spyOn(document, 'cookie', 'set');
    render(<App client={fakeClient().client} />);
    await waitForCalendar();
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
    await waitForCalendar();
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
    await openClipFromSidebar(firstClip);
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
    await openClipFromSidebar(firstClip);
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

  test('returns to the calendar when refresh removes the explicitly selected clip', async () => {
    const fake = fakeClient([firstClip, pinnedClip]);
    fake.list
      .mockResolvedValueOnce([firstClip, pinnedClip])
      .mockResolvedValueOnce([pinnedClip]);
    render(<App client={fake.client} />);
    await openClipFromSidebar(firstClip);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitForCalendar();
    expect(
      screen.queryByRole('heading', { name: pinnedClip.title! }),
    ).toBeNull();
    expect(
      screen
        .getByRole('button', { name: 'All Clips' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  test('uses an icon-only type filter with an accessible active state', async () => {
    render(<App client={fakeClient().client} />);
    await waitForCalendar();
    const trigger = screen.getByRole('combobox', {
      name: 'Filter clips',
    });
    expect(trigger.getAttribute('data-size')).toBe('sm');
    expect(trigger.classList.contains('size-7')).toBe(true);
    expect(
      screen
        .getByRole('button', { name: 'Toggle Sidebar' })
        .classList.contains('size-7'),
    ).toBe(true);
    expect(trigger.querySelector('.lucide-list-filter')).toBeTruthy();
    expect(trigger.textContent).not.toContain('All types');
    expect(trigger.getAttribute('data-active')).toBeNull();
    fireEvent.click(trigger);
    const popup = screen
      .getByRole('listbox')
      .closest('[data-slot="select-content"]')!;
    expect(popup.getAttribute('data-align-trigger')).toBe('false');
    expect(popup.getAttribute('data-side')).toBe('bottom');
    expect(popup.classList.contains('w-36')).toBe(true);
    expect(popup.classList.contains('min-w-0')).toBe(false);
    fireEvent.keyDown(screen.getByRole('option', { name: 'Code' }), {
      key: 'Enter',
    });
    expect(screen.queryByRole('listbox')).toBeNull();
    const activeTrigger = screen.getByRole('combobox', {
      name: 'Filter clips: Code',
    });
    expect(activeTrigger.getAttribute('data-active')).toBe('true');

    fireEvent.click(activeTrigger);
    fireEvent.keyDown(screen.getByRole('option', { name: 'All types' }), {
      key: 'Enter',
    });
    expect(
      screen
        .getByRole('combobox', { name: 'Filter clips' })
        .getAttribute('data-active'),
    ).toBeNull();
  });

  test.each([
    ['Text', 'text'],
    ['Code', 'code'],
    ['Prompt', 'prompt'],
    ['Link', 'link'],
  ] as const)('filters to the %s content type', async (label, contentType) => {
    const typedClips = [
      firstClip,
      pinnedClip,
      {
        ...firstClip,
        id: 'prompt-clip',
        title: 'Prompt clip',
        contentType: 'prompt' as const,
      },
      {
        ...firstClip,
        id: 'link-clip',
        title: 'Link clip',
        contentType: 'link' as const,
      },
    ];
    render(<App client={fakeClient(typedClips).client} />);
    await waitForCalendar();

    fireEvent.click(screen.getByRole('combobox', { name: 'Filter clips' }));
    fireEvent.keyDown(screen.getByRole('option', { name: label }), {
      key: 'Enter',
    });

    expect(
      screen
        .getByLabelText('All Clips results')
        .querySelectorAll('.clip-list-item'),
    ).toHaveLength(1);
    expect(
      screen.getByRole('combobox', { name: `Filter clips: ${label}` }),
    ).toBeTruthy();
    expect(
      typedClips.find((clip) => clip.contentType === contentType),
    ).toBeTruthy();
  });

  test('toggles directly between light and dark without opening a theme menu', async () => {
    render(<App client={fakeClient().client} />);
    await waitForCalendar();

    const lightButton = screen.getByRole('button', {
      name: 'Switch to dark mode',
    });
    expect(lightButton.querySelector('.lucide-sun')).toBeTruthy();
    expect(lightButton.textContent).toBe('');
    expect(screen.queryByRole('combobox', { name: /Theme:/ })).toBeNull();
    expect(screen.queryByRole('option', { name: 'System' })).toBeNull();
    fireEvent.mouseEnter(lightButton);
    expect(await screen.findByText('Switch to dark mode')).toBeTruthy();

    fireEvent.click(lightButton);
    const darkButton = screen.getByRole('button', {
      name: 'Switch to light mode',
    });
    expect(darkButton.querySelector('.lucide-moon')).toBeTruthy();
    expect(window.localStorage.getItem('ai-clip-memory-theme')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');

    fireEvent.click(darkButton);
    expect(
      screen
        .getByRole('button', { name: 'Switch to dark mode' })
        .querySelector('.lucide-sun'),
    ).toBeTruthy();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem('ai-clip-memory-theme')).toBe('light');
  });

  test.each([
    ['light', 'Switch to dark mode', 'lucide-sun'],
    ['dark', 'Switch to light mode', 'lucide-moon'],
  ] as const)(
    'restores a persisted %s preference',
    async (mode, accessibleName, iconClass) => {
      window.localStorage.setItem('ai-clip-memory-theme', mode);
      render(<App client={fakeClient().client} />);
      await waitForCalendar();

      const button = screen.getByRole('button', { name: accessibleName });
      expect(button.querySelector(`.${iconClass}`)).toBeTruthy();
      expect(document.documentElement.dataset.theme).toBe(mode);
    },
  );

  test('resolves a persisted System preference once without exposing a third mode', async () => {
    window.localStorage.setItem('ai-clip-memory-theme', 'system');
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      ...window.matchMedia('(prefers-color-scheme: dark)'),
      matches: true,
    });

    render(<App client={fakeClient().client} />);
    await waitForCalendar();

    expect(
      screen
        .getByRole('button', { name: 'Switch to light mode' })
        .querySelector('.lucide-moon'),
    ).toBeTruthy();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem('ai-clip-memory-theme')).toBe('dark');
    expect(screen.queryByText('System')).toBeNull();
  });

  test('renders Refresh as an accessible icon-only action and keeps its behavior', async () => {
    const fake = fakeClient();
    render(<App client={fake.client} />);
    await waitForCalendar();

    const refresh = screen.getByRole('button', { name: 'Refresh' });
    expect(refresh.querySelector('.lucide-refresh-cw')).toBeTruthy();
    expect(refresh.textContent).toBe('');
    fireEvent.click(refresh);
    await waitFor(() => expect(fake.list).toHaveBeenCalledTimes(2));
  });

  test('combines multi-term search and type filtering without changing counts', async () => {
    const fake = fakeClient([firstClip, pinnedClip]);
    render(<App client={fake.client} />);
    expect(screen.getByRole('combobox', { name: 'Filter clips' })).toBeTruthy();
    await waitForCalendar();
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'CHATGPT unions' },
    });
    expect(
      screen.getByText(pinnedClip.title!, {
        selector: '.memory-calendar-clip-label',
      }),
    ).toBeTruthy();
    expect(
      screen
        .getByLabelText('All Clips results')
        .querySelectorAll('.clip-list-item'),
    ).toHaveLength(1);
    const all = screen
      .getByRole('button', { name: 'All Clips' })
      .closest<HTMLElement>('[data-slot="sidebar-menu-item"]')!;
    expect(within(all).getByText('2')).toBeTruthy();
    fireEvent.click(screen.getByRole('combobox', { name: 'Filter clips' }));
    fireEvent.keyDown(screen.getByRole('option', { name: 'Text' }), {
      key: 'Enter',
    });
    expect(screen.getByText('No matching clips.')).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: currentMonthLabel }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(
      screen
        .getByLabelText('All Clips results')
        .querySelectorAll('.clip-list-item'),
    ).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Pinned' }));
    expect(
      screen.getByText(pinnedClip.title!, {
        selector: '.memory-calendar-clip-label',
      }),
    ).toBeTruthy();
    expect(
      screen.queryByText(firstClip.title!, {
        selector: '.memory-calendar-clip-label',
      }),
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
    await openClipFromSidebar(firstClip);
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
    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(retry.closest('.empty-state')).not.toBeNull();
    expect(document.querySelector('.load-error')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'No clips yet' })).toBeNull();
    expect(screen.queryByText('private path')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitForCalendar();
    expect(
      screen.getByText(firstClip.content, { selector: '.clip-list-preview' }),
    ).toBeTruthy();
  });

  test('keeps the calendar shell visible when filters have no results', async () => {
    render(<App client={fakeClient([firstClip]).client} />);
    await waitForCalendar();

    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'missing' },
    });
    expect(screen.getByText('No matching clips.')).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: currentMonthLabel }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    fireEvent.click(screen.getByRole('combobox', { name: 'Filter clips' }));
    fireEvent.keyDown(screen.getByRole('option', { name: 'Code' }), {
      key: 'Enter',
    });
    expect(screen.getByText('No matching clips.')).toBeTruthy();

    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'missing' },
    });
    expect(screen.getByText('No matching clips.')).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: currentMonthLabel }),
    ).toBeTruthy();
  });

  test('refresh failure preserves the library and remains retryable', async () => {
    const fake = fakeClient([firstClip]);
    fake.list
      .mockResolvedValueOnce([firstClip])
      .mockRejectedValueOnce(new Error('private'));
    render(<App client={fake.client} />);
    await waitForCalendar();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByRole('button', { name: 'Retry' });
    expect(
      screen.getByText(firstClip.content, { selector: '.clip-list-preview' }),
    ).toBeTruthy();
  });

  test('supports app search, result focus and copy shortcuts with editable/dialog guards', async () => {
    const fake = fakeClient([firstClip, pinnedClip]);
    render(<App client={fake.client} />);
    await openClipFromSidebar(firstClip);
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

  test('shows the calendar and sidebar empty guidance after loading an empty database', async () => {
    const { client } = fakeClient();
    render(<App client={client} />);

    expect(await waitForCalendar()).toBeTruthy();
    expect(screen.getByText('No clips yet.')).toBeTruthy();
  });

  test('keeps local status in the sidebar and places primary controls in the main toolbar', async () => {
    const { client } = fakeClient();
    render(<App client={client} />);
    await waitForCalendar();

    const sidebar = screen
      .getByRole('navigation', { name: 'Clip library' })
      .closest<HTMLElement>('[data-slot="sidebar"]');

    expect(sidebar).not.toBeNull();
    expect(within(sidebar!).getByText('Local only')).toBeTruthy();
    expect(
      within(sidebar!).queryByRole('searchbox', { name: 'Search clips' }),
    ).toBeNull();
    expect(
      within(sidebar!).queryByRole('button', { name: 'New clip' }),
    ).toBeNull();

    const toolbar = document.querySelector<HTMLElement>('.desktop-header');
    expect(toolbar).not.toBeNull();
    expect(
      within(toolbar!).getByRole('searchbox', { name: 'Search clips' }),
    ).toBeTruthy();
    expect(
      within(toolbar!).getByRole('searchbox', { name: 'Search clips' })
        .className,
    ).toContain('h-7');
    expect(
      within(toolbar!).getByRole('button', { name: 'New clip' }),
    ).toBeTruthy();
  });

  test('uses the main toolbar for retrieval controls without redundant view copy', async () => {
    render(<App client={fakeClient().client} />);
    await waitForCalendar();

    const toolbar = document.querySelector<HTMLElement>('.desktop-header');
    expect(toolbar).not.toBeNull();
    const filter = within(toolbar!).getByRole('combobox', {
      name: 'Filter clips',
    });
    const search = within(toolbar!).getByRole('searchbox', {
      name: 'Search clips',
    });
    const create = within(toolbar!).getByRole('button', { name: 'New clip' });
    const theme = within(toolbar!).getByRole('button', {
      name: /Switch to (?:light|dark) mode/,
    });
    const refresh = within(toolbar!).getByRole('button', { name: 'Refresh' });
    for (const [before, after] of [
      [filter, search],
      [search, create],
      [create, theme],
      [theme, refresh],
    ] as const) {
      expect(
        before.compareDocumentPosition(after) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    expect(within(toolbar!).queryByText('Library')).toBeNull();
    expect(within(toolbar!).queryByText('0 results')).toBeNull();
    const sidebar = screen
      .getByRole('navigation', { name: 'Clip library' })
      .closest<HTMLElement>('[data-slot="sidebar"]')!;
    expect(within(sidebar).queryByText('0 results')).toBeNull();
    expect(
      screen.queryByRole('heading', { name: 'All Clips', level: 1 }),
    ).toBeNull();
    expect(screen.queryByText('Your saved clips, newest first.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Pinned' }));
    expect(
      screen.queryByRole('heading', { name: 'Pinned', level: 1 }),
    ).toBeNull();
    expect(
      screen.queryByText('Keep frequently used clips within easy reach.'),
    ).toBeNull();
  });

  test('renders clips, real counts, and the selected clip detail', async () => {
    const { client } = fakeClient([firstClip, pinnedClip]);
    render(<App client={client} />);

    expect(await waitForCalendar()).toBeTruthy();
    expect(
      screen.queryByText(firstClip.content, { selector: '.clip-content' }),
    ).toBeNull();
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

    const sidebar = allClipsItem!.closest<HTMLElement>(
      '[data-slot="sidebar"]',
    )!;
    const main = document.querySelector<HTMLElement>('.desktop-main')!;
    expect(within(sidebar).getByLabelText('All Clips results')).toBeTruthy();
    expect(
      within(sidebar).getByText(firstClip.content, {
        selector: '.clip-list-preview',
      }),
    ).toBeTruthy();
    expect(within(main).queryByLabelText('All Clips results')).toBeNull();

    fireEvent.click(
      within(sidebar)
        .getByText(pinnedClip.content, { selector: '.clip-list-preview' })
        .closest('button')!,
    );
    expect(
      within(main).getByRole('heading', { name: pinnedClip.title! }),
    ).toBeTruthy();

    expect(
      within(sidebar)
        .getByRole('navigation', { name: 'Clip library' })
        .querySelector('[data-slot="sidebar-menu"]')
        ?.classList.contains('sidebar-navigation-menu'),
    ).toBe(true);
  });

  test('browses clips through accessible accordion sections without clearing detail selection', async () => {
    render(<App client={fakeClient([firstClip, pinnedClip]).client} />);
    await openClipFromSidebar(firstClip);

    const all = screen.getByRole('button', { name: 'All Clips' });
    const pinned = screen.getByRole('button', { name: 'Pinned' });
    expect(all.getAttribute('aria-expanded')).toBe('true');
    expect(pinned.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByLabelText('All Clips results')).toBeTruthy();
    expect(screen.queryByLabelText('Pinned results')).toBeNull();

    fireEvent.click(all);
    expect(all.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('All Clips results')).toBeNull();
    expect(
      screen.getByRole('heading', { name: firstClip.title! }),
    ).toBeTruthy();

    fireEvent.click(pinned);
    expect(all.getAttribute('aria-expanded')).toBe('false');
    expect(pinned.getAttribute('aria-expanded')).toBe('true');
    const pinnedResults = screen.getByLabelText('Pinned results');
    expect(
      within(pinnedResults).getByText(pinnedClip.content, {
        selector: '.clip-list-preview',
      }),
    ).toBeTruthy();
    expect(
      within(pinnedResults).queryByText(firstClip.content, {
        selector: '.clip-list-preview',
      }),
    ).toBeNull();

    fireEvent.click(pinned);
    expect(pinned.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('Pinned results')).toBeNull();
    expect(
      screen.getByRole('heading', { name: firstClip.title! }),
    ).toBeTruthy();
  });

  test('restores the open library section after icon-collapse', async () => {
    render(<App client={fakeClient([firstClip, pinnedClip]).client} />);
    await openClipFromSidebar(firstClip);

    fireEvent.click(screen.getByRole('button', { name: 'Pinned' }));
    expect(screen.getByLabelText('Pinned results')).toBeTruthy();
    const toggle = screen.getByRole('button', { name: 'Toggle Sidebar' });
    fireEvent.click(toggle);
    expect(screen.queryByLabelText('Pinned results')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Pinned' }));
    fireEvent.click(toggle);
    expect(screen.getByLabelText('Pinned results')).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: firstClip.title! }),
    ).toBeTruthy();
  });

  test('filters the loaded list with case-insensitive substring search', async () => {
    const { client } = fakeClient([firstClip, pinnedClip]);
    render(<App client={client} />);
    await waitForCalendar();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search clips' }), {
      target: { value: 'TYPESCRIPT' },
    });

    const sidebar = screen
      .getByRole('navigation', { name: 'Clip library' })
      .closest<HTMLElement>('[data-slot="sidebar"]')!;
    expect(
      within(sidebar).getByText(pinnedClip.content, {
        selector: '.clip-list-preview',
      }),
    ).toBeTruthy();
    expect(
      within(sidebar).queryByText(firstClip.content, {
        selector: '.clip-list-preview',
      }),
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
    await waitForCalendar();

    fireEvent.click(screen.getByRole('button', { name: 'New clip' }));
    const dialog = screen.getByRole('dialog', { name: 'Create clip' });
    expect(dialog.textContent).toContain(
      'Add something useful to your local clip library.',
    );
    expect(dialog.textContent).not.toContain('editable clip fields');
    fireEvent.change(within(dialog).getByLabelText('Content'), {
      target: { value: created.content },
    });
    fireEvent.click(
      within(dialog).getByRole('combobox', { name: 'Content type' }),
    );
    fireEvent.click(screen.getByRole('option', { name: 'Prompt' }));
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
    await waitForCalendar();

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
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'New clip' }));
    expect(
      within(screen.getByRole('dialog', { name: 'Create clip' })).queryByRole(
        'alert',
      ),
    ).toBeNull();
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
    await openClipFromSidebar(firstClip);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit clip' });
    expect(dialog.textContent).toContain(
      'Update this clip while keeping it stored locally.',
    );
    fireEvent.click(
      within(dialog).getByRole('combobox', { name: 'Content type' }),
    );
    const contentTypePopup = screen
      .getByRole('listbox')
      .closest('[data-slot="select-content"]')!;
    expect(contentTypePopup.getAttribute('data-align-trigger')).toBe('false');
    expect(contentTypePopup.getAttribute('data-side')).toBe('bottom');
    fireEvent.keyDown(screen.getByRole('option', { name: 'Text' }), {
      key: 'Escape',
    });
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
    await waitForCalendar();

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
    await openClipFromSidebar(firstClip);

    const deleteButton = screen.getByRole('button', { name: 'Delete' });
    expect((deleteButton as HTMLButtonElement).disabled).toBe(false);
    expect(deleteButton.className).toContain('bg-destructive');
    expect(deleteButton.className).not.toContain('bg-destructive/10');
    fireEvent.click(deleteButton);
    const alert = screen.getByRole('alertdialog', { name: 'Delete clip?' });
    expect(alert.textContent).toContain('Local-first notes');
    const confirm = within(alert).getByRole('button', { name: 'Delete clip' });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    expect(confirm.className).toContain('bg-destructive');
    expect(confirm.className).not.toContain('bg-destructive/10');
    fireEvent.click(within(alert).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(fake.delete).not.toHaveBeenCalled();
  });

  test('deletes a selected clip into Calendar without selecting another clip', async () => {
    const fake = fakeClient([firstClip, pinnedClip]);
    render(<App client={fake.client} />);
    await openClipFromSidebar(firstClip);

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const alert = screen.getByRole('alertdialog', { name: 'Delete clip?' });
    fireEvent.click(within(alert).getByRole('button', { name: 'Delete clip' }));

    await waitFor(() => expect(fake.delete).toHaveBeenCalledWith(firstClip.id));
    expect(await waitForCalendar()).toBeTruthy();
    expect(
      screen.queryByRole('heading', { name: pinnedClip.title! }),
    ).toBeNull();
  });

  test('pins and unpins a clip', async () => {
    const fake = fakeClient([firstClip]);
    fake.setPinned
      .mockResolvedValueOnce({ ...firstClip, isPinned: true })
      .mockResolvedValueOnce(firstClip);
    render(<App client={fake.client} />);
    await openClipFromSidebar(firstClip);

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
    await openClipFromSidebar(firstClip);

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

    fireEvent.click(screen.getByRole('button', { name: 'Privacy & About' }));

    expect(
      screen.getByText(
        'Your clips are stored locally on this computer. No account or cloud connection is required.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Ctrl+Shift+Space')).toBeTruthy();
  });
});
