import type { Clip } from '@ai-clip-memory/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo } from 'react';

import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { displayTitle } from '../../lib/clipRetrieval';
import {
  addCalendarMonths,
  buildMonthGrid,
  calendarMonthFromDate,
  getDayClipSummary,
  groupClipsByLocalDate,
  type CalendarMonth,
} from '../../lib/memoryCalendar';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

interface MemoryCalendarProps {
  clips: Clip[];
  onActivateClip: (id: string, element: HTMLButtonElement) => void;
  visibleMonth: CalendarMonth;
  onVisibleMonthChange: (month: CalendarMonth) => void;
  today?: Date;
  timeZone?: string;
}

export function MemoryCalendar({
  clips,
  onActivateClip,
  visibleMonth,
  onVisibleMonthChange,
  today = new Date(),
  timeZone,
}: MemoryCalendarProps) {
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
                className="memory-calendar-day"
                role="gridcell"
                aria-label={fullDateFormatter.format(cell.date)}
                aria-current={cell.isToday ? 'date' : undefined}
                data-outside-month={cell.isCurrentMonth ? undefined : 'true'}
              >
                <span className="memory-calendar-day-number">{cell.day}</span>
                <div className="memory-calendar-clips">
                  {visibleClips.map((clip) => (
                    <button
                      key={clip.id}
                      id={calendarClipElementId(clip.id)}
                      type="button"
                      className="memory-calendar-clip"
                      title={displayTitle(clip)}
                      aria-label={`Open ${displayTitle(clip)}`}
                      onClick={(event) =>
                        onActivateClip(clip.id, event.currentTarget)
                      }
                      onKeyDown={(event) => {
                        if (
                          event.nativeEvent.isComposing ||
                          (event.key !== 'Enter' && event.key !== ' ')
                        )
                          return;
                        event.preventDefault();
                        onActivateClip(clip.id, event.currentTarget);
                      }}
                    >
                      {displayTitle(clip)}
                    </button>
                  ))}
                  {overflowCount > 0 && (
                    <button
                      className="memory-calendar-more"
                      type="button"
                      aria-label={`${overflowCount} more ${overflowCount === 1 ? 'clip' : 'clips'}`}
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
    </section>
  );
}

export function calendarClipElementId(id: string): string {
  return `calendar-clip-${id}`;
}
