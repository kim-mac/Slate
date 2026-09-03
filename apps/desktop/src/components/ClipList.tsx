import type { Clip } from '@ai-clip-memory/shared';

interface ClipListProps {
  clips: Clip[];
  onSelect: (id: string) => void;
  selectedId: string | null;
}

export function ClipList({ clips, onSelect, selectedId }: ClipListProps) {
  return (
    <div className="clip-list" aria-label="Clips">
      {clips.map((clip) => (
        <button
          className="clip-list-item"
          type="button"
          aria-pressed={clip.id === selectedId}
          key={clip.id}
          onClick={() => onSelect(clip.id)}
        >
          <span className="clip-list-title">
            {clip.isPinned && <span aria-hidden="true">◆</span>}
            {clip.title ?? 'Untitled clip'}
          </span>
          <span className="clip-list-preview">
            {clip.content.slice(0, 90)}…
          </span>
          <span className="clip-list-meta">{clip.contentType}</span>
        </button>
      ))}
    </div>
  );
}
