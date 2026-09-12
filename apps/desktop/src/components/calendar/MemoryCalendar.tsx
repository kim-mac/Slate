import type { Clip } from '@ai-clip-memory/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { CalendarClipCard, type CalendarClipActions } from './CalendarClipCard';
import { CalendarDayDialog } from './CalendarDayDialog';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import {
  addCalendarMonths,
  buildMonthGrid,
  calendarMonthFromDate,
  getDayClipSummary,
  groupClipsByLocalDate,
  type CalendarMonth,
} from '../../lib/memoryCalendar';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

interface MemoryCalendarProps extends CalendarClipActions {
  actionsDisabled?: boolean;
  clips: Clip[];
  visibleMonth: CalendarMonth;
  onVisibleMonthChange: (month: CalendarMonth) => void;
  today?: Date;
  timeZone?: string;
}

export function MemoryCalendar({
  actionsDisabled = false,
  clips,
  onActivateClip,
  onCopyClip,
  onDeleteClip,
  onEditClip,
  onSetPinned,
  visibleMonth,
  onVisibleMonthChange,
  today = new Date(),
  timeZone,
}: MemoryCalendarProps) {
  const [activeDay, setActiveDay] = useState<{
    key: string;
    date: Date;
  } | null>(null);
  const pendingDayFocusKey = useRef<string | null>(null);
  const pendingCardFocus = useRef<{ clipId: string; dayKey: string } | null>(
    null,
  );
  const cells = useMemo(
    () => buildMonthGrid(visibleMonth, today),
    [today, visibleMonth],
  );
  const clipsByDay = useMemo(
    () => groupClipsByLocalDate(clips, timeZone),
    [clips, timeZone],
  );
  const monthLabel = new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
  }).format(new Date(visibleMonth.year, visibleMonth.month, 1));
  const fullDateFormatter = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const activeDayClips = activeDay ? (clipsByDay.get(activeDay.key) ?? []) : [];

  useEffect(() => {
    if (!activeDay || activeDayClips.length > 0) return;
    pendingDayFocusKey.current = activeDay.key;
    setActiveDay(null);
  }, [activeDay, activeDayClips.length]);

  useEffect(() => {
    if (activeDay || !pendingDayFocusKey.current) return;
    const key = pendingDayFocusKey.current;
    const more = document.getElementById(calendarMoreElementId(key));
    const day = document.getElementById(calendarDayCellElementId(key));
    (more?.isConnected ? more : day)?.focus();
    pendingDayFocusKey.current = null;
  }, [activeDay]);

  function dayFocusOrigin(key: string): HTMLElement | null {
    const more = document.getElementById(calendarMoreElementId(key));
    if (more?.isConnected) return more;
    return (
      document.getElementById(calendarDayCellElementId(key)) ??
      document.getElementById('calendar-month-heading')
    );
  }

  function closeActiveDay() {
    if (!activeDay) return;
    pendingDayFocusKey.current = activeDay.key;
    setActiveDay(null);
  }

  useEffect(() => {
    const pending = pendingCardFocus.current;
    if (!pending) return;
    if (clips.some((clip) => clip.id === pending.clipId)) {
      pendingCardFocus.current = null;
      return;
    }
    pendingCardFocus.current = null;
    dayFocusOrigin(pending.dayKey)?.focus();
  }, [clips]);

  return (
    <section
      className="memory-calendar"
      aria-labelledby="calendar-month-heading"
    >
      <header className="memory-calendar-header">
        <div className="memory-calendar-controls">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Previous month"
            onClick={() =>
              onVisibleMonthChange(addCalendarMonths(visibleMonth, -1))
            }
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Next month"
            onClick={() =>
              onVisibleMonthChange(addCalendarMonths(visibleMonth, 1))
            }
          >
            <ChevronRight aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onVisibleMonthChange(calendarMonthFromDate(today))}
          >
            Today
          </Button>
        </div>
        <h1 id="calendar-month-heading" tabIndex={-1}>
          {monthLabel}
        </h1>
      </header>

      <div className="memory-calendar-weekdays" role="row">
        {WEEKDAYS.map((weekday) => (
          <div key={weekday} role="columnheader">
            {weekday}
          </div>
        ))}
      </div>

      <ScrollArea className="memory-calendar-scroll">
        <div
          className="memory-calendar-grid"
          role="grid"
          aria-label={monthLabel}
        >
          {cells.map((cell) => {
            const dayClips = clipsByDay.get(cell.key) ?? [];
            const { visibleClips, overflowCount } = getDayClipSummary(dayClips);
            return (
              <div
                key={cell.key}
                id={calendarDayCellElementId(cell.key)}
                className="memory-calendar-day"
                role="gridcell"
                tabIndex={-1}
                aria-label={fullDateFormatter.format(cell.date)}
                aria-current={cell.isToday ? 'date' : undefined}
                data-outside-month={cell.isCurrentMonth ? undefined : 'true'}
              >
                <span className="memory-calendar-day-number">{cell.day}</span>
                <div className="memory-calendar-clips">
                  {visibleClips.map((clip) => (
                    <CalendarClipCard
                      key={clip.id}
                      clip={clip}
                      disabled={actionsDisabled}
                      primaryId={calendarClipElementId(clip.id)}
                      onActivateClip={onActivateClip}
                      onCopyClip={onCopyClip}
                      onDeleteClip={onDeleteClip}
                      onEditClip={onEditClip}
                      onFocusClip={(candidate) => {
                        pendingCardFocus.current = {
                          clipId: candidate.id,
                          dayKey: cell.key,
                        };
                      }}
                      onSetPinned={onSetPinned}
                    />
                  ))}
                  {overflowCount > 0 && (
                    <button
                      id={calendarMoreElementId(cell.key)}
                      className="memory-calendar-more"
                      type="button"
                      aria-label={`Show ${overflowCount} more ${overflowCount === 1 ? 'clip' : 'clips'} for ${fullDateFormatter.format(cell.date)}`}
                      onClick={() =>
                        setActiveDay({ key: cell.key, date: cell.date })
                      }
                    >
                      +{overflowCount} more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {activeDay && activeDayClips.length > 0 && (
        <CalendarDayDialog
          clips={activeDayClips}
          dateLabel={fullDateFormatter.format(activeDay.date)}
          disabled={actionsDisabled}
          focusOrigin={() => dayFocusOrigin(activeDay.key)}
          onClose={closeActiveDay}
          onActivateClip={onActivateClip}
          onCopyClip={onCopyClip}
          onDeleteClip={onDeleteClip}
          onEditClip={onEditClip}
          onSetPinned={onSetPinned}
          onOpenFromDialog={(clip) => {
            const origin = dayFocusOrigin(activeDay.key);
            setActiveDay(null);
            onActivateClip(
              clip.id,
              origin ?? document.getElementById('calendar-month-heading')!,
            );
          }}
          onEditFromDialog={(clip) => {
            setActiveDay(null);
            onEditClip(clip);
          }}
        />
      )}
    </section>
  );
}

export function calendarClipElementId(id: string): string {
  return `calendar-clip-${id}`;
}

export function calendarMoreElementId(key: string): string {
  return `calendar-more-${key}`;
}

export function calendarDayCellElementId(key: string): string {
  return `calendar-day-${key}`;
}
