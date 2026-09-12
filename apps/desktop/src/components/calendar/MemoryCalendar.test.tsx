import type { Clip } from '@ai-clip-memory/shared';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { MemoryCalendar } from './MemoryCalendar';

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

test('renders the month shell, weekday labels, outside dates, and two-item overflow', () => {
  render(
    <MemoryCalendar
      clips={clips}
      visibleMonth={{ year: 2026, month: 8 }}
      onVisibleMonthChange={vi.fn()}
      today={new Date(2026, 8, 11, 12)}
      timeZone="UTC"
    />,
  );

  expect(screen.getByRole('heading', { name: 'September 2026' })).toBeTruthy();
  expect(
    screen.getAllByRole('columnheader').map((item) => item.textContent),
  ).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  expect(screen.getAllByRole('gridcell')).toHaveLength(42);
  const septemberEleventh = screen.getByRole('gridcell', {
    name: /Friday, September 11, 2026/i,
  });
  expect(within(septemberEleventh).getByText(clips[0]!.title!)).toBeTruthy();
  expect(within(septemberEleventh).getByText('Second memory')).toBeTruthy();
  expect(within(septemberEleventh).queryByText('Third')).toBeNull();
  expect(
    within(septemberEleventh).getByRole('button', { name: '1 more clip' }),
  ).toBeTruthy();
  expect(
    screen.getByRole('gridcell', { name: /Sunday, August 30, 2026/i }).dataset
      .outsideMonth,
  ).toBe('true');
});

test('moves to previous, next, and current months through controlled callbacks', () => {
  const onVisibleMonthChange = vi.fn();
  render(
    <MemoryCalendar
      clips={[]}
      visibleMonth={{ year: 2026, month: 0 }}
      onVisibleMonthChange={onVisibleMonthChange}
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
