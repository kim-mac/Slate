import type { Clip, LibraryItem } from '@ai-clip-memory/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { CalendarClipCard, type CalendarClipActions } from './CalendarClipCard';
import { CalendarDayDialog } from './CalendarDayDialog';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { Separator } from '../ui/separator';
import {
  addCalendarMonths,
  buildMonthGrid,
  calendarMonthFromDate,
  getDayClipSummary,
  groupClipsByLocalDate,
  type CalendarMonth,
} from '../../lib/memoryCalendar';
import { asLibraryItem, libraryItemId } from '../../lib/libraryItems';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

interface MemoryCalendarProps extends Omit<
  CalendarClipActions,
  'onDeleteItem' | 'onSetItemPinned'
> {
  actionsDisabled?: boolean;
  clips: Array<LibraryItem | Clip>;
  headerControl?: ReactNode;
  visibleMonth: CalendarMonth;
  onVisibleMonthChange: (month: CalendarMonth) => void;
  today?: Date;
  timeZone?: string;
  selectionMode?: boolean;
  selectedClipIds?: ReadonlySet<string>;
  sameSourceHintIds?: ReadonlySet<string>;
  onToggleSelection?: (id: string) => void;
  onDeleteItem?: CalendarClipActions['onDeleteItem'];
  onSetItemPinned?: CalendarClipActions['onSetItemPinned'];
  onDeleteClip?: (clip: Clip) => void;
  onSetPinned?: (clip: Clip, isPinned: boolean) => void;
}

export function MemoryCalendar({
  actionsDisabled = false,
  clips,
  headerControl,
  onActivateClip,
  onCopyClip,
  onDeleteItem,
  onDeleteClip,
  onEditClip,
  onSetItemPinned,
  onSetPinned,
  visibleMonth,
  onVisibleMonthChange,
  today = new Date(),
  timeZone,
  selectionMode = false,
  selectedClipIds,
  sameSourceHintIds,
  onToggleSelection,
}: MemoryCalendarProps) {
  const deleteItem =
    onDeleteItem ??
    ((item: LibraryItem) => {
      if (item.kind === 'clip') onDeleteClip?.(item.clip);
    });
  const setItemPinned =
    onSetItemPinned ??
    ((item: LibraryItem, pinned: boolean) => {
      if (item.kind === 'clip') onSetPinned?.(item.clip, pinned);
    });
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
    () => groupClipsByLocalDate(clips.map(asLibraryItem), timeZone),
    [clips, timeZone],
  );
  const currentMonth = calendarMonthFromDate(today);
  const isCurrentMonth =
    visibleMonth.year === currentMonth.year &&
    visibleMonth.month === currentMonth.month;
  const currentDateParts = new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).formatToParts(today);
  const currentDatePart = (type: 'day' | 'month' | 'year') =>
    currentDateParts.find((part) => part.type === type)?.value ?? '';
  const monthLabel = isCurrentMonth
    ? `${currentDatePart('day')} ${currentDatePart('month')} ${currentDatePart('year')}`
    : new Intl.DateTimeFormat(undefined, {
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
    if (
      clips.some(
        (clip) => libraryItemId(asLibraryItem(clip)) === pending.clipId,
      )
    ) {
      pendingCardFocus.current = null;
      return;
    }
    pendingCardFocus.current = null;
    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLElement &&
      activeElement !== document.body &&
      activeElement.isConnected
    )
      return;
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
          {headerControl && (
            <>
              <Separator
                orientation="vertical"
                className="mx-1 data-vertical:h-4 data-vertical:self-center"
              />
              {headerControl}
            </>
          )}
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
                  {visibleClips.map((clip) => {
                    const id = libraryItemId(clip);
                    return (
                      <CalendarClipCard
                        key={id}
                        clip={clip}
                        disabled={actionsDisabled}
                        primaryId={calendarClipElementId(id)}
                        selectionMode={selectionMode}
                        selected={selectedClipIds?.has(id) ?? false}
                        sameSourceHint={sameSourceHintIds?.has(id) ?? false}
                        onToggleSelection={onToggleSelection}
                        onActivateClip={onActivateClip}
                        onCopyClip={onCopyClip}
                        onDeleteItem={deleteItem}
                        onEditClip={onEditClip}
                        onFocusClip={(candidate) => {
                          pendingCardFocus.current = {
                            clipId: libraryItemId(candidate),
                            dayKey: cell.key,
                          };
                        }}
                        onSetItemPinned={setItemPinned}
                      />
                    );
                  })}
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
          selectionMode={selectionMode}
          selectedClipIds={selectedClipIds}
          sameSourceHintIds={sameSourceHintIds}
          onToggleSelection={onToggleSelection}
          onActivateClip={onActivateClip}
          onCopyClip={onCopyClip}
          onDeleteItem={deleteItem}
          onEditClip={onEditClip}
          onSetItemPinned={setItemPinned}
          onOpenFromDialog={(clip) => {
            const origin = dayFocusOrigin(activeDay.key);
            setActiveDay(null);
            onActivateClip(
              libraryItemId(clip),
              origin ?? document.getElementById('calendar-month-heading')!,
            );
          }}
          onEditFromDialog={(clip) => {
            setActiveDay(null);
            if (clip.kind === 'clip') onEditClip(clip.clip);
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
