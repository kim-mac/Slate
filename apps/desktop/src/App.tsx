import {
  APP_NAME,
  CLIP_CONTENT_TYPES,
  type ClipContentType,
  type Clip,
  type ClipInput,
} from '@ai-clip-memory/shared';
import {
  ListFilter,
  Moon,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sun,
} from 'lucide-react';
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
import { StartupSetting } from './components/StartupSetting';
import {
  calendarClipElementId,
  MemoryCalendar,
} from './components/calendar/MemoryCalendar';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from './components/ui/select';

import { tauriClipClient, type ClipClient } from './clipClient';
import { tauriStartupClient, type StartupClient } from './startupClient';
import { AppSidebar, type AppView } from './components/AppSidebar';
import { ClipDetail } from './components/ClipDetail';
import { clipListItemElementId } from './components/ClipList';
import { ClipFormDialog } from './components/ClipFormDialog';
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
  calendarMonthFromDate,
  calendarMonthFromTimestamp,
} from './lib/memoryCalendar';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from './components/ui/sidebar';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './components/ui/tooltip';
import {
  persistThemeMode,
  readThemeMode,
  type ThemeMode,
} from './themePreference';

type FormMode = { type: 'create' } | { type: 'edit'; clip: Clip };
type WorkspaceMode = 'calendar' | 'detail';
type DetailOrigin = {
  type: 'calendar' | 'sidebar' | 'create';
  focusTargetId?: string;
  fallbackFocusTargetId?: string;
};

interface AppProps {
  client?: ClipClient;
  startupClient?: StartupClient;
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

export function App({
  client = tauriClipClient,
  startupClient = tauriStartupClient,
}: AppProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeView, setActiveView] = useState<AppView>('all');
  const [expandedSection, setExpandedSection] = useState<Exclude<
    AppView,
    'settings'
  > | null>('all');
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
  const [themeMode, setThemeMode] = useState<ThemeMode>(readThemeMode);
  const searchRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLElement>(null);
  const clipListRef = useRef<HTMLDivElement>(null);
  const [searchText, setSearchText] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const currentSelectedId = useRef<string | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('calendar');
  const currentWorkspaceMode = useRef<WorkspaceMode>('calendar');
  const [detailOrigin, setDetailOrigin] = useState<DetailOrigin | null>(null);
  const [visibleMonth, setVisibleMonth] = useState(() =>
    calendarMonthFromDate(new Date()),
  );
  const detailBackRef = useRef<HTMLButtonElement>(null);
  const pendingCalendarFocus = useRef<
    | {
        targetId: string | null;
        fallbackId: string | null;
      }
    | undefined
  >(undefined);
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

  const matchingClips = useMemo(
    () =>
      recentClips(clips).filter(
        (clip) =>
          (contentType === 'all' || clip.contentType === contentType) &&
          matchesSearch(clip, searchText),
      ),
    [clips, searchText, contentType],
  );
  const visibleClips = useMemo(
    () =>
      matchingClips.filter((clip) => activeView !== 'pinned' || clip.isPinned),
    [activeView, matchingClips],
  );
  const sidebarClips = useMemo(
    () =>
      matchingClips.filter(
        (clip) => expandedSection !== 'pinned' || clip.isPinned,
      ),
    [expandedSection, matchingClips],
  );
  const selectedClip = clips.find((clip) => clip.id === selectedId) ?? null;
  const pinnedCount = clips.filter((clip) => clip.isPinned).length;
  const hasSearch = !!searchText.trim();
  const hasTypeFilter = contentType !== 'all';
  const hasFilters = hasSearch || hasTypeFilter;
  const initialLoadFailure = !!loadError && clips.length === 0 && !isLoading;
  const ThemeIcon = themeMode === 'light' ? Sun : Moon;
  const themeActionLabel =
    themeMode === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
  function clearFilters() {
    setSearchText('');
    setContentType('all');
  }

  function updateSelectedId(id: string | null) {
    currentSelectedId.current = id;
    setSelectedId(id);
  }

  function openClip(id: string, origin: DetailOrigin) {
    updateSelectedId(id);
    setDetailOrigin(origin);
    currentWorkspaceMode.current = 'detail';
    setWorkspaceMode('detail');
  }

  function returnToCalendar(origin: DetailOrigin | null = detailOrigin) {
    if (currentWorkspaceMode.current === 'calendar') return;
    currentWorkspaceMode.current = 'calendar';
    pendingCalendarFocus.current = {
      targetId: origin?.focusTargetId ?? null,
      fallbackId: origin?.fallbackFocusTargetId ?? null,
    };
    setWorkspaceMode('calendar');
  }

  function editClip(clip: Clip) {
    setFormError(null);
    setFormMode({ type: 'edit', clip });
  }

  function showLibrary(view: Exclude<AppView, 'settings'>) {
    setActiveView(view);
    setExpandedSection(view);
    setFormMode(null);
  }

  function toggleLibrarySection(view: Exclude<AppView, 'settings'>) {
    setActiveView(view);
    setExpandedSection((current) => (current === view ? null : view));
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
        updateSelectedId(updated.id);
      } else {
        const created = await client.create(input);
        setClips((current) => [created, ...current]);
        setActiveView('all');
        setExpandedSection('all');
        const createdMonth = calendarMonthFromTimestamp(created.createdAt);
        if (createdMonth) setVisibleMonth(createdMonth);
        openClip(created.id, { type: 'create' });
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
      if (currentSelectedId.current === clip.id) {
        updateSelectedId(null);
        setDetailOrigin(null);
        returnToCalendar(null);
      }
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
      if (activeView === 'settings') {
        setActiveView('all');
        setExpandedSection('all');
      }
    });
    searchRef.current?.focus();
    searchRef.current?.select();
  }

  useEffect(() => {
    persistThemeMode(themeMode);

    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [themeMode]);

  useEffect(() => {
    if (workspaceMode !== 'detail' || !selectedClip) return;
    detailBackRef.current?.focus();
  }, [selectedId, selectedClip, workspaceMode]);

  useEffect(() => {
    if (
      workspaceMode !== 'calendar' ||
      activeView === 'settings' ||
      pendingCalendarFocus.current === undefined
    )
      return;
    const { targetId, fallbackId } = pendingCalendarFocus.current;
    const target = targetId ? document.getElementById(targetId) : null;
    const fallback = fallbackId ? document.getElementById(fallbackId) : null;
    (
      target ??
      fallback ??
      document.getElementById('calendar-month-heading')
    )?.focus();
    pendingCalendarFocus.current = undefined;
  }, [activeView, workspaceMode]);

  useEffect(() => {
    if (
      workspaceMode !== 'detail' ||
      !selectedId ||
      isLoading ||
      isRefreshing ||
      clips.some((clip) => clip.id === selectedId)
    )
      return;
    updateSelectedId(null);
    setDetailOrigin(null);
    returnToCalendar(null);
  }, [clips, isLoading, isRefreshing, selectedId, workspaceMode]);

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
        workspaceMode === 'detail' &&
        selectedClip
      ) {
        const target = event.target;
        if (
          !(target instanceof HTMLElement) ||
          (!libraryRef.current?.contains(target) &&
            !clipListRef.current?.contains(target)) ||
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
            clips={sidebarClips}
            clipListRef={clipListRef}
            expandedSection={expandedSection}
            hasFilters={hasFilters}
            isLoading={isLoading}
            onClearFilters={clearFilters}
            onSelectClip={(id) => {
              if (expandedSection) setActiveView(expandedSection);
              openClip(id, {
                type: 'sidebar',
                focusTargetId: clipListItemElementId('sidebar-clip', id),
              });
            }}
            onToggleSection={toggleLibrarySection}
            pinnedCount={pinnedCount}
            selectedId={selectedClip?.id ?? null}
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
              {activeView === 'settings' ? (
                <span>Privacy & About</span>
              ) : (
                <>
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
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <SelectTrigger
                            size="sm"
                            className="toolbar-icon-select size-7 data-[active=true]:bg-accent data-[active=true]:text-accent-foreground [&>svg:last-child]:hidden"
                            aria-label={
                              contentType === 'all'
                                ? 'Filter clips'
                                : `Filter clips: ${formatContentType(contentType)}`
                            }
                            data-active={hasTypeFilter ? 'true' : undefined}
                          />
                        }
                      >
                        <ListFilter aria-hidden="true" />
                      </TooltipTrigger>
                      <TooltipContent>Filter clips</TooltipContent>
                    </Tooltip>
                    <SelectContent
                      align="start"
                      alignItemWithTrigger={false}
                      className="w-36"
                    >
                      <SelectItem value="all">All types</SelectItem>
                      {CLIP_CONTENT_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {formatContentType(type)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="desktop-header-center">
                    <label className="sr-only" htmlFor="clip-search">
                      Search clips
                    </label>
                    <div className="search-field desktop-header-search">
                      <Search aria-hidden="true" />
                      <Input
                        id="clip-search"
                        ref={searchRef}
                        className="h-7"
                        title="Search clips (Ctrl+F)"
                        onKeyDown={(event) => {
                          if (
                            event.key === 'ArrowDown' &&
                            !event.ctrlKey &&
                            !event.metaKey &&
                            !event.altKey &&
                            !event.shiftKey &&
                            !event.nativeEvent.isComposing
                          ) {
                            event.preventDefault();
                            clipListRef.current
                              ?.querySelector<HTMLButtonElement>(
                                '.clip-list-item[aria-pressed="true"]',
                              )
                              ?.focus({ preventScroll: true });
                          }
                        }}
                        type="search"
                        placeholder="Search clips..."
                        value={searchText}
                        onChange={(event) =>
                          setSearchText(event.currentTarget.value)
                        }
                      />
                    </div>
                    <Button
                      size="sm"
                      onClick={() => {
                        setActiveView('all');
                        setExpandedSection('all');
                        setFormMode({ type: 'create' });
                        setFormError(null);
                      }}
                      disabled={isLoading || isRefreshing || isBusy}
                    >
                      <Plus aria-hidden="true" />
                      New clip
                    </Button>
                  </div>
                  <div className="desktop-header-actions">
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="outline"
                            size="icon-sm"
                            aria-label={themeActionLabel}
                            onClick={() =>
                              setThemeMode((current) =>
                                current === 'light' ? 'dark' : 'light',
                              )
                            }
                          />
                        }
                      >
                        <ThemeIcon className="size-4" aria-hidden="true" />
                      </TooltipTrigger>
                      <TooltipContent>{themeActionLabel}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="outline"
                            size="icon-sm"
                            aria-label="Refresh"
                            onClick={() => {
                              if (!operationPending.current) void refresh();
                            }}
                            disabled={
                              isRefreshing ||
                              isBusy ||
                              !!formMode ||
                              !!deleteTarget
                            }
                          />
                        }
                      >
                        <RefreshCw aria-hidden="true" />
                      </TooltipTrigger>
                      <TooltipContent>Refresh</TooltipContent>
                    </Tooltip>
                  </div>
                </>
              )}
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
                  aria-label={activeView === 'pinned' ? 'Pinned' : 'All Clips'}
                >
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
                  ) : workspaceMode === 'detail' && selectedClip ? (
                    <ClipDetail
                      clip={selectedClip}
                      disabled={isBusy || isRefreshing}
                      backButtonRef={detailBackRef}
                      onBack={() => returnToCalendar()}
                      onCopy={() => void copyClip(selectedClip)}
                      onDelete={() => setDeleteTarget(selectedClip)}
                      onEdit={() => editClip(selectedClip)}
                      onOpenSource={() => void openSource(selectedClip)}
                      onSetPinned={(isPinned) =>
                        void setPinned(selectedClip, isPinned)
                      }
                    />
                  ) : (
                    <MemoryCalendar
                      actionsDisabled={isBusy || isRefreshing}
                      clips={visibleClips}
                      onActivateClip={(id, element) => {
                        const fallbackFocusTargetId =
                          element.closest<HTMLElement>('[role="gridcell"]')?.id;
                        openClip(id, {
                          type: 'calendar',
                          focusTargetId:
                            element.id || calendarClipElementId(id),
                          ...(fallbackFocusTargetId
                            ? { fallbackFocusTargetId }
                            : {}),
                        });
                      }}
                      onCopyClip={(clip) => void copyClip(clip)}
                      onDeleteClip={setDeleteTarget}
                      onEditClip={editClip}
                      onSetPinned={(clip, isPinned) =>
                        void setPinned(clip, isPinned)
                      }
                      visibleMonth={visibleMonth}
                      onVisibleMonthChange={setVisibleMonth}
                    />
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
                  <StartupSetting client={startupClient} />
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
