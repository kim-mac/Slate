import {
  APP_NAME,
  CLIP_CONTENT_TYPES,
  type ClipContentType,
  type Clip,
  type ClipInput,
} from '@ai-clip-memory/shared';
import { ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useClipLibrary } from './hooks/useClipLibrary';
import {
  displayTitle,
  formatContentType,
  matchesSearch,
  recentClips,
  truncatePresentation,
} from './lib/clipRetrieval';
import { ClipFeedback } from './components/ClipFeedback';
import { LauncherAvailability } from './components/LauncherAvailability';
import { Button } from './components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select';

import { tauriClipClient, type ClipClient } from './clipClient';
import { AppSidebar, type AppView } from './components/AppSidebar';
import { ClipDetail } from './components/ClipDetail';
import { ClipFormDialog } from './components/ClipFormDialog';
import { ClipList } from './components/ClipList';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './components/ui/alert-dialog';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Separator } from './components/ui/separator';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from './components/ui/sidebar';
import { TooltipProvider } from './components/ui/tooltip';

type FormMode = { type: 'create' } | { type: 'edit'; clip: Clip };

interface AppProps {
  client?: ClipClient;
}

function safeErrorMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }
  return 'The local clip operation could not be completed.';
}

export function App({ client = tauriClipClient }: AppProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeView, setActiveView] = useState<AppView>('all');
  const {
    clips,
    setClips,
    isLoading,
    isRefreshing,
    loadError,
    refresh,
    invalidate,
  } = useClipLibrary(client);
  const [deleteTarget, setDeleteTarget] = useState<Clip | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const operationPending = useRef(false);
  const [contentType, setContentType] = useState<ClipContentType | 'all'>(
    'all',
  );
  const searchRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLElement>(null);
  const [searchText, setSearchText] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ message: string; id: number } | null>(
    null,
  );
  const noticeId = useRef(0);
  const dismissStatus = useCallback(() => setStatus(null), []);
  function notify(message: string) {
    setStatus({ message, id: ++noticeId.current });
  }
  function beginOperation() {
    if (operationPending.current || isRefreshing || isLoading) return false;
    operationPending.current = true;
    invalidate();
    setIsBusy(true);
    setStatus(null);
    return true;
  }
  function finishOperation() {
    operationPending.current = false;
    setIsBusy(false);
  }

  const visibleClips = useMemo(
    () =>
      recentClips(clips).filter(
        (clip) =>
          (activeView !== 'pinned' || clip.isPinned) &&
          (contentType === 'all' || clip.contentType === contentType) &&
          matchesSearch(clip, searchText),
      ),
    [activeView, clips, searchText, contentType],
  );
  const selectedClip =
    visibleClips.find((clip) => clip.id === selectedId) ??
    visibleClips[0] ??
    null;
  const pinnedCount = clips.filter((clip) => clip.isPinned).length;
  useEffect(() => {
    setSelectedId((current) =>
      visibleClips.some((clip) => clip.id === current)
        ? current
        : (visibleClips[0]?.id ?? null),
    );
  }, [visibleClips]);
  const hasSearch = !!searchText.trim();
  const hasTypeFilter = contentType !== 'all';
  const hasFilters = hasSearch || hasTypeFilter;
  const initialLoadFailure = !!loadError && clips.length === 0 && !isLoading;
  function clearFilters() {
    setSearchText('');
    setContentType('all');
  }

  function showLibrary(view: Exclude<AppView, 'settings'>) {
    setActiveView(view);
    setFormMode(null);
  }

  async function saveClip(input: ClipInput) {
    if (!beginOperation()) return;
    setFormError(null);
    setIsSaving(true);
    try {
      if (formMode?.type === 'edit') {
        const updated = await client.update(formMode.clip.id, input);
        setClips((current) =>
          current.map((clip) => (clip.id === updated.id ? updated : clip)),
        );
        setSelectedId(updated.id);
      } else {
        const created = await client.create(input);
        setClips((current) => [created, ...current]);
        setActiveView('all');
        setSelectedId(created.id);
      }
      setFormMode(null);
      setFormError(null);
      notify('Clip saved.');
    } catch (saveError) {
      setFormError(safeErrorMessage(saveError));
    } finally {
      setIsSaving(false);
      finishOperation();
    }
  }

  async function setPinned(clip: Clip, isPinned: boolean) {
    if (!beginOperation()) return;
    setActionError(null);
    try {
      const updated = await client.setPinned(clip.id, isPinned);
      setClips((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      notify(isPinned ? 'Clip pinned.' : 'Clip unpinned.');
    } catch (pinError) {
      setActionError(safeErrorMessage(pinError));
    } finally {
      finishOperation();
    }
  }

  async function deleteClip(clip: Clip) {
    if (!beginOperation()) return;
    setDeleteTarget(null);
    setActionError(null);
    try {
      await client.delete(clip.id);
      setClips((current) => current.filter((item) => item.id !== clip.id));
      setSelectedId(null);
      notify('Clip deleted.');
    } catch (deleteError) {
      setActionError(safeErrorMessage(deleteError));
    } finally {
      finishOperation();
    }
  }

  async function copyClip(clip: Clip) {
    if (!beginOperation()) return;
    setActionError(null);
    try {
      await client.copyContent(clip.id);
      notify('Clip copied.');
    } catch (copyError) {
      setActionError(safeErrorMessage(copyError));
    } finally {
      finishOperation();
    }
  }

  async function openSource(clip: Clip) {
    if (!beginOperation()) return;
    setActionError(null);
    try {
      await client.openSource(clip.id);
    } catch (openError) {
      setActionError(safeErrorMessage(openError));
    } finally {
      finishOperation();
    }
  }

  function focusSearch() {
    flushSync(() => {
      setSidebarOpen(true);
      if (activeView === 'settings') setActiveView('all');
    });
    searchRef.current?.focus();
    searchRef.current?.select();
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        event.altKey
      )
        return;
      if (!(event.ctrlKey || event.metaKey)) return;
      if (formMode || deleteTarget) {
        if (
          (event.key.toLowerCase() === 'f' && !event.shiftKey) ||
          (event.key.toLowerCase() === 'c' && event.shiftKey)
        )
          event.preventDefault();
        return;
      }
      if (event.key.toLowerCase() === 'f' && !event.shiftKey) {
        event.preventDefault();
        focusSearch();
      } else if (
        event.key.toLowerCase() === 'c' &&
        event.shiftKey &&
        activeView !== 'settings' &&
        selectedClip
      ) {
        const target = event.target;
        if (
          !(target instanceof HTMLElement) ||
          !libraryRef.current?.contains(target) ||
          target.closest(
            'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="combobox"], [role="dialog"], [role="alertdialog"]',
          )
        )
          return;
        if (window.getSelection()?.toString()) return;
        event.preventDefault();
        void copyClip(selectedClip);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <TooltipProvider>
      <div className="app-shell">
        <SidebarProvider
          className="workspace min-h-0"
          open={sidebarOpen}
          onOpenChange={setSidebarOpen}
        >
          <AppSidebar
            activeView={activeView}
            allCount={clips.length}
            searchText={searchText}
            pinnedCount={pinnedCount}
            searchRef={searchRef}
            onFocusSearch={focusSearch}
            disabled={isLoading || isRefreshing || isBusy}
            onSearchResults={() => {
              if (activeView === 'settings') return;
              libraryRef.current
                ?.querySelector<HTMLButtonElement>(
                  '.clip-list-item[aria-pressed="true"]',
                )
                ?.focus({ preventScroll: true });
            }}
            onNewClip={() => {
              setActiveView('all');
              setFormMode({ type: 'create' });
              setFormError(null);
            }}
            onSearchTextChange={setSearchText}
            onSelectView={(view) => {
              if (view === 'settings') {
                setActiveView('settings');
                setFormMode(null);
              } else {
                showLibrary(view);
              }
            }}
          />

          <SidebarInset className="desktop-main">
            <header className="desktop-header">
              <SidebarTrigger aria-expanded={sidebarOpen} />
              <Separator
                orientation="vertical"
                className="data-vertical:h-4 data-vertical:self-auto"
              />
              <span>
                {activeView === 'settings' ? 'Privacy & About' : 'Library'}
              </span>
            </header>
            <LauncherAvailability />
            <div className="content">
              {actionError && !formMode && (
                <p role="alert" className="error-message">
                  {actionError} Try the action again, or refresh the library.
                </p>
              )}

              {activeView !== 'settings' && (
                <section
                  className="library-view"
                  ref={libraryRef}
                  aria-labelledby="library-heading"
                >
                  <header className="section-header library-header">
                    <div>
                      <h1 id="library-heading">
                        {activeView === 'pinned' ? 'Pinned' : 'All Clips'}
                      </h1>
                      <p>
                        {activeView === 'pinned'
                          ? 'Keep frequently used clips within easy reach.'
                          : 'Your saved clips, newest first.'}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (!operationPending.current) void refresh();
                      }}
                      disabled={
                        isRefreshing || isBusy || !!formMode || !!deleteTarget
                      }
                    >
                      {isRefreshing ? 'Refreshing…' : 'Refresh'}
                    </Button>
                  </header>
                  <div className="retrieval-toolbar">
                    <Select
                      value={contentType}
                      onValueChange={(value) => {
                        if (
                          value === 'all' ||
                          CLIP_CONTENT_TYPES.includes(value as ClipContentType)
                        )
                          setContentType(value as ClipContentType | 'all');
                      }}
                    >
                      <SelectTrigger aria-label="Content type filter">
                        <SelectValue>
                          {contentType === 'all'
                            ? 'All types'
                            : formatContentType(contentType)}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent
                        align="start"
                        alignItemWithTrigger={false}
                        className="min-w-0"
                      >
                        <SelectItem value="all">All types</SelectItem>
                        {CLIP_CONTENT_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {formatContentType(type)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!isLoading && (
                      <span className="result-count" aria-live="polite">
                        {visibleClips.length}{' '}
                        {visibleClips.length === 1 ? 'result' : 'results'}
                      </span>
                    )}
                    {hasFilters && (
                      <Button size="sm" variant="ghost" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    )}
                  </div>
                  {loadError && clips.length > 0 && (
                    <div className="load-error">
                      <p role="alert">{loadError}</p>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isRefreshing || isBusy}
                        onClick={() => {
                          if (!operationPending.current) void refresh();
                        }}
                      >
                        Retry
                      </Button>
                    </div>
                  )}

                  {isLoading ? (
                    <div className="empty-state">
                      <p>Loading clips…</p>
                    </div>
                  ) : initialLoadFailure ? (
                    <div className="empty-state">
                      <h2>Library unavailable</h2>
                      <p role="alert">{loadError}</p>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isRefreshing || isBusy}
                        onClick={() => {
                          if (!operationPending.current) void refresh();
                        }}
                      >
                        Retry
                      </Button>
                    </div>
                  ) : visibleClips.length === 0 ? (
                    <div className="empty-state">
                      <div className="empty-state-mark" aria-hidden="true">
                        {activeView === 'pinned' ? '◇' : '□'}
                      </div>
                      <h2>
                        {hasSearch
                          ? 'No matching clips'
                          : hasTypeFilter
                            ? 'No clips of this type'
                            : activeView === 'pinned'
                              ? 'No pinned clips'
                              : 'No clips yet'}
                      </h2>
                      <p>
                        {hasSearch && hasTypeFilter
                          ? 'Try a different search or content type.'
                          : hasSearch
                            ? 'Try a different search.'
                            : hasTypeFilter
                              ? 'Choose another content type or clear the filter.'
                              : activeView === 'pinned'
                                ? 'Clips you pin will appear here.'
                                : 'Create a clip here or save one from your browser.'}
                      </p>
                    </div>
                  ) : (
                    <Card className="library-grid">
                      <ClipList
                        clips={visibleClips}
                        selectedId={selectedClip?.id ?? null}
                        onSelect={setSelectedId}
                      />
                      {selectedClip && (
                        <ClipDetail
                          clip={selectedClip}
                          disabled={isBusy || isRefreshing}
                          onCopy={() => void copyClip(selectedClip)}
                          onDelete={() => setDeleteTarget(selectedClip)}
                          onEdit={() => {
                            setFormError(null);
                            setFormMode({ type: 'edit', clip: selectedClip });
                          }}
                          onOpenSource={() => void openSource(selectedClip)}
                          onSetPinned={(isPinned) =>
                            void setPinned(selectedClip, isPinned)
                          }
                        />
                      )}
                    </Card>
                  )}
                </section>
              )}

              {activeView === 'settings' && (
                <section
                  className="settings-view"
                  aria-labelledby="settings-heading"
                >
                  <header className="section-header">
                    <h1 id="settings-heading">Privacy &amp; About</h1>
                    <p>Privacy and application information for local use.</p>
                  </header>

                  <Card
                    className="privacy-note"
                    aria-labelledby="privacy-heading"
                  >
                    <CardHeader>
                      <div className="privacy-heading-row">
                        <span className="privacy-mark" aria-hidden="true">
                          <ShieldCheck />
                        </span>
                        <CardTitle>
                          <h2 id="privacy-heading">Private by default</h2>
                        </CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p>
                        Your clips are stored locally on this computer. No
                        account or cloud connection is required.
                      </p>
                      <Separator />
                      <dl className="about-list">
                        <div>
                          <dt>Application</dt>
                          <dd>{APP_NAME}</dd>
                        </div>
                        <div>
                          <dt>Storage</dt>
                          <dd>Local only</dd>
                        </div>
                        <div>
                          <dt>Quick search</dt>
                          <dd>Ctrl+Shift+Space</dd>
                        </div>
                      </dl>
                    </CardContent>
                  </Card>
                </section>
              )}
            </div>
          </SidebarInset>
        </SidebarProvider>
        {status && (
          <ClipFeedback
            key={status.id}
            message={status.message}
            onDismiss={dismissStatus}
          />
        )}

        {formMode && activeView !== 'settings' && (
          <ClipFormDialog
            key={formMode.type === 'edit' ? formMode.clip.id : 'create'}
            {...(formMode.type === 'edit' ? { clip: formMode.clip } : {})}
            error={formError}
            isSaving={isSaving}
            open
            onOpenChange={(open) => {
              if (!open) {
                setFormMode(null);
                setFormError(null);
              }
            }}
            onSubmit={saveClip}
          />
        )}

        <AlertDialog
          open={deleteTarget !== null}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete clip?</AlertDialogTitle>
              <AlertDialogDescription>
                {deleteTarget
                  ? `Delete “${truncatePresentation(displayTitle(deleteTarget), 60)}”? This removes the clip from local storage and cannot be undone.`
                  : 'This removes the clip from local storage and cannot be undone.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  if (deleteTarget) void deleteClip(deleteTarget);
                }}
              >
                Delete clip
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}
