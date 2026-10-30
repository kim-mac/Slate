import type { Clip, ClipGroup, LibraryItem } from '@ai-clip-memory/shared';
import { useRef, useState } from 'react';
import type { ClipClient } from '../clipClient';
import { displayTitle } from '../lib/clipRetrieval';
import type { SafetyLease } from '../installationSafetyClient';
import type { InstallationSafety } from './useInstallationSafety';

export type InlineTarget =
  | { kind: 'content' | 'clip-title'; clip: Clip }
  | { kind: 'group-title'; group: ClipGroup };

interface Session {
  target: InlineTarget;
  content: string;
  initial: string;
  lease: SafetyLease;
  persisted: boolean;
}

function itemOf(target: InlineTarget): LibraryItem {
  return target.kind === 'group-title'
    ? { kind: 'group', group: target.group }
    : { kind: 'clip', clip: target.clip };
}

// One application-owned draft, lease, save/cleanup promise and deferred action
// across all modes. Refreshed library records never replace the draft.
export function useInlineClipContent({
  client,
  safety,
  beginOperation,
  finishOperation,
  onSaved,
  onFinished,
}: {
  client: Pick<ClipClient, 'update' | 'renameGroup'>;
  safety: InstallationSafety;
  beginOperation: () => boolean;
  finishOperation: () => void;
  onSaved: (item: LibraryItem) => void | Promise<void>;
  onFinished?: (
    item: LibraryItem,
    kind: InlineTarget['kind'],
  ) => void | Promise<void>;
}) {
  const session = useRef<Session | null>(null);
  const opening = useRef(false);
  const pending = useRef<Promise<boolean> | null>(null);
  const queuedAction = useRef(false);
  const [draft, setDraft] = useState<{
    content: string;
    saving: boolean;
    error: string | null;
  } | null>(null);
  const [isOpening, setOpening] = useState(false);

  async function beginTarget(target: InlineTarget) {
    if (session.current || opening.current || pending.current || safety.frozen)
      return false;
    if (target.kind === 'group-title' && !target.group.titleState) return false;
    opening.current = true;
    setOpening(true);
    try {
      const lease = await safety.acquire('inline');
      if (!lease) return false;
      const content =
        target.kind === 'group-title'
          ? target.group.title
          : target.kind === 'clip-title'
            ? displayTitle(target.clip)
            : target.clip.content;
      session.current = {
        target,
        content,
        initial: content,
        lease,
        persisted: false,
      };
      setDraft({ content, saving: false, error: null });
      return true;
    } finally {
      opening.current = false;
      setOpening(false);
    }
  }

  function change(content: string) {
    if (!session.current || pending.current) return;
    session.current.content = content;
    session.current.persisted = false;
    setDraft({ content, saving: false, error: null });
  }

  function save(): Promise<boolean> {
    if (pending.current) return pending.current;
    if (opening.current) return Promise.resolve(false);
    const current = session.current;
    if (!current) return Promise.resolve(true);
    const isTitle = current.target.kind !== 'content';
    const label = isTitle ? 'title' : 'content';
    if (isTitle && !current.persisted) {
      const value = current.content;
      const invalid = /[\r\n]/.test(value)
        ? 'Titles cannot contain line breaks.'
        : new TextEncoder().encode(value).length > 16 * 1024
          ? 'Titles must be at most 16 KiB of UTF-8 text.'
          : current.target.kind === 'group-title' && !value.trim()
            ? 'Group title cannot be empty.'
            : null;
      if (invalid) {
        setDraft({
          content: value,
          saving: false,
          error:
            invalid +
            ' Your draft is preserved; retry or press Escape to cancel.',
        });
        return Promise.resolve(false);
      }
    }
    const writing = !current.persisted;
    if (safety.frozen || (writing && !beginOperation())) {
      setDraft({
        content: current.content,
        saving: false,
        error: `Could not save ${label}. Finish the current operation, then retry or press Escape to cancel.`,
      });
      return Promise.resolve(false);
    }
    setDraft({ content: current.content, saving: true, error: null });
    pending.current = (async () => {
      try {
        if (writing) {
          const target = current.target;
          if (target.kind === 'group-title') {
            const group = await client.renameGroup(
              target.group.id,
              current.content.trim(),
              target.group.titleState!,
            );
            current.target = { kind: 'group-title', group };
          } else {
            const {
              contentType,
              title,
              sourceApp,
              sourceUrl,
              sourcePageTitle,
            } = target.clip;
            const nextTitle =
              title === null && current.content === current.initial
                ? null
                : current.content.trim() || null;
            const clip = await client.update(
              target.clip.id,
              {
                content:
                  target.kind === 'content'
                    ? current.content
                    : target.clip.content,
                contentType,
                title: target.kind === 'content' ? title : nextTitle,
                sourceApp,
                sourceUrl,
                sourcePageTitle,
              },
              target.kind === 'content'
                ? { expectedContent: target.clip.content }
                : { titleEdit: { expectedTitle: title } },
            );
            current.target = { kind: target.kind, clip };
          }
          // Cache the commit before read refresh or lease acknowledgements.
          // Retrying either must never repeat a successful write.
          current.persisted = true;
          await onSaved(itemOf(current.target));
        }
        if (!(await safety.release(current.lease))) {
          setDraft({
            content: current.content,
            saving: false,
            error: `${isTitle ? 'Title' : 'Content'} saved, but safety cleanup failed. Retry Save changes, or press Escape to cancel editing.`,
          });
          return false;
        }
        session.current = null;
        setDraft(null);
        await onFinished?.(itemOf(current.target), current.target.kind);
        return true;
      } catch (error) {
        const conflict =
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error.code === 'clip_changed' || error.code === 'group_changed');
        setDraft({
          content: current.content,
          saving: false,
          error: conflict
            ? `Could not save ${label}: ${current.target.kind === 'group-title' ? 'this group' : 'this clip'} changed or was deleted. Your draft is preserved. Copy your text before pressing Escape to cancel, then reopen the latest item.`
            : `Could not save ${label}. Your draft is preserved. Retry Save changes, or press Escape to cancel.`,
        });
        return false;
      } finally {
        if (writing) finishOperation();
        pending.current = null;
      }
    })();
    return pending.current;
  }

  async function cancel() {
    if (pending.current || opening.current) return;
    const current = session.current;
    if (!current) return;
    setDraft({ content: current.initial, saving: true, error: null });
    current.content = current.initial;
    pending.current = (async () => {
      try {
        if (!(await safety.release(current.lease))) {
          setDraft({
            content: current.content,
            saving: false,
            error:
              'Safety cleanup failed. Press Escape again to finish cancelling.',
          });
          return false;
        }
        session.current = null;
        setDraft(null);
        await onFinished?.(itemOf(current.target), current.target.kind);
        return true;
      } finally {
        pending.current = null;
      }
    })();
    await pending.current;
  }

  function afterSave(
    action: (saved: LibraryItem | undefined) => void | Promise<void>,
  ) {
    if (queuedAction.current || opening.current) return;
    const current = session.current;
    queuedAction.current = true;
    void save()
      .then(async (ok) => {
        if (ok) await action(current ? itemOf(current.target) : undefined);
      })
      .finally(() => {
        queuedAction.current = false;
      });
  }

  return {
    editingClip:
      session.current?.target.kind !== 'group-title'
        ? (session.current?.target.clip ?? null)
        : null,
    editingGroup:
      session.current?.target.kind === 'group-title'
        ? session.current.target.group
        : null,
    editingKind: session.current?.target.kind ?? null,
    draft,
    isOpening,
    begin: (clip: Clip) => beginTarget({ kind: 'content', clip }),
    beginTitle: (clip: Clip) => beginTarget({ kind: 'clip-title', clip }),
    beginGroupTitle: (group: ClipGroup) =>
      beginTarget({ kind: 'group-title', group }),
    change,
    save,
    cancel,
    afterSave,
    isActive: () =>
      Boolean(session.current || opening.current || pending.current),
  };
}
