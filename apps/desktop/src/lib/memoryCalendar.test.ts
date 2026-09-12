import type { Clip } from '@ai-clip-memory/shared';
import { describe, expect, test } from 'vitest';

import {
  addCalendarMonths,
  buildMonthGrid,
  calendarMonthFromDate,
  calendarMonthFromTimestamp,
  getDayClipSummary,
  groupClipsByLocalDate,
  localDateKey,
} from './memoryCalendar';

const baseClip: Clip = {
  id: 'older',
  content: 'Older calendar memory',
  contentType: 'text',
  title: null,
  sourceApp: 'ChatGPT',
  sourceUrl: 'https://chatgpt.com/',
  sourcePageTitle: 'Calendar notes',
  isPinned: false,
  createdAt: '2026-09-02T01:00:00.000Z',
  updatedAt: '2026-09-02T01:00:00.000Z',
};

describe('memory calendar model', () => {
  test('builds a stable 42-cell Sunday-first grid including outside-month dates', () => {
    const cells = buildMonthGrid({ year: 2026, month: 8 });

    expect(cells).toHaveLength(42);
    expect(cells[0]).toMatchObject({
      key: '2026-08-30',
      day: 30,
      isCurrentMonth: false,
    });
    expect(cells[2]).toMatchObject({
      key: '2026-09-01',
      day: 1,
      isCurrentMonth: true,
    });
    expect(cells[41]).toMatchObject({
      key: '2026-10-10',
      day: 10,
      isCurrentMonth: false,
    });
  });

  test('keeps a six-row grid for a month that spans six calendar weeks', () => {
    const cells = buildMonthGrid({ year: 2026, month: 7 });

    expect(cells).toHaveLength(42);
    expect(cells[0]!.key).toBe('2026-07-26');
    expect(cells[41]!.key).toBe('2026-09-05');
  });

  test('moves backward and forward across year boundaries without mutating input', () => {
    const january = { year: 2026, month: 0 };
    const december = { year: 2026, month: 11 };

    expect(addCalendarMonths(january, -1)).toEqual({ year: 2025, month: 11 });
    expect(addCalendarMonths(december, 1)).toEqual({ year: 2027, month: 0 });
    expect(january).toEqual({ year: 2026, month: 0 });
    expect(december).toEqual({ year: 2026, month: 11 });
  });

  test('derives the current calendar month from a local Date', () => {
    expect(calendarMonthFromDate(new Date(2026, 8, 11, 14, 30))).toEqual({
      year: 2026,
      month: 8,
    });
  });

  test('derives a clip month through local-time timestamp conversion', () => {
    expect(
      calendarMonthFromTimestamp(
        '2026-09-01T01:00:00.000Z',
        'America/Los_Angeles',
      ),
    ).toEqual({ year: 2026, month: 7 });
    expect(calendarMonthFromTimestamp('not-a-date')).toBeNull();
  });

  test('groups UTC timestamps by their local calendar date without slicing UTC text', () => {
    expect(localDateKey(baseClip.createdAt, 'America/Los_Angeles')).toBe(
      '2026-09-01',
    );
    expect(localDateKey(baseClip.createdAt, 'Asia/Tokyo')).toBe('2026-09-02');

    const grouped = groupClipsByLocalDate([baseClip], 'America/Los_Angeles');
    expect(grouped.get('2026-09-01')).toEqual([baseClip]);
    expect(grouped.has('2026-09-02')).toBe(false);
  });

  test('omits invalid timestamps and sorts each day newest first with stable ID ties', () => {
    const newest: Clip = {
      ...baseClip,
      id: 'newest',
      createdAt: '2026-09-02T05:00:00.000Z',
    };
    const tiedFirst: Clip = { ...newest, id: 'a' };
    const invalid: Clip = {
      ...baseClip,
      id: 'invalid',
      createdAt: 'not-a-date',
    };

    expect(localDateKey(invalid.createdAt)).toBeNull();
    expect(
      groupClipsByLocalDate([baseClip, newest, invalid, tiedFirst], 'UTC')
        .get('2026-09-02')
        ?.map((clip) => clip.id),
    ).toEqual(['a', 'newest', 'older']);
  });

  test('shows at most two clips and reports the remaining count', () => {
    const clips = [
      baseClip,
      { ...baseClip, id: 'second' },
      { ...baseClip, id: 'third' },
      { ...baseClip, id: 'fourth' },
    ];

    expect(getDayClipSummary(clips)).toEqual({
      visibleClips: clips.slice(0, 2),
      overflowCount: 2,
    });
  });
});
