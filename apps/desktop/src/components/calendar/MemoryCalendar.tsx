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
  visibleMonth: CalendarMonth;
  onVisibleMonthChange: (month: CalendarMonth) => void;
  today?: Date;
  timeZone?: string;
}

export function MemoryCalendar({
  clips,
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
        <h1 id="calendar-month-heading">{monthLabel}</h1>
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
                    <div
                      key={clip.id}
                      className="memory-calendar-clip"
                      title={displayTitle(clip)}
                    >
                      {displayTitle(clip)}
                    </div>
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
