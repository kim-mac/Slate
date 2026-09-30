import type { Clip, LibraryItem } from '@ai-clip-memory/shared';
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
import {
  libraryItemId,
  libraryItemPinned,
  libraryItemTitle,
} from '@/lib/libraryItems';

export interface CalendarClipActions {
  onActivateClip: (id: string, element: HTMLElement) => void;
  onCopyClip: (clip: Clip) => void;
  onDeleteItem: (item: LibraryItem) => void;
  onEditClip: (clip: Clip) => void;
  onSetItemPinned: (item: LibraryItem, isPinned: boolean) => void;
}

interface CalendarClipCardProps extends CalendarClipActions {
  clip: LibraryItem;
  disabled?: boolean;
  onFocusClip?: (clip: LibraryItem) => void;
  primaryId: string;
  selectionMode?: boolean;
  selected?: boolean;
  sameSourceHint?: boolean;
  onToggleSelection?: ((id: string) => void) | undefined;
}

export function CalendarClipCard({
  clip,
  disabled = false,
  onFocusClip,
  primaryId,
  selectionMode = false,
  selected = false,
  sameSourceHint = false,
  onToggleSelection,
  onActivateClip,
  onCopyClip,
  onDeleteItem,
  onEditClip,
  onSetItemPinned,
}: CalendarClipCardProps) {
  const primaryRef = useRef<HTMLButtonElement>(null);
  const id = libraryItemId(clip);
  const title = libraryItemTitle(clip);
  const pinned = libraryItemPinned(clip);
  const pinnedDescriptionId = `${primaryId}-pinned-status`;
  function activate() {
    if (selectionMode) onToggleSelection?.(id);
    else if (primaryRef.current) onActivateClip(id, primaryRef.current);
  }
  return (
    <div className="memory-calendar-clip-card">
      <button
        ref={primaryRef}
        id={primaryId}
        type="button"
        className="memory-calendar-clip"
        title={title}
        aria-label={`${selectionMode ? 'Select' : 'Open'} ${title}`}
        aria-pressed={selectionMode ? selected : undefined}
        data-merge-selected={selectionMode && selected ? 'true' : undefined}
        data-same-source-hint={
          selectionMode && sameSourceHint ? 'true' : undefined
        }
        aria-describedby={pinned ? pinnedDescriptionId : undefined}
        onClick={activate}
        onFocus={() => onFocusClip?.(clip)}
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
        {pinned && (
          <Pin className="memory-calendar-clip-pin" aria-hidden="true" />
        )}
        <span className="memory-calendar-clip-label">{title}</span>
      </button>
      {pinned && (
        <span id={pinnedDescriptionId} className="sr-only">
          Pinned
        </span>
      )}
      {!selectionMode && (
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
                onFocus={() => onFocusClip?.(clip)}
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
            {clip.kind === 'clip' && (
              <>
                <DropdownMenuItem onClick={() => onCopyClip(clip.clip)}>
                  <Copy aria-hidden="true" />
                  Copy
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onEditClip(clip.clip)}>
                  <Pencil aria-hidden="true" />
                  Edit
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem onClick={() => onSetItemPinned(clip, !pinned)}>
              {pinned ? (
                <PinOff aria-hidden="true" />
              ) : (
                <Pin aria-hidden="true" />
              )}
              {pinned ? 'Unpin' : 'Pin'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onDeleteItem(clip)}
            >
              <Trash2 aria-hidden="true" />
              {clip.kind === 'group' ? 'Delete merged clip' : 'Delete'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
