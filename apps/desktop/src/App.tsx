import {
  CLIP_CONTENT_TYPES,
  type ClipContentType,
  type Clip,
  type ClipInput,
  type ClipGroup,
  type LibraryItem,
} from '@ai-clip-memory/shared';
import { ListFilter, Moon, Plus, RefreshCw, Search, Sun } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useClipLibrary } from './hooks/useClipLibrary';
import {
  hasSameSourceHint,
  libraryItemRef,
  reconcileSelectedIds,
  selectedItemsInLibraryOrder,
} from './lib/mergeClips';
import {
  displayTitle,
  formatContentType,
  truncatePresentation,
} from './lib/clipRetrieval';
import {
  libraryItemId,
  libraryItemPinned,
  matchesLibraryItemContentType,
  matchesLibraryItemSearch,
  recentLibraryItems,
} from './lib/libraryItems';
import { ClipFeedback } from './components/ClipFeedback';
import { LauncherAvailability } from './components/LauncherAvailability';
import { SettingsView } from './components/SettingsView';
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
import { MergedClipDetail } from './components/MergedClipDetail';
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
type DeleteTarget =
  | { type: 'clip'; clip: Clip }
  | { type: 'member'; groupId: string; clip: Clip }
  | { type: 'group'; group: ClipGroup };
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
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
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
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [mergeError, setMergeError] = useState<string | null>(null);
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
      recentLibraryItems(clips).filter(
        (item) =>
          matchesLibraryItemContentType(item, contentType) &&
          matchesLibraryItemSearch(item, searchText),
      ),
    [clips, searchText, contentType],
  );
  const visibleClips = useMemo(
    () =>
      matchingClips.filter(
        (clip) => activeView !== 'pinned' || libraryItemPinned(clip),
      ),
    [activeView, matchingClips],
  );
  const sidebarClips = useMemo(
    () =>
      matchingClips.filter(
        (clip) => expandedSection !== 'pinned' || libraryItemPinned(clip),
      ),
    [expandedSection, matchingClips],
  );
  const selectedClip =
    clips.find((clip) => libraryItemId(clip) === selectedId) ?? null;
  const validSelectedCount = selectedItemsInLibraryOrder(
    clips,
    selectedClipIds,
  ).length;
  const pinnedCount = clips.filter(libraryItemPinned).length;
  const sameSourceHintIds = useMemo(
    () =>
      new Set(
        clips
          .filter((item) => hasSameSourceHint(item, selectedClipIds, clips))
          .map(libraryItemId),
      ),
    [clips, selectedClipIds],
  );
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

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedClipIds(new Set());
    setMergeError(null);
  }

  function toggleSelection(id: string) {
    setSelectedClipIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setMergeError(null);
  }

  async function startMerge() {
    const selected = selectedItemsInLibraryOrder(clips, selectedClipIds);
    if (selected.length < 2) {
      setMergeError('Select at least two clips to merge.');
      return;
    }
    if (!beginOperation()) return;
    setMergeError(null);
    try {
      const group = await client.merge(selected.map(libraryItemRef));
      setClips((current) => [
        { kind: 'group', group },
        ...current.filter((item) => !selectedClipIds.has(libraryItemId(item))),
      ]);
      exitSelectionMode();
      notify(`${group.members.length} clips merged`);
    } catch (error) {
      setMergeError(safeErrorMessage(error));
    } finally {
      finishOperation();
    }
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

  useEffect(() => {
    setSelectedClipIds((current) => {
      const next = reconcileSelectedIds(current, clips);
      return next.size === current.size ? current : next;
    });
  }, [clips]);

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
          current.map((item) =>
            item.kind === 'clip' && item.clip.id === updated.id
              ? { kind: 'clip', clip: updated }
              : item,
          ),
        );
        updateSelectedId(updated.id);
      } else {
        const created = await client.create(input);
        setClips((current) => [{ kind: 'clip', clip: created }, ...current]);
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
        current.map((item) =>
          item.kind === 'clip' && item.clip.id === updated.id
            ? { kind: 'clip', clip: updated }
            : item,
        ),
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
      setClips((current) =>
        current.filter(
          (item) => !(item.kind === 'clip' && item.clip.id === clip.id),
        ),
      );
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

  async function setItemPinned(item: LibraryItem, isPinned: boolean) {
    if (item.kind === 'clip') return setPinned(item.clip, isPinned);
    if (!beginOperation()) return;
    setActionError(null);
    try {
      const updated = await client.setGroupPinned(item.group.id, isPinned);
      setClips((current) =>
        current.map((candidate) =>
          candidate.kind === 'group' && candidate.group.id === updated.id
            ? { kind: 'group', group: updated }
            : candidate,
        ),
      );
      notify(isPinned ? 'Merged clip pinned.' : 'Merged clip unpinned.');
    } catch (error) {
      setActionError(safeErrorMessage(error));
    } finally {
      finishOperation();
    }
  }

  async function unmergeMember(group: ClipGroup, clip: Clip) {
    if (!beginOperation()) return;
    setActionError(null);
    try {
      await client.unmergeMember(group.id, clip.id);
      await refresh();
      notify('Clip unmerged.');
    } catch (error) {
      setActionError(safeErrorMessage(error));
    } finally {
      finishOperation();
    }
  }

  async function unmergeGroup(group: ClipGroup) {
    if (!beginOperation()) return;
    setActionError(null);
    try {
      await client.unmergeGroup(group.id);
      updateSelectedId(null);
      setDetailOrigin(null);
      returnToCalendar(null);
      await refresh();
      notify(`${group.members.length} clips unmerged.`);
    } catch (error) {
      setActionError(safeErrorMessage(error));
    } finally {
      finishOperation();
    }
  }

  async function deleteGroupMember(groupId: string, clip: Clip) {
    if (!beginOperation()) return;
    setDeleteTarget(null);
    setActionError(null);
    try {
      await client.deleteGroupMember(groupId, clip.id);
      await refresh();
      notify('Clip deleted.');
    } catch (error) {
      setActionError(safeErrorMessage(error));
    } finally {
      finishOperation();
    }
  }

  async function deleteGroup(group: ClipGroup) {
    if (!beginOperation()) return;
    setDeleteTarget(null);
    setActionError(null);
    try {
      await client.deleteGroup(group.id);
      setClips((current) =>
        current.filter(
          (item) => !(item.kind === 'group' && item.group.id === group.id),
        ),
      );
      if (currentSelectedId.current === group.id) {
        updateSelectedId(null);
        setDetailOrigin(null);
        returnToCalendar(null);
      }
      notify(`${group.members.length} clips deleted.`);
    } catch (error) {
      setActionError(safeErrorMessage(error));
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
      clips.some((clip) => libraryItemId(clip) === selectedId)
    )
      return;
    updateSelectedId(null);
    setDetailOrigin(null);
    returnToCalendar(null);
  }, [clips, isLoading, isRefreshing, selectedId, workspaceMode]);

  useEffect(() => {
    const refreshOnFocus = () => {
      if (
        isLoading ||
        isRefreshing ||
        formMode ||
        deleteTarget ||
        operationPending.current
      )
        return;
      void refresh();
    };
    window.addEventListener('focus', refreshOnFocus);
    return () => window.removeEventListener('focus', refreshOnFocus);
  }, [deleteTarget, formMode, isLoading, isRefreshing, refresh]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.key === 'Escape' &&
        selectionMode &&
        !formMode &&
        !deleteTarget &&
        !event.defaultPrevented &&
        !(
          event.target instanceof HTMLElement &&
          event.target.closest(
            '[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]',
          )
        )
      ) {
        event.preventDefault();
        exitSelectionMode();
        return;
      }
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
        selectedClip?.kind === 'clip'
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
        void copyClip(selectedClip.clip);
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
            onSelectClip={(id) => {
              if (expandedSection) setActiveView(expandedSection);
              openClip(id, {
                type: 'sidebar',
                focusTargetId: clipListItemElementId('sidebar-clip', id),
              });
            }}
            onToggleSection={toggleLibrarySection}
            pinnedCount={pinnedCount}
            selectedId={selectedClip ? libraryItemId(selectedClip) : null}
            selectionMode={selectionMode}
            selectedClipIds={selectedClipIds}
            onToggleSelection={toggleSelection}
            onSelectView={(view) => {
              if (view === 'settings') {
                exitSelectionMode();
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
              {activeView === 'settings' ? (
                <>
                  <Separator
                    orientation="vertical"
                    className="data-vertical:h-4 data-vertical:self-auto"
                  />
                  <span>Settings</span>
                </>
              ) : (
                <>
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
                    {selectionMode ? (
                      <>
                        <span className="merge-selected-count">
                          {validSelectedCount} selected
                        </span>
                        <Button
                          size="sm"
                          onClick={() => void startMerge()}
                          disabled={
                            validSelectedCount < 2 || isBusy || isRefreshing
                          }
                          aria-label="Merge selected"
                        >
                          Merge
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={exitSelectionMode}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          onClick={() => {
                            exitSelectionMode();
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
                        {workspaceMode === 'calendar' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectionMode(true);
                              setMergeError(null);
                            }}
                            disabled={isLoading || isBusy || isRefreshing}
                          >
                            Merge
                          </Button>
                        )}
                      </>
                    )}
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
                  {mergeError && selectionMode && (
                    <p className="error-message" role="alert">
                      {mergeError}
                    </p>
                  )}
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
                  ) : workspaceMode === 'detail' &&
                    selectedClip?.kind === 'clip' ? (
                    <ClipDetail
                      clip={selectedClip.clip}
                      disabled={isBusy || isRefreshing}
                      backButtonRef={detailBackRef}
                      onBack={() => returnToCalendar()}
                      onCopy={() => void copyClip(selectedClip.clip)}
                      onDelete={() =>
                        setDeleteTarget({
                          type: 'clip',
                          clip: selectedClip.clip,
                        })
                      }
                      onEdit={() => editClip(selectedClip.clip)}
                      onOpenSource={() => void openSource(selectedClip.clip)}
                      onSetPinned={(isPinned) =>
                        void setPinned(selectedClip.clip, isPinned)
                      }
                    />
                  ) : workspaceMode === 'detail' &&
                    selectedClip?.kind === 'group' ? (
                    <MergedClipDetail
                      group={selectedClip.group}
                      disabled={isBusy || isRefreshing}
                      backButtonRef={detailBackRef}
                      onBack={() => returnToCalendar()}
                      onSetPinned={(isPinned) =>
                        void setItemPinned(selectedClip, isPinned)
                      }
                      onUnmergeMember={(clip) =>
                        void unmergeMember(selectedClip.group, clip)
                      }
                      onDeleteMember={(clip) =>
                        setDeleteTarget({
                          type: 'member',
                          groupId: selectedClip.group.id,
                          clip,
                        })
                      }
                      onUnmergeGroup={() =>
                        void unmergeGroup(selectedClip.group)
                      }
                      onDeleteGroup={() =>
                        setDeleteTarget({
                          type: 'group',
                          group: selectedClip.group,
                        })
                      }
                      onOpenSource={(clip) => void openSource(clip)}
                    />
                  ) : (
                    <MemoryCalendar
                      actionsDisabled={isBusy || isRefreshing}
                      clips={visibleClips}
                      selectionMode={selectionMode}
                      selectedClipIds={selectedClipIds}
                      sameSourceHintIds={sameSourceHintIds}
                      onToggleSelection={toggleSelection}
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
                      onDeleteItem={(item) =>
                        setDeleteTarget(
                          item.kind === 'clip'
                            ? { type: 'clip', clip: item.clip }
                            : { type: 'group', group: item.group },
                        )
                      }
                      onEditClip={editClip}
                      onSetItemPinned={(item, isPinned) =>
                        void setItemPinned(item, isPinned)
                      }
                      headerControl={
                        <>
                          <Select
                            value={contentType}
                            onValueChange={(value) => {
                              if (
                                value === 'all' ||
                                CLIP_CONTENT_TYPES.includes(
                                  value as ClipContentType,
                                )
                              )
                                setContentType(
                                  value as ClipContentType | 'all',
                                );
                            }}
                          >
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <SelectTrigger
                                    size="sm"
                                    className="toolbar-icon-select size-7 justify-center gap-0 p-0 data-[active=true]:bg-accent data-[active=true]:text-accent-foreground [&>svg:last-child]:hidden"
                                    aria-label={
                                      contentType === 'all'
                                        ? 'Filter clips'
                                        : `Filter clips: ${formatContentType(contentType)}`
                                    }
                                    data-active={
                                      hasTypeFilter ? 'true' : undefined
                                    }
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
                          {hasFilters && (
                            <Button
                              type="button"
                              size="xs"
                              variant="ghost"
                              onClick={clearFilters}
                            >
                              Clear filters
                            </Button>
                          )}
                        </>
                      }
                      visibleMonth={visibleMonth}
                      onVisibleMonthChange={setVisibleMonth}
                    />
                  )}
                </section>
              )}

              {activeView === 'settings' && (
                <SettingsView startupClient={startupClient} />
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
              <AlertDialogTitle>
                {deleteTarget?.type === 'group'
                  ? 'Delete merged clip?'
                  : 'Delete clip?'}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {deleteTarget?.type === 'group'
                  ? `Permanently delete all ${deleteTarget.group.members.length} clips in “${truncatePresentation(deleteTarget.group.title, 60)}”? This cannot be undone.`
                  : deleteTarget
                    ? `Permanently delete “${truncatePresentation(displayTitle(deleteTarget.clip), 60)}”? This removes the clip from local storage and cannot be undone.`
                    : 'This removes the clip from local storage and cannot be undone.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  if (deleteTarget?.type === 'clip')
                    void deleteClip(deleteTarget.clip);
                  else if (deleteTarget?.type === 'member')
                    void deleteGroupMember(
                      deleteTarget.groupId,
                      deleteTarget.clip,
                    );
                  else if (deleteTarget?.type === 'group')
                    void deleteGroup(deleteTarget.group);
                }}
              >
                {deleteTarget?.type === 'group'
                  ? `Delete all ${deleteTarget.group.members.length} clips`
                  : 'Delete clip'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}
