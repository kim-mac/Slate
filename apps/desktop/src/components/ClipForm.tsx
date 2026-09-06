import {
  CLIP_CONTENT_TYPES,
  type Clip,
  type ClipContentType,
  type ClipInput,
} from '@ai-clip-memory/shared';
import { useState, type FormEvent } from 'react';
import { validateClipInputSize } from '@/lib/clipInputLimits';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

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
  const [validationError, setValidationError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (content.trim().length === 0) return;
    const input = {
      content,
      contentType,
      title: optionalValue(title),
      sourceApp: optionalValue(sourceApp),
      sourceUrl: optionalValue(sourceUrl),
      sourcePageTitle: optionalValue(sourcePageTitle),
    };
    const sizeError = validateClipInputSize(input);
    setValidationError(sizeError);
    if (sizeError) return;
    void onSubmit(input);
  }

  return (
    <form className="clip-form" onSubmit={handleSubmit}>
      <label htmlFor="clip-content">
        Content
        <Textarea
          id="clip-content"
          className="clip-form-content"
          required
          rows={8}
          value={content}
          onChange={(event) => setContent(event.currentTarget.value)}
        />
      </label>
      <label htmlFor="clip-content-type">
        Content type
        <Select
          value={contentType}
          onValueChange={(value) => {
            if (value) setContentType(value as ClipContentType);
          }}
        >
          <SelectTrigger id="clip-content-type" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CLIP_CONTENT_TYPES.map((type) => (
              <SelectItem
                value={type}
                key={type}
                onClick={() => setContentType(type)}
              >
                {type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <div className="clip-form-grid">
        <label htmlFor="clip-title">
          Title
          <Input
            id="clip-title"
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
        </label>
        <label htmlFor="clip-source-app">
          Source app
          <Input
            id="clip-source-app"
            value={sourceApp}
            onChange={(event) => setSourceApp(event.currentTarget.value)}
          />
        </label>
        <label htmlFor="clip-source-url">
          Source URL
          <Input
            id="clip-source-url"
            type="url"
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.currentTarget.value)}
          />
        </label>
        <label htmlFor="clip-source-page-title">
          Source page title
          <Input
            id="clip-source-page-title"
            value={sourcePageTitle}
            onChange={(event) => setSourcePageTitle(event.currentTarget.value)}
          />
        </label>
      </div>
      {validationError && (
        <p role="alert" className="error-message">
          {validationError}
        </p>
      )}
      <div className="form-actions">
        <Button
          variant="outline"
          type="button"
          disabled={isSaving}
          onClick={() => {
            if (!isSaving) onCancel();
          }}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? 'Saving…' : clip ? 'Save changes' : 'Save clip'}
        </Button>
      </div>
    </form>
  );
}
