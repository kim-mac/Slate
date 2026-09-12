import type { Clip } from '@ai-clip-memory/shared';

import { recentClips } from './clipRetrieval';

export interface CalendarMonth {
  year: number;
  month: number;
}

export interface CalendarDayCell {
  key: string;
  year: number;
  month: number;
  day: number;
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
}

function dateKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function calendarMonthFromDate(date: Date): CalendarMonth {
  return { year: date.getFullYear(), month: date.getMonth() };
}

export function calendarMonthFromTimestamp(
  timestamp: string,
  timeZone?: string,
): CalendarMonth | null {
  const key = localDateKey(timestamp, timeZone);
  if (!key) return null;
  const [year, month] = key.split('-').map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null;
  return { year: year!, month: month! - 1 };
}

export function addCalendarMonths(
  visibleMonth: CalendarMonth,
  amount: number,
): CalendarMonth {
  const normalized = new Date(
    visibleMonth.year,
    visibleMonth.month + amount,
    1,
  );
  return calendarMonthFromDate(normalized);
}

export function buildMonthGrid(
  visibleMonth: CalendarMonth,
  today = new Date(),
): CalendarDayCell[] {
  const firstDay = new Date(visibleMonth.year, visibleMonth.month, 1);
  const gridStart = new Date(
    visibleMonth.year,
    visibleMonth.month,
    1 - firstDay.getDay(),
  );
  const todayKey = dateKey(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(
      gridStart.getFullYear(),
      gridStart.getMonth(),
      gridStart.getDate() + index,
    );
    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();
    const key = dateKey(year, month, day);
    return {
      key,
      year,
      month,
      day,
      date,
      isCurrentMonth:
        year === visibleMonth.year && month === visibleMonth.month,
      isToday: key === todayKey,
    };
  });
}

export function localDateKey(
  timestamp: string,
  timeZone?: string,
): string | null {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;

  if (!timeZone) {
    return dateKey(date.getFullYear(), date.getMonth(), date.getDate());
  }

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(date);
    const year = Number(parts.find((part) => part.type === 'year')?.value);
    const month = Number(parts.find((part) => part.type === 'month')?.value);
    const day = Number(parts.find((part) => part.type === 'day')?.value);
    if (![year, month, day].every(Number.isInteger)) return null;
    return dateKey(year, month - 1, day);
  } catch {
    return null;
  }
}

export function groupClipsByLocalDate(
  clips: Clip[],
  timeZone?: string,
): Map<string, Clip[]> {
  const grouped = new Map<string, Clip[]>();
  for (const clip of recentClips(clips)) {
    const key = localDateKey(clip.createdAt, timeZone);
    if (!key) continue;
    const dayClips = grouped.get(key);
    if (dayClips) dayClips.push(clip);
    else grouped.set(key, [clip]);
  }
  return grouped;
}

export function getDayClipSummary(clips: Clip[]): {
  visibleClips: Clip[];
  overflowCount: number;
} {
  return {
    visibleClips: clips.slice(0, 2),
    overflowCount: Math.max(0, clips.length - 2),
  };
}
