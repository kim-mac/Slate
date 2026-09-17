import type { Clip, ClipInput } from '@ai-clip-memory/shared';

import { ClipForm } from '@/components/ClipForm';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ClipFormDialogProps {
  clip?: Clip;
  error?: string | null;
  isSaving: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: ClipInput) => Promise<void>;
  open: boolean;
}

export function ClipFormDialog({
  clip,
  error,
  isSaving,
  onOpenChange,
  onSubmit,
  open,
}: ClipFormDialogProps) {
  const title = clip ? 'Edit clip' : 'Create clip';

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isSaving) onOpenChange(false);
      }}
    >
      <DialogContent className="clip-form-dialog" showCloseButton={!isSaving}>
        <ScrollArea className="clip-form-dialog-scroll">
          <div className="clip-form-dialog-scroll-content">
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>
                {clip
                  ? 'Update this clip while keeping it stored locally.'
                  : 'Add something useful to your local clip library.'}
              </DialogDescription>
            </DialogHeader>
            {error && (
              <p role="alert" className="error-message dialog-error-message">
                {error}
              </p>
            )}
            <ClipForm
              {...(clip ? { clip } : {})}
              isSaving={isSaving}
              onCancel={() => onOpenChange(false)}
              onSubmit={onSubmit}
            />
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
