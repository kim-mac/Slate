import type { Clip } from '@ai-clip-memory/shared';

interface ClipDetailProps {
  clip: Clip;
  onCopy: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onOpenSource: () => void;
  onSetPinned: (isPinned: boolean) => void;
}

export function ClipDetail({
  clip,
  onCopy,
  onDelete,
  onEdit,
  onOpenSource,
  onSetPinned,
}: ClipDetailProps) {
  return (
    <article className="clip-detail">
      <header className="clip-detail-header">
        <div>
          <span className="content-type">{clip.contentType}</span>
          <h2>{clip.title ?? 'Untitled clip'}</h2>
        </div>
        <div className="clip-actions">
          <button type="button" onClick={onCopy}>
            Copy
          </button>
          <button type="button" onClick={() => onSetPinned(!clip.isPinned)}>
            {clip.isPinned ? 'Unpin' : 'Pin'}
          </button>
          <button type="button" onClick={onEdit}>
            Edit
          </button>
          <button className="danger-button" type="button" onClick={onDelete}>
            Delete
          </button>
        </div>
      </header>

      <pre className="clip-content">{clip.content}</pre>

      <dl className="clip-metadata">
        {clip.sourceApp && (
          <div>
            <dt>Source</dt>
            <dd>{clip.sourceApp}</dd>
          </div>
        )}
        {clip.sourcePageTitle && (
          <div>
            <dt>Page</dt>
            <dd>{clip.sourcePageTitle}</dd>
          </div>
        )}
        <div>
          <dt>Created</dt>
          <dd>{new Date(clip.createdAt).toLocaleString()}</dd>
        </div>
      </dl>

      {clip.sourceUrl && (
        <button className="source-button" type="button" onClick={onOpenSource}>
          Open source
        </button>
      )}
    </article>
  );
}
