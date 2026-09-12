import type { Clip } from '@ai-clip-memory/shared';

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
                primaryId={`calendar-day-dialog-clip-${clip.id}`}
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
