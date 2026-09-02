import {
  CLIP_CONTENT_TYPES,
  type Clip,
  type ClipContentType,
  type ClipInput,
} from '@ai-clip-memory/shared';
import { useState, type FormEvent } from 'react';

interface ClipFormProps {
  clip?: Clip;
  isSaving: boolean;
  onCancel: () => void;
  onSubmit: (input: ClipInput) => Promise<void>;
}

function optionalValue(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function ClipForm({
  clip,
  isSaving,
  onCancel,
  onSubmit,
}: ClipFormProps) {
  const [content, setContent] = useState(clip?.content ?? '');
  const [contentType, setContentType] = useState<ClipContentType>(
    clip?.contentType ?? 'text',
  );
  const [title, setTitle] = useState(clip?.title ?? '');
  const [sourceApp, setSourceApp] = useState(clip?.sourceApp ?? '');
  const [sourceUrl, setSourceUrl] = useState(clip?.sourceUrl ?? '');
  const [sourcePageTitle, setSourcePageTitle] = useState(
    clip?.sourcePageTitle ?? '',
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (content.trim().length === 0) return;
    void onSubmit({
      content,
      contentType,
      title: optionalValue(title),
      sourceApp: optionalValue(sourceApp),
      sourceUrl: optionalValue(sourceUrl),
      sourcePageTitle: optionalValue(sourcePageTitle),
    });
  }

  return (
    <section className="clip-form-view" aria-labelledby="clip-form-heading">
      <header className="section-header">
        <h1 id="clip-form-heading">{clip ? 'Edit clip' : 'Create clip'}</h1>
        <p>
          {clip ? 'Replace the editable clip fields.' : 'Save a clip locally.'}
        </p>
      </header>

      <form className="clip-form" onSubmit={handleSubmit}>
        <label>
          Content
          <textarea
            required
            rows={9}
            value={content}
            onChange={(event) => setContent(event.currentTarget.value)}
          />
        </label>
        <label>
          Content type
          <select
            value={contentType}
            onChange={(event) =>
              setContentType(event.currentTarget.value as ClipContentType)
            }
          >
            {CLIP_CONTENT_TYPES.map((type) => (
              <option value={type} key={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label>
          Title
          <input
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
        </label>
        <label>
          Source app
          <input
            value={sourceApp}
            onChange={(event) => setSourceApp(event.currentTarget.value)}
          />
        </label>
        <label>
          Source URL
          <input
            type="url"
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.currentTarget.value)}
          />
        </label>
        <label>
          Source page title
          <input
            value={sourcePageTitle}
            onChange={(event) => setSourcePageTitle(event.currentTarget.value)}
          />
        </label>
        <div className="form-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary-button" type="submit" disabled={isSaving}>
            {isSaving ? 'Saving…' : clip ? 'Save changes' : 'Save clip'}
          </button>
        </div>
      </form>
    </section>
  );
}
