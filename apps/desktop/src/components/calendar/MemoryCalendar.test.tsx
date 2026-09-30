import type { Clip, LibraryItem } from '@ai-clip-memory/shared';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

import { MemoryCalendar } from './MemoryCalendar';

const OVERFLOW_BUTTON_NAME = 'Show 1 more clip for Friday, September 11, 2026';

function calendarActions() {
  return {
    onActivateClip: vi.fn(),
    onCopyClip: vi.fn(),
    onDeleteClip: vi.fn(),
    onEditClip: vi.fn(),
    onSetPinned: vi.fn(),
  };
}

const clips: Clip[] = [
  {
    id: 'one',
    content: 'First memory',
    contentType: 'text',
    title: 'A very long memory title that must remain bounded inside its day',
    sourceApp: 'ChatGPT',
    sourceUrl: 'https://chatgpt.com/',
    sourcePageTitle: 'ChatGPT',
    isPinned: true,
    createdAt: '2026-09-11T18:00:00.000Z',
    updatedAt: '2026-09-11T18:00:00.000Z',
  },
  {
    id: 'two',
    content: 'Second memory',
    contentType: 'code',
    title: null,
    sourceApp: 'Cursor',
    sourceUrl: null,
    sourcePageTitle: null,
    isPinned: false,
    createdAt: '2026-09-11T17:00:00.000Z',
    updatedAt: '2026-09-11T17:00:00.000Z',
  },
  {
    id: 'three',
    content: 'Third memory',
    contentType: 'prompt',
    title: 'Third',
    sourceApp: 'Claude',
    sourceUrl: 'https://claude.ai/',
    sourcePageTitle: 'Claude',
    isPinned: false,
    createdAt: '2026-09-11T16:00:00.000Z',
    updatedAt: '2026-09-11T16:00:00.000Z',
  },
];

afterEach(cleanup);

test('places a merged group by its own creation date and shows it once', () => {
  const groupItem: LibraryItem = {
    kind: 'group',
    group: {
      id: 'group-one',
      title: 'Merged research',
      isPinned: false,
      createdAt: '2026-09-12T18:00:00.000Z',
      updatedAt: '2026-09-12T18:00:00.000Z',
      members: clips.slice(0, 2),
    },
  };
  render(
    <MemoryCalendar
      clips={[groupItem]}
      visibleMonth={{ year: 2026, month: 8 }}
      onVisibleMonthChange={vi.fn()}
      {...calendarActions()}
      today={new Date(2026, 8, 11, 12)}
      timeZone="UTC"
    />,
  );
  const day = screen.getByRole('gridcell', {
    name: /Saturday, September 12, 2026/i,
  });
  expect(
    within(day).getByRole('button', { name: 'Open Merged research' }),
  ).toBeTruthy();
  expect(
    screen.getAllByRole('button', { name: 'Open Merged research' }),
  ).toHaveLength(1);
});

test('renders the month shell, weekday labels, outside dates, and two-item overflow', () => {
  const actions = calendarActions();
  render(
    <MemoryCalendar
      clips={clips}
      visibleMonth={{ year: 2026, month: 8 }}
      onVisibleMonthChange={vi.fn()}
      {...actions}
      today={new Date(2026, 8, 11, 12)}
      timeZone="UTC"
    />,
  );

  expect(
    screen.getByRole('heading', { name: '11 September 2026' }),
  ).toBeTruthy();
  expect(
    screen.getAllByRole('columnheader').map((item) => item.textContent),
  ).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  expect(screen.getAllByRole('gridcell')).toHaveLength(42);
  const septemberEleventh = screen.getByRole('gridcell', {
    name: /Friday, September 11, 2026/i,
  });
  expect(
    within(septemberEleventh)
      .getByText(clips[0]!.title!)
      .classList.contains('memory-calendar-clip-label'),
  ).toBe(true);
  expect(within(septemberEleventh).getByText('Second memory')).toBeTruthy();
  expect(within(septemberEleventh).queryByText('Third')).toBeNull();
  expect(
    within(septemberEleventh).getByRole('button', {
      name: OVERFLOW_BUTTON_NAME,
    }),
  ).toBeTruthy();
  const clipButton = within(septemberEleventh).getByRole('button', {
    name: `Open ${clips[0]!.title!}`,
  });
  fireEvent.click(clipButton);
  expect(actions.onActivateClip).toHaveBeenLastCalledWith(
    clips[0]!.id,
    clipButton,
  );
  expect(
    screen.getByRole('gridcell', { name: /Sunday, August 30, 2026/i }).dataset
      .outsideMonth,
  ).toBe('true');
});

function CalendarHeadingHarness() {
  const [visibleMonth, setVisibleMonth] = useState({ year: 2026, month: 8 });

  return (
    <MemoryCalendar
      clips={[]}
      visibleMonth={visibleMonth}
      onVisibleMonthChange={setVisibleMonth}
      {...calendarActions()}
      today={new Date(2026, 8, 16, 12)}
    />
  );
}

test('shows the full local date for the current month and month-year elsewhere', () => {
  render(<CalendarHeadingHarness />);

  expect(
    screen.getByRole('heading', { name: '16 September 2026' }),
  ).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
  expect(screen.getByRole('heading', { name: 'October 2026' })).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Today' }));
  expect(
    screen.getByRole('heading', { name: '16 September 2026' }),
  ).toBeTruthy();
});

test('places the supplied Filter control after Today with a separator', () => {
  const { container } = render(
    <MemoryCalendar
      clips={[]}
      visibleMonth={{ year: 2026, month: 8 }}
      onVisibleMonthChange={vi.fn()}
      {...calendarActions()}
      today={new Date(2026, 8, 16, 12)}
      headerControl={<button aria-label="Filter clips">Filter</button>}
    />,
  );
  const controls = container.querySelector<HTMLElement>(
    '.memory-calendar-controls',
  )!;
  const today = within(controls).getByRole('button', { name: 'Today' });
  const separator = within(controls).getByRole('separator');
  const filter = within(controls).getByRole('button', { name: 'Filter clips' });

  expect(separator.classList.contains('mx-1')).toBe(true);
  expect(separator.classList.contains('data-vertical:self-center')).toBe(true);
  expect(separator.classList.contains('data-vertical:self-auto')).toBe(false);
  expect(
    today.compareDocumentPosition(separator) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    separator.compareDocumentPosition(filter) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

test('moves to previous, next, and current months through controlled callbacks', () => {
  const onVisibleMonthChange = vi.fn();
  render(
    <MemoryCalendar
      clips={[]}
      visibleMonth={{ year: 2026, month: 0 }}
      onVisibleMonthChange={onVisibleMonthChange}
      {...calendarActions()}
      today={new Date(2026, 8, 11, 12)}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
  fireEvent.click(screen.getByRole('button', { name: 'Today' }));

  expect(onVisibleMonthChange.mock.calls).toEqual([
    [{ year: 2025, month: 11 }],
    [{ year: 2026, month: 1 }],
    [{ year: 2026, month: 8 }],
  ]);
});

test.each(['Enter', ' '])(
  'activates a focused calendar clip with the %s key',
  (key) => {
    const onActivateClip = vi.fn();
    render(
      <MemoryCalendar
        clips={clips.slice(0, 1)}
        visibleMonth={{ year: 2026, month: 8 }}
        onVisibleMonthChange={vi.fn()}
        {...calendarActions()}
        onActivateClip={onActivateClip}
        today={new Date(2026, 8, 11, 12)}
        timeZone="UTC"
      />,
    );
    const clipButton = screen.getByRole('button', {
      name: `Open ${clips[0]!.title!}`,
    });

    clipButton.focus();
    fireEvent.keyDown(clipButton, { key });

    expect(onActivateClip).toHaveBeenCalledWith(clips[0]!.id, clipButton);
  },
);

test('keeps the clip control and actions trigger as siblings and previews without accidental activation', () => {
  const actions = calendarActions();
  render(
    <MemoryCalendar
      clips={clips.slice(0, 1)}
      visibleMonth={{ year: 2026, month: 8 }}
      onVisibleMonthChange={vi.fn()}
      {...actions}
      today={new Date(2026, 8, 11, 12)}
      timeZone="UTC"
    />,
  );
  const title = clips[0]!.title!;
  const open = screen.getByRole('button', { name: `Open ${title}` });
  const trigger = screen.getByRole('button', { name: `Actions for ${title}` });

  expect(open.parentElement).toBe(trigger.parentElement);
  fireEvent.click(trigger);
  expect(actions.onActivateClip).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Preview' }));

  expect(actions.onActivateClip).toHaveBeenCalledWith(clips[0]!.id, open);
});

test.each([
  ['Copy', 'onCopyClip'],
  ['Edit', 'onEditClip'],
  ['Delete', 'onDeleteClip'],
] as const)(
  'routes the %s menu action through its callback',
  (label, callback) => {
    const actions = calendarActions();
    render(
      <MemoryCalendar
        clips={clips.slice(0, 1)}
        visibleMonth={{ year: 2026, month: 8 }}
        onVisibleMonthChange={vi.fn()}
        {...actions}
        today={new Date(2026, 8, 11, 12)}
        timeZone="UTC"
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: `Actions for ${clips[0]!.title!}` }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: label }));

    expect(actions[callback]).toHaveBeenCalledWith(clips[0]);
    expect(actions.onActivateClip).not.toHaveBeenCalled();
  },
);

test.each([
  [clips[0]!, 'Unpin', false],
  [clips[1]!, 'Pin', true],
] as const)(
  'routes %s state through the dynamic pin action',
  (clip, label, next) => {
    const actions = calendarActions();
    render(
      <MemoryCalendar
        clips={[clip]}
        visibleMonth={{ year: 2026, month: 8 }}
        onVisibleMonthChange={vi.fn()}
        {...actions}
        today={new Date(2026, 8, 11, 12)}
        timeZone="UTC"
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: `Actions for ${clip.title ?? clip.content}`,
      }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: label }));

    expect(actions.onSetPinned).toHaveBeenCalledWith(clip, next);
  },
);

test('closes an action menu with Escape and restores its trigger focus', () => {
  const actions = calendarActions();
  render(
    <MemoryCalendar
      clips={clips.slice(0, 1)}
      visibleMonth={{ year: 2026, month: 8 }}
      onVisibleMonthChange={vi.fn()}
      {...actions}
      today={new Date(2026, 8, 11, 12)}
      timeZone="UTC"
    />,
  );
  const trigger = screen.getByRole('button', {
    name: `Actions for ${clips[0]!.title!}`,
  });
  trigger.focus();
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Preview' }), {
    key: 'Escape',
  });

  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

test('opens a bounded day dialog with every supplied clip in newest-first order', () => {
  const actions = calendarActions();
  render(
    <MemoryCalendar
      clips={clips}
      visibleMonth={{ year: 2026, month: 8 }}
      onVisibleMonthChange={vi.fn()}
      {...actions}
      today={new Date(2026, 8, 11, 12)}
      timeZone="UTC"
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: OVERFLOW_BUTTON_NAME }));
  const dialog = screen.getByRole('dialog', {
    name: 'Friday, September 11, 2026',
  });
  expect(dialog.className).toContain('calendar-day-dialog');
  expect(within(dialog).getByText('3 matching clips')).toBeTruthy();
  expect(
    within(dialog)
      .getAllByRole('button', { name: /^Open / })
      .map((button) => button.textContent),
  ).toEqual([clips[0]!.title, clips[1]!.content, clips[2]!.title]);
});

test('routes day-dialog actions without opening Detail or closing for Copy', () => {
  const actions = calendarActions();
  render(
    <MemoryCalendar
      clips={clips}
      visibleMonth={{ year: 2026, month: 8 }}
      onVisibleMonthChange={vi.fn()}
      {...actions}
      today={new Date(2026, 8, 11, 12)}
      timeZone="UTC"
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: OVERFLOW_BUTTON_NAME }));
  const dialog = screen.getByRole('dialog');
  fireEvent.click(
    within(dialog).getByRole('button', {
      name: `Actions for ${clips[2]!.title!}`,
    }),
  );
  fireEvent.click(screen.getByRole('menuitem', { name: 'Copy' }));

  expect(actions.onCopyClip).toHaveBeenCalledWith(clips[2]);
  expect(actions.onActivateClip).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toBeTruthy();
});

test('opens Detail from a day-dialog Preview using the overflow control as its origin', () => {
  const actions = calendarActions();
  render(
    <MemoryCalendar
      clips={clips}
      visibleMonth={{ year: 2026, month: 8 }}
      onVisibleMonthChange={vi.fn()}
      {...actions}
      today={new Date(2026, 8, 11, 12)}
      timeZone="UTC"
    />,
  );
  const more = screen.getByRole('button', { name: OVERFLOW_BUTTON_NAME });
  fireEvent.click(more);
  const dialog = screen.getByRole('dialog');
  fireEvent.click(
    within(dialog).getByRole('button', {
      name: `Actions for ${clips[2]!.title!}`,
    }),
  );
  fireEvent.click(screen.getByRole('menuitem', { name: 'Preview' }));

  expect(actions.onActivateClip).toHaveBeenCalledWith(clips[2]!.id, more);
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('opens Detail when the day-dialog clip itself is activated', () => {
  const actions = calendarActions();
  render(
    <MemoryCalendar
      clips={clips}
      visibleMonth={{ year: 2026, month: 8 }}
      onVisibleMonthChange={vi.fn()}
      {...actions}
      today={new Date(2026, 8, 11, 12)}
      timeZone="UTC"
    />,
  );
  const more = screen.getByRole('button', { name: OVERFLOW_BUTTON_NAME });
  fireEvent.click(more);
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: `Open ${clips[2]!.title!}`,
    }),
  );

  expect(actions.onActivateClip).toHaveBeenCalledWith(clips[2]!.id, more);
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('closes the day dialog before routing Edit to the shared form flow', () => {
  const actions = calendarActions();
  render(
    <MemoryCalendar
      clips={clips}
      visibleMonth={{ year: 2026, month: 8 }}
      onVisibleMonthChange={vi.fn()}
      {...actions}
      today={new Date(2026, 8, 11, 12)}
      timeZone="UTC"
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: OVERFLOW_BUTTON_NAME }));
  const dialog = screen.getByRole('dialog');
  fireEvent.click(
    within(dialog).getByRole('button', {
      name: `Actions for ${clips[2]!.title!}`,
    }),
  );
  fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));

  expect(actions.onEditClip).toHaveBeenCalledWith(clips[2]);
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('keeps a day dialog coherent as its filtered clips change and closes safely when none remain', () => {
  const actions = calendarActions();
  const props = {
    visibleMonth: { year: 2026, month: 8 },
    onVisibleMonthChange: vi.fn(),
    ...actions,
    today: new Date(2026, 8, 11, 12),
    timeZone: 'UTC',
  };
  const { rerender } = render(<MemoryCalendar clips={clips} {...props} />);
  fireEvent.click(screen.getByRole('button', { name: OVERFLOW_BUTTON_NAME }));

  const dialog = screen.getByRole('dialog');
  fireEvent.click(
    within(dialog).getByRole('button', {
      name: `Actions for ${clips[2]!.title!}`,
    }),
  );
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
  expect(actions.onDeleteClip).toHaveBeenCalledWith(clips[2]);

  rerender(<MemoryCalendar clips={clips.slice(0, 2)} {...props} />);
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.getByText('2 matching clips')).toBeTruthy();

  rerender(<MemoryCalendar clips={[]} {...props} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(
    screen.getByRole('gridcell', { name: /Friday, September 11, 2026/i }),
  );
});

test('updates an open day dialog safely when unpinning removes a filtered clip', () => {
  const actions = calendarActions();
  const pinnedClips = clips.map((clip) => ({ ...clip, isPinned: true }));
  const props = {
    visibleMonth: { year: 2026, month: 8 },
    onVisibleMonthChange: vi.fn(),
    ...actions,
    today: new Date(2026, 8, 11, 12),
    timeZone: 'UTC',
  };
  const { rerender } = render(
    <MemoryCalendar clips={pinnedClips} {...props} />,
  );
  fireEvent.click(screen.getByRole('button', { name: OVERFLOW_BUTTON_NAME }));
  const dialog = screen.getByRole('dialog');
  fireEvent.click(
    within(dialog).getByRole('button', {
      name: `Actions for ${pinnedClips[2]!.title!}`,
    }),
  );
  fireEvent.click(screen.getByRole('menuitem', { name: 'Unpin' }));
  expect(actions.onSetPinned).toHaveBeenCalledWith(pinnedClips[2], false);

  rerender(<MemoryCalendar clips={pinnedClips.slice(0, 2)} {...props} />);
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.getByText('2 matching clips')).toBeTruthy();
});

test('restores +N more focus when the day dialog closes with Escape', () => {
  render(
    <MemoryCalendar
      clips={clips}
      visibleMonth={{ year: 2026, month: 8 }}
      onVisibleMonthChange={vi.fn()}
      {...calendarActions()}
      today={new Date(2026, 8, 11, 12)}
      timeZone="UTC"
    />,
  );
  const more = screen.getByRole('button', { name: OVERFLOW_BUTTON_NAME });
  fireEvent.click(more);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(more);
});

test('exposes pinned, today, and overflow context to assistive technology', () => {
  render(
    <MemoryCalendar
      clips={clips}
      visibleMonth={{ year: 2026, month: 8 }}
      onVisibleMonthChange={vi.fn()}
      {...calendarActions()}
      today={new Date(2026, 8, 11, 12)}
      timeZone="UTC"
    />,
  );

  const today = screen.getByRole('gridcell', {
    name: 'Friday, September 11, 2026',
  });
  expect(today.getAttribute('aria-current')).toBe('date');
  expect(
    within(today).getByRole('button', {
      name: `Open ${clips[0]!.title!}`,
      description: 'Pinned',
    }),
  ).toBeTruthy();
  expect(
    within(today).getByRole('button', {
      name: 'Show 1 more clip for Friday, September 11, 2026',
    }),
  ).toBeTruthy();
});

test('restores focus to the day cell when a calendar action removes its trigger', async () => {
  const actions = calendarActions();
  const pinnedClips = clips.map((clip) => ({ ...clip, isPinned: true }));
  const props = {
    visibleMonth: { year: 2026, month: 8 },
    onVisibleMonthChange: vi.fn(),
    ...actions,
    today: new Date(2026, 8, 11, 12),
    timeZone: 'UTC',
  };
  const { rerender } = render(
    <MemoryCalendar clips={pinnedClips} {...props} />,
  );
  const trigger = screen.getByRole('button', {
    name: `Actions for ${pinnedClips[0]!.title!}`,
  });
  trigger.focus();
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Unpin' }));

  rerender(<MemoryCalendar clips={pinnedClips.slice(1)} {...props} />);

  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('gridcell', {
        name: 'Friday, September 11, 2026',
      }),
    ),
  );
});

test('restores focus to the day cell when a focused calendar clip disappears', async () => {
  const actions = calendarActions();
  const props = {
    visibleMonth: { year: 2026, month: 8 },
    onVisibleMonthChange: vi.fn(),
    ...actions,
    today: new Date(2026, 8, 11, 12),
    timeZone: 'UTC',
  };
  const { rerender } = render(<MemoryCalendar clips={clips} {...props} />);
  screen.getByRole('button', { name: `Open ${clips[0]!.title!}` }).focus();

  rerender(<MemoryCalendar clips={clips.slice(1)} {...props} />);

  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('gridcell', {
        name: 'Friday, September 11, 2026',
      }),
    ),
  );
});

test('keeps focus in the day dialog when a focused result disappears', async () => {
  const actions = calendarActions();
  const props = {
    visibleMonth: { year: 2026, month: 8 },
    onVisibleMonthChange: vi.fn(),
    ...actions,
    today: new Date(2026, 8, 11, 12),
    timeZone: 'UTC',
  };
  const { rerender } = render(<MemoryCalendar clips={clips} {...props} />);
  fireEvent.click(screen.getByRole('button', { name: OVERFLOW_BUTTON_NAME }));
  const trigger = within(screen.getByRole('dialog')).getByRole('button', {
    name: `Actions for ${clips[2]!.title!}`,
  });
  trigger.focus();
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

  rerender(<MemoryCalendar clips={clips.slice(0, 2)} {...props} />);

  await waitFor(() =>
    expect(document.activeElement).toBe(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: `Open ${clips[0]!.title!}`,
        description: 'Pinned',
      }),
    ),
  );
});

test('falls back to the day cell when +N more disappears before dialog close', async () => {
  const actions = calendarActions();
  const props = {
    visibleMonth: { year: 2026, month: 8 },
    onVisibleMonthChange: vi.fn(),
    ...actions,
    today: new Date(2026, 8, 11, 12),
    timeZone: 'UTC',
  };
  const { rerender } = render(<MemoryCalendar clips={clips} {...props} />);
  fireEvent.click(screen.getByRole('button', { name: OVERFLOW_BUTTON_NAME }));
  rerender(<MemoryCalendar clips={clips.slice(0, 2)} {...props} />);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('gridcell', {
        name: 'Friday, September 11, 2026',
      }),
    ),
  );
});
