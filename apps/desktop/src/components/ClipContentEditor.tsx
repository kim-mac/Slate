import type { Clip } from '@ai-clip-memory/shared';
import { Check, Copy, Pencil } from 'lucide-react';
import { useId, useLayoutEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export interface InlineContentEditor {
  draft: { content: string; saving: boolean; error: string | null } | null;
  isOpening: boolean;
  onBegin: () => void;
  onChange: (content: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function ClipContentEditor({
  clip,
  disabled,
  pending = false,
  inline,
  labelSuffix = '',
  onCopy,
}: {
  clip: Clip;
  disabled: boolean;
  pending?: boolean;
  inline?: InlineContentEditor | undefined;
  labelSuffix?: string;
  onCopy?: (() => void) | undefined;
}) {
  const errorId = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const content = useRef<HTMLPreElement>(null);
  const caret = useRef<number | null>(null);
  const contentHeight = useRef(0);
  const action = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  const editing = Boolean(inline?.draft);
  useLayoutEffect(() => {
    if (editing && textarea.current) {
      textarea.current.focus({ preventScroll: true });
      const position = caret.current ?? textarea.current.value.length;
      textarea.current.setSelectionRange(position, position);
      caret.current = null;
    } else if (wasEditing.current && document.activeElement === document.body)
      action.current?.focus({ preventScroll: true });
    wasEditing.current = editing;
  }, [editing]);
  useLayoutEffect(() => {
    if (inline?.draft?.error) textarea.current?.focus({ preventScroll: true });
  }, [inline?.draft?.error]);
  return (
    <>
      <div
        className="clip-content-card"
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
        {inline?.draft ? (
          <textarea
            ref={textarea}
            className="clip-content clip-content-editor"
            style={
              contentHeight.current
                ? { height: contentHeight.current }
                : undefined
            }
            aria-label={`Clip content${labelSuffix}`}
            aria-busy={inline.draft.saving}
            aria-describedby={inline.draft.error ? errorId : undefined}
            value={inline.draft.content}
            readOnly={inline.draft.saving}
            onChange={(event) => inline.onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.stopPropagation();
                inline.onCancel();
              }
            }}
          />
        ) : (
          <pre
            ref={content}
            className="clip-content"
            onDoubleClick={() => {
              if (disabled || inline?.isOpening) return;
              contentHeight.current =
                content.current?.getBoundingClientRect().height ?? 0;
              const selection = window.getSelection();
              if (
                selection?.focusNode &&
                content.current?.contains(selection.focusNode)
              ) {
                const range = document.createRange();
                range.selectNodeContents(content.current);
                range.setEnd(selection.focusNode, selection.focusOffset);
                caret.current = range.toString().length;
              }
              inline?.onBegin();
            }}
          >
            {clip.content}
          </pre>
        )}
        <div className={onCopy ? 'clip-content-actions' : undefined}>
          {onCopy && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    data-copy-clip=""
                    aria-label={`Copy clip${labelSuffix}`}
                    disabled={
                      disabled ||
                      inline?.isOpening ||
                      Boolean(inline?.draft?.saving)
                    }
                    onMouseDown={(event) => event.stopPropagation()}
                    pending={
                      pending ||
                      Boolean(inline?.draft?.saving) ||
                      Boolean(inline?.isOpening)
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      onCopy();
                    }}
                  />
                }
              >
                <Copy aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent>Copy clip</TooltipContent>
            </Tooltip>
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
                    className="clip-content-edit-action"
                    pending={
                      pending ||
                      Boolean(inline.draft?.saving) ||
                      inline.isOpening
                    }
                    aria-label={`${editing ? 'Save changes' : 'Edit content'}${labelSuffix}`}
                    disabled={
                      inline.isOpening ||
                      Boolean(inline.draft?.saving) ||
                      (!editing && disabled)
                    }
                    onClick={() => {
                      if (editing) inline.onSave();
                      else {
                        contentHeight.current =
                          content.current?.getBoundingClientRect().height ?? 0;
                        inline.onBegin();
                      }
                    }}
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
                {editing ? 'Save changes' : 'Edit content'}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
      {inline?.draft?.error && (
        <p role="alert" id={errorId} className="error-message">
          {inline.draft.error}
        </p>
      )}
    </>
  );
}
