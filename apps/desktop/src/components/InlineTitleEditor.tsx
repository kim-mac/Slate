import { Check, Pencil } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { InlineContentEditor } from './ClipContentEditor';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

export function InlineTitleEditor({
  title,
  label,
  disabled,
  pending = false,
  inline,
}: {
  title: string;
  label: 'Clip title' | 'Group title';
  disabled: boolean;
  pending?: boolean;
  inline?: InlineContentEditor | undefined;
}) {
  const input = useRef<HTMLInputElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  const editing = Boolean(inline?.draft);
  const errorId = useId();
  const [pasteError, setPasteError] = useState<string | null>(null);
  const error = inline?.draft?.error ?? pasteError;
  useLayoutEffect(() => {
    if (editing) {
      input.current?.focus({ preventScroll: true });
      input.current?.setSelectionRange(
        input.current.value.length,
        input.current.value.length,
      );
    } else if (wasEditing.current && document.activeElement === document.body)
      action.current?.focus({ preventScroll: true });
    wasEditing.current = editing;
    setPasteError(null);
  }, [editing]);
  useLayoutEffect(() => {
    if (inline?.draft?.error) input.current?.focus({ preventScroll: true });
  }, [inline?.draft?.error]);
  return (
    <div
      className="inline-title"
      data-inline-content-editor={editing ? '' : undefined}
      onBlurCapture={(event) => {
        if (
          editing &&
          !(
            event.relatedTarget instanceof Node &&
            event.currentTarget.contains(event.relatedTarget)
          )
        )
          inline?.onSave();
      }}
    >
      <div className="inline-title-row">
        {inline?.draft ? (
          <input
            ref={input}
            type="text"
            className="inline-title-input"
            aria-label={label}
            aria-busy={inline.draft.saving}
            aria-describedby={error ? errorId : undefined}
            value={inline.draft.content}
            readOnly={inline.draft.saving}
            onChange={(event) => {
              setPasteError(null);
              inline.onChange(event.target.value);
            }}
            onPaste={(event) => {
              if (/[\r\n]/.test(event.clipboardData.getData('text'))) {
                event.preventDefault();
                setPasteError(
                  'Titles cannot contain line breaks. Your existing draft is unchanged.',
                );
              }
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter' || event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                if (event.key === 'Enter') inline.onSave();
                else inline.onCancel();
              }
            }}
          />
        ) : (
          <h2>{title}</h2>
        )}
        {inline && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  ref={action}
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`${editing ? 'Save' : 'Edit'} ${label.toLowerCase()}`}
                  pending={
                    pending || Boolean(inline.draft?.saving) || inline.isOpening
                  }
                  disabled={
                    inline.isOpening ||
                    Boolean(inline.draft?.saving) ||
                    (!editing && disabled)
                  }
                  onClick={() => (editing ? inline.onSave() : inline.onBegin())}
                />
              }
            >
              {editing ? (
                <Check aria-hidden="true" />
              ) : (
                <Pencil aria-hidden="true" />
              )}
            </TooltipTrigger>
            <TooltipContent>
              {editing ? 'Save' : 'Edit'} {label.toLowerCase()}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      {editing && error && (
        <p role="alert" id={errorId} className="error-message">
          {error}
        </p>
      )}
    </div>
  );
}
