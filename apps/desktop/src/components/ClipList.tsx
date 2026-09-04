import type { Clip } from '@ai-clip-memory/shared';
import { clipPreview, displayTitle } from '@/lib/clipRetrieval';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ClipListProps {
  clips: Clip[];
  onSelect: (id: string) => void;
  selectedId: string | null;
}

export function ClipList({ clips, onSelect, selectedId }: ClipListProps) {
  return (
    <ScrollArea className="clip-list" aria-label="Clips">
      <div className="clip-list-items">
        {clips.map((clip, index) => (
          <Button
            className="clip-list-item"
            variant="ghost"
            type="button"
            aria-pressed={clip.id === selectedId}
            tabIndex={clip.id === (selectedId ?? clips[0]?.id) ? 0 : -1}
            key={clip.id}
            onClick={() => onSelect(clip.id)}
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
              onSelect(clips[next]!.id);
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
              <span>{displayTitle(clip)}</span>
              {clip.isPinned && <PinBadge />}
            </span>
            <span className="clip-list-preview">
              {clipPreview(clip.content)}
            </span>
            <span className="clip-list-footer">
              <Badge variant="secondary" className="clip-list-meta">
                {clip.contentType}
              </Badge>
              <span className="clip-list-source">
                {clip.sourceApp || 'Local clip'}
              </span>
              <time className="clip-list-date" dateTime={clip.createdAt}>
                {new Date(clip.createdAt).toLocaleDateString()}
              </time>
            </span>
          </Button>
        ))}
      </div>
    </ScrollArea>
  );
}

function PinBadge() {
  return (
    <Badge variant="outline" className="pin-badge">
      Pinned
    </Badge>
  );
}
