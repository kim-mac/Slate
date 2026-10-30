import {
  CLIP_CONTENT_TYPES,
  type Clip,
  type ClipContentType,
  type ClipInput,
} from '@ai-clip-memory/shared';
import { useRef, useState, type FormEvent } from 'react';
import { validateClipInputSize } from '@/lib/clipInputLimits';
import { formatContentType } from '@/lib/clipRetrieval';

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
  const submitting = useRef(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving || submitting.current) return;
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
    submitting.current = true;
    void onSubmit(input).finally(() => {
      submitting.current = false;
    });
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
          readOnly={isSaving}
          onChange={(event) => {
            if (!isSaving && !submitting.current)
              setContent(event.currentTarget.value);
          }}
        />
      </label>
      <label htmlFor="clip-content-type">
        Content type
        <Select
          disabled={isSaving}
          value={contentType}
          onValueChange={(value) => {
            if (value && !isSaving && !submitting.current)
              setContentType(value as ClipContentType);
          }}
        >
          <SelectTrigger id="clip-content-type" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false} align="start">
            {CLIP_CONTENT_TYPES.map((type) => (
              <SelectItem
                value={type}
                key={type}
                onClick={() => {
                  if (!isSaving && !submitting.current) setContentType(type);
                }}
              >
                {formatContentType(type)}
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
            readOnly={isSaving}
            onChange={(event) => {
              if (!isSaving && !submitting.current)
                setTitle(event.currentTarget.value);
            }}
          />
        </label>
        <label htmlFor="clip-source-app">
          Source app
          <Input
            id="clip-source-app"
            value={sourceApp}
            readOnly={isSaving}
            onChange={(event) => {
              if (!isSaving && !submitting.current)
                setSourceApp(event.currentTarget.value);
            }}
          />
        </label>
        <label htmlFor="clip-source-url">
          Source URL
          <Input
            id="clip-source-url"
            type="url"
            value={sourceUrl}
            readOnly={isSaving}
            onChange={(event) => {
              if (!isSaving && !submitting.current)
                setSourceUrl(event.currentTarget.value);
            }}
          />
        </label>
        <label htmlFor="clip-source-page-title">
          Source page title
          <Input
            id="clip-source-page-title"
            value={sourcePageTitle}
            readOnly={isSaving}
            onChange={(event) => {
              if (!isSaving && !submitting.current)
                setSourcePageTitle(event.currentTarget.value);
            }}
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
