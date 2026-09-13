import type { Clip } from '@ai-clip-memory/shared';
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

interface CalendarDayDialogProps extends CalendarClipActions {
  clips: Clip[];
  dateLabel: string;
  disabled?: boolean;
  focusOrigin: () => HTMLElement | null;
  onClose: () => void;
  onEditFromDialog: (clip: Clip) => void;
  onOpenFromDialog: (clip: Clip) => void;
}

export function CalendarDayDialog({
  clips,
  dateLabel,
  disabled = false,
  focusOrigin,
  onClose,
  onEditFromDialog,
  onOpenFromDialog,
  ...actions
}: CalendarDayDialogProps) {
  const previousClipIds = useRef(clips.map((clip) => clip.id));

  useEffect(() => {
    const currentIds = new Set(clips.map((clip) => clip.id));
    const resultDisappeared = previousClipIds.current.some(
      (id) => !currentIds.has(id),
    );
    previousClipIds.current = clips.map((clip) => clip.id);
    if (!resultDisappeared) return;

    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLElement &&
      activeElement !== document.body &&
      activeElement.isConnected
    )
      return;
    document
      .getElementById(calendarDayDialogClipElementId(clips[0]!.id))
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
            {clips.map((clip) => (
              <CalendarClipCard
                key={clip.id}
                clip={clip}
                disabled={disabled}
                primaryId={calendarDayDialogClipElementId(clip.id)}
                {...actions}
                onActivateClip={() => onOpenFromDialog(clip)}
                onEditClip={() => onEditFromDialog(clip)}
              />
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

export function calendarDayDialogClipElementId(id: string): string {
  return `calendar-day-dialog-clip-${id}`;
}
