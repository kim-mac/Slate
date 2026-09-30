import type { Clip, LibraryItem } from '@ai-clip-memory/shared';
import {
  libraryItemCreatedAt,
  asLibraryItem,
  libraryItemId,
  libraryItemPinned,
  libraryItemPreview,
  libraryItemSourceLabel,
  libraryItemTitle,
  libraryItemTypeLabel,
} from '@/lib/libraryItems';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ClipListProps {
  ariaLabel?: string;
  clips: Array<LibraryItem | Clip>;
  compact?: boolean;
  onSelect: (id: string) => void;
  selectedId: string | null;
  itemIdPrefix?: string;
  selectionMode?: boolean;
  selectedClipIds?: ReadonlySet<string> | undefined;
  onToggleSelection?: ((id: string) => void) | undefined;
}

export function ClipList({
  ariaLabel = 'Clips',
  clips,
  compact = false,
  onSelect,
  selectedId,
  itemIdPrefix,
  selectionMode = false,
  selectedClipIds,
  onToggleSelection,
}: ClipListProps) {
  return (
    <ScrollArea
      className={`clip-list${compact ? ' clip-list-compact' : ''}`}
      aria-label={ariaLabel}
    >
      <div className="clip-list-items">
        {clips.map((candidate, index) => {
          const clip = asLibraryItem(candidate);
          const id = libraryItemId(clip);
          const title = libraryItemTitle(clip);
          const createdAt = libraryItemCreatedAt(clip);
          return (
            <Button
              id={
                itemIdPrefix
                  ? clipListItemElementId(itemIdPrefix, id)
                  : undefined
              }
              className="clip-list-item"
              variant="ghost"
              type="button"
              aria-pressed={
                selectionMode
                  ? (selectedClipIds?.has(id) ?? false)
                  : id === selectedId
              }
              aria-label={selectionMode ? `Select ${title}` : undefined}
              data-merge-selected={
                selectionMode && selectedClipIds?.has(id) ? 'true' : undefined
              }
              tabIndex={
                selectionMode ||
                id ===
                  (selectedId ??
                    (clips[0]
                      ? libraryItemId(asLibraryItem(clips[0]))
                      : undefined))
                  ? 0
                  : -1
              }
              key={id}
              onClick={() =>
                selectionMode ? onToggleSelection?.(id) : onSelect(id)
              }
              onKeyDown={(event) => {
                if (
                  event.nativeEvent.isComposing ||
                  event.ctrlKey ||
                  event.metaKey ||
                  event.altKey ||
                  event.shiftKey
                )
                  return;
                const next =
                  event.key === 'ArrowDown'
                    ? Math.min(index + 1, clips.length - 1)
                    : event.key === 'ArrowUp'
                      ? Math.max(index - 1, 0)
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? clips.length - 1
                          : null;
                if (next === null) return;
                event.preventDefault();
                const row =
                  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                    '.clip-list-item',
                  )[next];
                if (!selectionMode)
                  onSelect(libraryItemId(asLibraryItem(clips[next]!)));
                row?.focus({ preventScroll: true });
                const viewport = row?.closest<HTMLElement>(
                  '[data-slot="scroll-area-viewport"]',
                );
                if (row && viewport) {
                  const bounds = viewport.getBoundingClientRect();
                  const target = row.getBoundingClientRect();
                  if (target.top < bounds.top)
                    viewport.scrollTop += target.top - bounds.top;
                  else if (target.bottom > bounds.bottom)
                    viewport.scrollTop += target.bottom - bounds.bottom;
                }
              }}
            >
              <span className="clip-list-title">
                <span>{title}</span>
                {libraryItemPinned(clip) && !compact && <PinBadge />}
              </span>
              <span className="clip-list-preview">
                {libraryItemPreview(clip)}
              </span>
              {!compact && (
                <span className="clip-list-footer">
                  <Badge variant="secondary" className="clip-list-meta">
                    {libraryItemTypeLabel(clip)}
                  </Badge>
                  <span className="clip-list-source">
                    {libraryItemSourceLabel(clip)}
                  </span>
                  <time className="clip-list-date" dateTime={createdAt}>
                    {new Date(createdAt).toLocaleDateString()}
                  </time>
                </span>
              )}
            </Button>
          );
        })}
      </div>
    </ScrollArea>
  );
}

export function clipListItemElementId(prefix: string, id: string): string {
  return `${prefix}-${id}`;
}

function PinBadge() {
  return (
    <Badge variant="outline" className="pin-badge">
      Pinned
    </Badge>
  );
}
