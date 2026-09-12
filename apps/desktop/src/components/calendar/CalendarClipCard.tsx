import type { Clip } from '@ai-clip-memory/shared';
import { Copy, Ellipsis, Eye, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { useRef } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { displayTitle } from '@/lib/clipRetrieval';

export interface CalendarClipActions {
  onActivateClip: (id: string, element: HTMLElement) => void;
  onCopyClip: (clip: Clip) => void;
  onDeleteClip: (clip: Clip) => void;
  onEditClip: (clip: Clip) => void;
  onSetPinned: (clip: Clip, isPinned: boolean) => void;
}

interface CalendarClipCardProps extends CalendarClipActions {
  clip: Clip;
  disabled?: boolean;
  primaryId: string;
}

export function CalendarClipCard({
  clip,
  disabled = false,
  primaryId,
  onActivateClip,
  onCopyClip,
  onDeleteClip,
  onEditClip,
  onSetPinned,
}: CalendarClipCardProps) {
  const primaryRef = useRef<HTMLButtonElement>(null);
  const title = displayTitle(clip);

  function activate() {
    if (primaryRef.current) onActivateClip(clip.id, primaryRef.current);
  }

  return (
    <div className="memory-calendar-clip-card">
      <button
        ref={primaryRef}
        id={primaryId}
        type="button"
        className="memory-calendar-clip"
        title={title}
        aria-label={`Open ${title}`}
        onClick={activate}
        onKeyDown={(event) => {
          if (
            event.nativeEvent.isComposing ||
            (event.key !== 'Enter' && event.key !== ' ')
          )
            return;
          event.preventDefault();
          activate();
        }}
      >
        {clip.isPinned && (
          <Pin className="memory-calendar-clip-pin" aria-hidden="true" />
        )}
        <span className="memory-calendar-clip-label">{title}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled}
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="memory-calendar-actions-trigger"
              aria-label={`Actions for ${title}`}
            />
          }
        >
          <Ellipsis aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={activate}>
            <Eye aria-hidden="true" />
            Preview
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onCopyClip(clip)}>
            <Copy aria-hidden="true" />
            Copy
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onEditClip(clip)}>
            <Pencil aria-hidden="true" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onSetPinned(clip, !clip.isPinned)}>
            {clip.isPinned ? (
              <PinOff aria-hidden="true" />
            ) : (
              <Pin aria-hidden="true" />
            )}
            {clip.isPinned ? 'Unpin' : 'Pin'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => onDeleteClip(clip)}
          >
            <Trash2 aria-hidden="true" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
