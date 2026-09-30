import type { LibraryItem } from '@ai-clip-memory/shared';
import { useEffect, useRef } from 'react';

import { CalendarClipCard, type CalendarClipActions } from './CalendarClipCard';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { libraryItemId } from '@/lib/libraryItems';

interface CalendarDayDialogProps extends CalendarClipActions {
  clips: LibraryItem[];
  dateLabel: string;
  disabled?: boolean;
  focusOrigin: () => HTMLElement | null;
  onClose: () => void;
  onEditFromDialog: (clip: LibraryItem) => void;
  onOpenFromDialog: (clip: LibraryItem) => void;
  selectionMode?: boolean;
  selectedClipIds?: ReadonlySet<string> | undefined;
  sameSourceHintIds?: ReadonlySet<string> | undefined;
  onToggleSelection?: ((id: string) => void) | undefined;
}

export function CalendarDayDialog({
  clips,
  dateLabel,
  disabled = false,
  focusOrigin,
  onClose,
  onEditFromDialog,
  onOpenFromDialog,
  selectionMode = false,
  selectedClipIds,
  sameSourceHintIds,
  onToggleSelection,
  ...actions
}: CalendarDayDialogProps) {
  const previousClipIds = useRef(clips.map(libraryItemId));

  useEffect(() => {
    const currentIds = new Set(clips.map(libraryItemId));
    const resultDisappeared = previousClipIds.current.some(
      (id) => !currentIds.has(id),
    );
    previousClipIds.current = clips.map(libraryItemId);
    if (!resultDisappeared) return;

    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLElement &&
      activeElement !== document.body &&
      activeElement.isConnected
    )
      return;
    document
      .getElementById(calendarDayDialogClipElementId(libraryItemId(clips[0]!)))
      ?.focus();
  }, [clips]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="calendar-day-dialog sm:max-w-md"
        finalFocus={focusOrigin}
      >
        <DialogHeader>
          <DialogTitle>{dateLabel}</DialogTitle>
          <DialogDescription>
            {clips.length} matching {clips.length === 1 ? 'clip' : 'clips'}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="calendar-day-dialog-scroll">
          <div className="calendar-day-dialog-list">
            {clips.map((clip) => {
              const id = libraryItemId(clip);
              return (
                <CalendarClipCard
                  key={id}
                  clip={clip}
                  disabled={disabled}
                  primaryId={calendarDayDialogClipElementId(id)}
                  selectionMode={selectionMode}
                  selected={selectedClipIds?.has(id) ?? false}
                  sameSourceHint={sameSourceHintIds?.has(id) ?? false}
                  onToggleSelection={onToggleSelection}
                  {...actions}
                  onActivateClip={() => onOpenFromDialog(clip)}
                  onEditClip={() => onEditFromDialog(clip)}
                />
              );
            })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

export function calendarDayDialogClipElementId(id: string): string {
  return `calendar-day-dialog-clip-${id}`;
}
