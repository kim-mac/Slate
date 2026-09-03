import type { Clip } from '@ai-clip-memory/shared';

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
        {clips.map((clip) => (
          <Button
            className="clip-list-item"
            variant="ghost"
            type="button"
            aria-pressed={clip.id === selectedId}
            key={clip.id}
            onClick={() => onSelect(clip.id)}
          >
            <span className="clip-list-title">
              <span>{clip.title ?? 'Untitled clip'}</span>
              {clip.isPinned && <PinBadge />}
            </span>
            <span className="clip-list-preview">
              {clip.content.slice(0, 90)}…
            </span>
            <Badge variant="secondary" className="clip-list-meta">
              {clip.contentType}
            </Badge>
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
