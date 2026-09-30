import type { Clip, ClipInput, LibraryItem } from '@ai-clip-memory/shared';
import {
  AppWindow,
  ArrowLeft,
  Copy,
  ExternalLink,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { tauriClipClient, type ClipClient } from '../clipClient';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { ScrollArea } from '../components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../components/ui/tooltip';
import { displayTitle } from '../lib/clipRetrieval';
import {
  asLibraryItem,
  libraryItemId,
  libraryItemPreview,
  libraryItemSourceLabel,
  libraryItemTitle,
  libraryItemTypeLabel,
  matchesLibraryItemSearch,
  recentLibraryItems,
} from '../lib/libraryItems';
import {
  connectLauncher,
  tauriLauncherHost,
  type LauncherHost,
  type LauncherState,
} from './launcherClient';
import {
  LauncherClipEditor,
  type LauncherClipDraft,
} from './LauncherClipEditor';
import { observeThemePreference } from '../themePreference';

type LauncherClient = Pick<
  ClipClient,
  'list' | 'copyContent' | 'openSource' | 'create' | 'update' | 'delete'
>;
type LauncherMode =
  | { kind: 'search' }
  | { kind: 'create' }
  | { kind: 'edit'; clipId: string }
  | { kind: 'group'; groupId: string };
type LauncherError = 'load' | 'copy' | 'hide' | 'open' | 'source' | null;
const VISIBLE_REFRESH_INTERVAL_MS = 2_000;
interface Props {
  client?: LauncherClient;
  host?: LauncherHost;
}

export function Launcher({
  client = tauriClipClient,
  host = tauriLauncherHost,
}: Props) {
  const [state, setState] = useState<LauncherState>({
    session: 0,
    visible: false,
  });
  const [connectionError, setConnectionError] = useState(false);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const focusActive = useRef<((session: number) => void) | null>(null);
  useEffect(() => observeThemePreference(), []);
  useEffect(
    () =>
      connectLauncher(
        host,
        (next) => {
          setState((current) =>
            next.session < current.session ? current : next,
          );
          if (next.visible) focusActive.current?.(next.session);
        },
        () => setConnectionError(true),
      ),
    [host, connectionAttempt],
  );

  if (connectionError)
    return (
      <main className="launcher-shell">
        <div className="launcher-state" role="alert">
          <strong>Quick search could not connect.</strong>
          <span>Try connecting again.</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setConnectionError(false);
              setConnectionAttempt((n) => n + 1);
            }}
          >
            Retry connection
          </Button>
        </div>
      </main>
    );
  if (!state.visible) return null;
  return (
    <TooltipProvider>
      <LauncherSession
        key={state.session}
        session={state.session}
        client={client}
        host={host}
        focusActive={focusActive}
      />
    </TooltipProvider>
  );
}

function LauncherGroupView({
  group,
  busy,
  error,
  onBack,
  onCopy,
  onOpenSource,
}: {
  group: import('@ai-clip-memory/shared').ClipGroup | undefined;
  busy: boolean;
  error: LauncherError;
  onBack: () => void;
  onCopy: (clip: Clip) => void;
  onOpenSource: (clip: Clip) => void;
}) {
  if (!group)
    return (
      <div className="launcher-state">
        <strong>This merged clip is no longer available.</strong>
        <Button variant="outline" size="sm" onClick={onBack}>
          Back
        </Button>
      </div>
    );
  return (
    <section className="launcher-group" aria-labelledby="launcher-group-title">
      <div className="launcher-group-heading">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Back to search"
          onClick={onBack}
        >
          <ArrowLeft />
        </Button>
        <div>
          <h2 id="launcher-group-title">{group.title}</h2>
          <span>{group.members.length} clips</span>
        </div>
      </div>
      {error && error !== 'load' && (
        <div className="launcher-error" role="alert">
          <span>
            {error === 'copy'
              ? 'Clip could not be copied.'
              : error === 'source'
                ? 'Clip source could not be opened.'
                : error === 'open'
                  ? 'Slate could not be opened.'
                  : 'Quick search could not close.'}
          </span>
        </div>
      )}
      <ScrollArea className="launcher-results">
        <div className="launcher-results-content">
          {group.members.map((clip) => (
            <article
              key={clip.id}
              className="launcher-result launcher-group-member"
            >
              <div className="launcher-title-row">
                <div className="launcher-title">{displayTitle(clip)}</div>
                <div className="launcher-title-actions">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Copy ${displayTitle(clip)}`}
                    disabled={busy}
                    onClick={() => onCopy(clip)}
                  >
                    <Copy />
                  </Button>
                  {clip.sourceUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Open source for ${displayTitle(clip)}`}
                      disabled={busy}
                      onClick={() => onOpenSource(clip)}
                    >
                      <ExternalLink />
                    </Button>
                  )}
                </div>
              </div>
              <div className="launcher-preview">{clip.content}</div>
              <div className="launcher-meta">
                {clip.sourceApp || 'Local clip'} ·{' '}
                {new Date(clip.createdAt).toLocaleDateString()}
              </div>
            </article>
          ))}
        </div>
      </ScrollArea>
      <footer className="launcher-footer">
        <span>{group.members.length} clips</span>
        <span>Esc Back</span>
      </footer>
    </section>
  );
}

function LauncherSession({
  session,
  client,
  host,
  focusActive,
}: {
  session: number;
  client: LauncherClient;
  host: LauncherHost;
  focusActive: React.RefObject<((session: number) => void) | null>;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const editorContentRef = useRef<HTMLTextAreaElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);
  const active = useRef(true);
  const loadingGeneration = useRef(0);
  const hasLoaded = useRef(false);
  const refreshInFlight = useRef(false);
  const copying = useRef(false);
  const openingTin = useRef(false);
  const saving = useRef(false);
  const deleting = useRef(false);
  const focusSearchAfterDelete = useRef(false);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const composing = useRef(false);
  const modeRef = useRef<LauncherMode>({ kind: 'search' });
  const [clips, setClips] = useState<LibraryItem[]>([]);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [mode, setModeState] = useState<LauncherMode>({ kind: 'search' });
  const [feedback, setFeedback] = useState<
    'copied' | 'saved' | 'deleted' | null
  >(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Clip | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<LauncherError>(null);
  const results = recentLibraryItems(clips).filter((clip) =>
    matchesLibraryItemSearch(clip, query),
  );
  const selected = selectedId
    ? results.find((clip) => libraryItemId(clip) === selectedId)
    : undefined;

  function setMode(next: LauncherMode) {
    modeRef.current = next;
    setModeState(next);
  }

  async function load() {
    const generation = ++loadingGeneration.current;
    setLoading(true);
    setError(null);
    try {
      const next = await client.list();
      if (active.current && generation === loadingGeneration.current) {
        hasLoaded.current = true;
        setClips(next.map(asLibraryItem));
      }
    } catch {
      if (active.current && generation === loadingGeneration.current)
        setError('load');
    } finally {
      if (active.current && generation === loadingGeneration.current)
        setLoading(false);
    }
  }
  async function refreshVisibleClips() {
    if (
      !active.current ||
      !hasLoaded.current ||
      refreshInFlight.current ||
      modeRef.current.kind !== 'search' ||
      saving.current ||
      deleting.current
    )
      return;
    refreshInFlight.current = true;
    const generation = ++loadingGeneration.current;
    try {
      const next = await client.list();
      if (
        active.current &&
        generation === loadingGeneration.current &&
        modeRef.current.kind === 'search' &&
        !saving.current &&
        !deleting.current
      )
        setClips(next.map(asLibraryItem));
    } catch {
      // Keep the last usable list and current feedback on a silent refresh error.
    } finally {
      refreshInFlight.current = false;
    }
  }
  useEffect(() => {
    active.current = true;
    let focusFrame = 0;
    const focus = () => {
      const focusCurrent = () => {
        if (modeRef.current.kind === 'search') searchRef.current?.focus();
        else editorContentRef.current?.focus();
      };
      focusCurrent();
      void refreshVisibleClips();
      cancelAnimationFrame(focusFrame);
      focusFrame = requestAnimationFrame(() => {
        if (active.current) focusCurrent();
      });
    };
    focusActive.current = (requestedSession) => {
      if (requestedSession === session) focus();
    };
    window.addEventListener('focus', focus);
    const refreshTimer = window.setInterval(
      () => void refreshVisibleClips(),
      VISIBLE_REFRESH_INTERVAL_MS,
    );
    focus();
    void load();
    return () => {
      active.current = false;
      window.removeEventListener('focus', focus);
      window.clearInterval(refreshTimer);
      cancelAnimationFrame(focusFrame);
      loadingGeneration.current++;
      focusActive.current = null;
    };
    // A session is remounted on every opening; clients are stable for its lifetime.
  }, []);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (!active.current) return;
      if (mode.kind === 'search') searchRef.current?.focus();
      else editorContentRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [mode]);
  useEffect(() => {
    selectedRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedId]);

  async function hide() {
    try {
      await host.hide(session);
    } catch {
      if (active.current) setError('hide');
    }
  }
  async function copy(id: string) {
    if (copying.current) return;
    copying.current = true;
    setBusy(true);
    setFeedback(null);
    setError(null);
    try {
      await client.copyContent(id);
      if (active.current) setFeedback('copied');
    } catch {
      if (active.current) setError('copy');
    } finally {
      copying.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function openTin() {
    if (openingTin.current) return;
    openingTin.current = true;
    setBusy(true);
    setError(null);
    try {
      await host.openTin(session);
    } catch {
      if (active.current) setError('open');
    } finally {
      openingTin.current = false;
      if (active.current) setBusy(false);
    }
  }
  function openCreate() {
    setSaveError(null);
    setError(null);
    setFeedback(null);
    setMode({ kind: 'create' });
  }
  function openEdit(clipId: string) {
    setSaveError(null);
    setError(null);
    setFeedback(null);
    setMode({ kind: 'edit', clipId });
  }
  function cancelEditor() {
    setSaveError(null);
    setMode({ kind: 'search' });
  }
  function openGroup(groupId: string) {
    setError(null);
    setMode({ kind: 'group', groupId });
  }
  function openDelete(clip: Clip) {
    focusSearchAfterDelete.current = false;
    setDeleteError(null);
    setFeedback(null);
    setDeleteTarget(clip);
  }
  async function deleteClip() {
    if (!deleteTarget || deleting.current) return;
    const deletedId = deleteTarget.id;
    const deletedIndex = results.findIndex(
      (clip) => libraryItemId(clip) === deletedId,
    );
    const nextSelection =
      results[deletedIndex + 1] ?? results[deletedIndex - 1] ?? null;
    deleting.current = true;
    loadingGeneration.current += 1;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await client.delete(deletedId);
      if (!active.current) return;
      setClips((current) =>
        current.filter(
          (clip) => !(clip.kind === 'clip' && clip.clip.id === deletedId),
        ),
      );
      setSelectedId(nextSelection ? libraryItemId(nextSelection) : null);
      setFeedback('deleted');
      focusSearchAfterDelete.current = true;
      setDeleteTarget(null);
    } catch {
      if (active.current) setDeleteError('Clip could not be deleted.');
    } finally {
      deleting.current = false;
      if (active.current) setIsDeleting(false);
    }
  }
  async function saveDraft(draft: LauncherClipDraft) {
    if (saving.current) return;
    saving.current = true;
    loadingGeneration.current += 1;
    setIsSaving(true);
    setSaveError(null);
    try {
      let saved: Clip;
      if (modeRef.current.kind === 'create') {
        saved = await client.create({
          ...draft,
          title: null,
          sourceApp: null,
          sourceUrl: null,
          sourcePageTitle: null,
        });
        if (!active.current) return;
        setClips((current) => [
          { kind: 'clip', clip: saved },
          ...current.filter(
            (clip) => !(clip.kind === 'clip' && clip.clip.id === saved.id),
          ),
        ]);
      } else if (modeRef.current.kind === 'edit') {
        const clipId = modeRef.current.clipId;
        const latest = (await client.list()).map(asLibraryItem);
        if (!active.current || modeRef.current.kind !== 'edit') return;
        const storedItem = latest.find(
          (item) => item.kind === 'clip' && item.clip.id === clipId,
        );
        if (!storedItem || storedItem.kind !== 'clip') {
          setSaveError('This clip is no longer available.');
          return;
        }
        const input: ClipInput = {
          ...draft,
          title: storedItem.clip.title,
          sourceApp: storedItem.clip.sourceApp,
          sourceUrl: storedItem.clip.sourceUrl,
          sourcePageTitle: storedItem.clip.sourcePageTitle,
        };
        saved = await client.update(clipId, input);
        if (!active.current || modeRef.current.kind !== 'edit') return;
        setClips(
          latest.map((item) =>
            item.kind === 'clip' && item.clip.id === saved.id
              ? { kind: 'clip', clip: saved }
              : item,
          ),
        );
      } else return;
      if (!active.current) return;
      setQuery('');
      setSelectedId(saved.id);
      setFeedback('saved');
      setMode({ kind: 'search' });
    } catch {
      if (active.current) setSaveError('Clip could not be saved.');
    } finally {
      saving.current = false;
      if (active.current) setIsSaving(false);
    }
  }
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (
      event.nativeEvent.isComposing ||
      composing.current ||
      event.keyCode === 229
    )
      return;
    if (event.key === 'Escape') {
      if (deleteTarget) return;
      event.preventDefault();
      if (modeRef.current.kind !== 'search') cancelEditor();
      else void hide();
      return;
    }
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey)
      return;
    if (modeRef.current.kind !== 'search') return;
    // Buttons retain their native keyboard activation; only search owns navigation/copy.
    if (event.target !== searchRef.current) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const index = results.findIndex(
        (clip) => libraryItemId(clip) === selectedId,
      );
      const next =
        index === -1
          ? event.key === 'ArrowDown'
            ? 0
            : results.length - 1
          : Math.max(
              0,
              Math.min(
                results.length - 1,
                index + (event.key === 'ArrowDown' ? 1 : -1),
              ),
            );
      setSelectedId(results[next] ? libraryItemId(results[next]!) : null);
    } else if (event.key === 'Enter' && !event.repeat && selected && !loading) {
      event.preventDefault();
      if (selected.kind === 'clip') void copy(selected.clip.id);
      else openGroup(selected.group.id);
    }
  }
  return (
    <main className="launcher-shell" onKeyDown={onKeyDown}>
      <header className="launcher-header" data-tauri-drag-region>
        <span className="launcher-heading" data-tauri-drag-region>
          <GripVertical
            className="launcher-drag-handle"
            aria-hidden="true"
            data-tauri-drag-region
          />
          <span data-tauri-drag-region>Quick Search</span>
        </span>
        <div className="launcher-header-actions">
          {mode.kind === 'search' && (
            <Button
              variant="outline"
              size="sm"
              aria-label="New clip"
              onClick={openCreate}
            >
              <Plus aria-hidden="true" />
              New
            </Button>
          )}
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Open Slate"
            title="Open Slate"
            disabled={busy}
            onClick={() => void openTin()}
          >
            <AppWindow aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Close Quick Search"
            title="Close Quick Search"
            onClick={() => void hide()}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      </header>
      {mode.kind === 'search' ? (
        <>
          <Input
            ref={searchRef}
            type="search"
            aria-label="Search clips"
            role="searchbox"
            aria-controls="launcher-results"
            aria-activedescendant={
              selected ? `result-${libraryItemId(selected)}` : undefined
            }
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedId(null);
            }}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            autoComplete="off"
            spellCheck={false}
            placeholder="Search clips…"
          />
          {error && error !== 'load' && (
            <div className="launcher-error" role="alert">
              <span>
                {error === 'copy'
                  ? 'Clip could not be copied.'
                  : error === 'open'
                    ? 'Slate could not be opened.'
                    : 'Quick search could not close.'}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={
                  busy || (error === 'copy' && selected?.kind !== 'clip')
                }
                onClick={() => {
                  if (error === 'copy') {
                    if (selected?.kind === 'clip') void copy(selected.clip.id);
                  } else if (error === 'open') void openTin();
                  else void hide();
                }}
              >
                {error === 'copy'
                  ? 'Retry copy'
                  : error === 'open'
                    ? 'Retry opening'
                    : 'Retry closing'}
              </Button>
            </div>
          )}
          <ScrollArea
            className="launcher-results"
            id="launcher-results"
            role="listbox"
            aria-label="Clips"
            aria-busy={loading || busy}
          >
            <div className="launcher-results-content">
              {error === 'load' ? (
                <div className="launcher-state" role="alert">
                  <strong>Clips could not be loaded.</strong>
                  <span>Try loading your local clips again.</span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void load()}
                  >
                    Retry loading
                  </Button>
                </div>
              ) : loading ? (
                <div className="launcher-state" role="status">
                  <strong>Loading clips…</strong>
                </div>
              ) : results.length === 0 ? (
                <div className="launcher-state">
                  <strong>
                    {clips.length ? 'No matching clips' : 'No clips yet'}
                  </strong>
                  <span>
                    {clips.length
                      ? 'Try a different search.'
                      : 'Create or capture a clip to find it here.'}
                  </span>
                </div>
              ) : (
                results.map((clip) => {
                  const id = libraryItemId(clip);
                  const isSelected = id === selectedId;
                  return (
                    <div
                      key={id}
                      id={`result-${id}`}
                      ref={isSelected ? selectedRef : undefined}
                      role="option"
                      aria-selected={isSelected}
                      className="launcher-result"
                      onMouseDown={() => setSelectedId(id)}
                      onClick={() => {
                        setSelectedId(id);
                        if (window.getSelection()?.isCollapsed !== false)
                          searchRef.current?.focus();
                      }}
                    >
                      <div className="launcher-title-row">
                        <div className="launcher-title">
                          {libraryItemTitle(clip)}
                        </div>
                        {isSelected && clip.kind === 'clip' && (
                          <div className="launcher-title-actions">
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Edit selected clip"
                                    onMouseDown={(event) =>
                                      event.stopPropagation()
                                    }
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openEdit(clip.clip.id);
                                    }}
                                  />
                                }
                              >
                                <Pencil aria-hidden="true" />
                              </TooltipTrigger>
                              <TooltipContent>Edit clip</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Button
                                    ref={deleteTriggerRef}
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Delete selected clip"
                                    onMouseDown={(event) =>
                                      event.stopPropagation()
                                    }
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openDelete(clip.clip);
                                    }}
                                  />
                                }
                              >
                                <Trash2 aria-hidden="true" />
                              </TooltipTrigger>
                              <TooltipContent>Delete clip</TooltipContent>
                            </Tooltip>
                          </div>
                        )}
                      </div>
                      {isSelected && clip.kind === 'clip' ? (
                        <ScrollArea className="launcher-preview launcher-preview-scroll">
                          <span className="launcher-preview-content">
                            {clip.clip.content}
                          </span>
                        </ScrollArea>
                      ) : (
                        <div className="launcher-preview">
                          {libraryItemPreview(clip)}
                        </div>
                      )}
                      <div className="launcher-meta">
                        {libraryItemSourceLabel(clip)} ·{' '}
                        {libraryItemTypeLabel(clip)}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </ScrollArea>
          <footer className="launcher-footer">
            <span aria-live="polite">
              {busy
                ? 'Copying…'
                : feedback === 'copied'
                  ? 'Copied'
                  : feedback === 'saved'
                    ? 'Saved'
                    : feedback === 'deleted'
                      ? 'Deleted'
                      : `${results.length} ${results.length === 1 ? 'clip' : 'clips'}`}
            </span>
            <span>
              ↑↓ Select ·{' '}
              {selected?.kind === 'group' ? 'Enter Open' : 'Enter Copy all'} ·
              Ctrl+C Copy selection · Esc Close
            </span>
          </footer>
        </>
      ) : mode.kind === 'group' ? (
        <LauncherGroupView
          group={
            (
              clips.find(
                (item) =>
                  item.kind === 'group' && item.group.id === mode.groupId,
              ) as Extract<LibraryItem, { kind: 'group' }> | undefined
            )?.group
          }
          busy={busy}
          error={error}
          onBack={() => setMode({ kind: 'search' })}
          onCopy={(clip) => void copy(clip.id)}
          onOpenSource={async (clip) => {
            setError(null);
            try {
              await client.openSource(clip.id);
            } catch {
              if (active.current) setError('source');
            }
          }}
        />
      ) : (
        <LauncherClipEditor
          key={mode.kind === 'edit' ? mode.clipId : 'create'}
          mode={mode.kind}
          initialContent={
            mode.kind === 'edit'
              ? clips.find(
                  (item) =>
                    item.kind === 'clip' && item.clip.id === mode.clipId,
                )?.kind === 'clip'
                ? (
                    clips.find(
                      (item) =>
                        item.kind === 'clip' && item.clip.id === mode.clipId,
                    ) as { kind: 'clip'; clip: Clip }
                  ).clip.content
                : ''
              : ''
          }
          initialContentType={
            mode.kind === 'edit'
              ? ((
                  clips.find(
                    (item) =>
                      item.kind === 'clip' && item.clip.id === mode.clipId,
                  ) as { kind: 'clip'; clip: Clip } | undefined
                )?.clip.contentType ?? 'text')
              : 'text'
          }
          isSaving={isSaving}
          error={saveError}
          contentRef={editorContentRef}
          onCancel={cancelEditor}
          onSave={(draft) => void saveDraft(draft)}
        />
      )}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting.current) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
      >
        <AlertDialogContent
          finalFocus={() =>
            focusSearchAfterDelete.current
              ? searchRef.current
              : deleteTriggerRef.current
          }
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this clip?</AlertDialogTitle>
            <AlertDialogDescription>
              This clip will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <p className="launcher-delete-error" role="alert">
              {deleteError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isDeleting}
              onClick={() => void deleteClip()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
