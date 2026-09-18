import {
  CLIP_CONTENT_TYPES,
  type ClipContentType,
} from '@ai-clip-memory/shared';
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type Ref,
} from 'react';

import { Button } from '../components/ui/button';
import { ScrollArea } from '../components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { validateClipInputSize } from '../lib/clipInputLimits';
import { formatContentType } from '../lib/clipRetrieval';
import { automaticContentType } from './launcherClipClassification';

export interface LauncherClipDraft {
  content: string;
  contentType: ClipContentType;
}

interface LauncherClipEditorProps {
  mode: 'create' | 'edit';
  initialContent?: string;
  initialContentType?: ClipContentType;
  isSaving: boolean;
  error: string | null;
  contentRef?: Ref<HTMLTextAreaElement>;
  onCancel: () => void;
  onSave: (draft: LauncherClipDraft) => void;
}

export function LauncherClipEditor({
  mode,
  initialContent = '',
  initialContentType = 'text',
  isSaving,
  error,
  contentRef,
  onCancel,
  onSave,
}: LauncherClipEditorProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);
  const [content, setContent] = useState(initialContent);
  const [contentType, setContentType] =
    useState<ClipContentType>(initialContentType);
  const [typeChoice, setTypeChoice] = useState<'auto' | 'manual'>(
    mode === 'create' ? 'auto' : 'manual',
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSaving) submitting.current = false;
  }, [isSaving]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving || submitting.current) return;
    if (content.trim().length === 0) {
      setValidationError('Content is required.');
      return;
    }
    const sizeError = validateClipInputSize({
      content,
      contentType,
      title: null,
      sourceApp: null,
      sourceUrl: null,
      sourcePageTitle: null,
    });
    setValidationError(sizeError);
    if (sizeError) return;
    submitting.current = true;
    onSave({ content, contentType });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (
      event.key === 'Enter' &&
      (event.ctrlKey || event.metaKey) &&
      !event.nativeEvent.isComposing &&
      event.keyCode !== 229
    ) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  return (
    <form
      ref={formRef}
      className="launcher-editor"
      aria-label={mode === 'create' ? 'Create clip' : 'Edit clip'}
      onSubmit={submit}
      onKeyDown={handleKeyDown}
    >
      <ScrollArea className="launcher-editor-scroll">
        <div className="launcher-editor-scroll-content">
          <div className="launcher-editor-field">
            <label htmlFor="launcher-content-type">Content type</label>
            <Select
              value={contentType}
              onValueChange={(value) => {
                if (!value) return;
                setContentType(value as ClipContentType);
                setTypeChoice('manual');
              }}
            >
              <SelectTrigger
                id="launcher-content-type"
                aria-label="Content type"
                className="w-full"
              >
                <SelectValue>{formatContentType(contentType)}</SelectValue>
              </SelectTrigger>
              <SelectContent align="start" alignItemWithTrigger={false}>
                {CLIP_CONTENT_TYPES.map((type) => (
                  <SelectItem
                    key={type}
                    value={type}
                    onClick={() => {
                      setContentType(type);
                      setTypeChoice('manual');
                    }}
                  >
                    {formatContentType(type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="launcher-editor-field launcher-editor-content-label">
            <label htmlFor="launcher-content">Content</label>
            <Textarea
              ref={contentRef}
              id="launcher-content"
              aria-label="Content"
              className="launcher-editor-content"
              value={content}
              rows={9}
              required
              onChange={(event) => {
                const next = event.currentTarget.value;
                setContent(next);
                setValidationError(null);
                if (typeChoice === 'auto')
                  setContentType(automaticContentType(next));
              }}
            />
          </div>
          {(validationError || error) && (
            <p className="launcher-editor-error" role="alert">
              {validationError ?? error}
            </p>
          )}
        </div>
      </ScrollArea>
      <div className="launcher-editor-actions">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isSaving}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isSaving}>
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}
