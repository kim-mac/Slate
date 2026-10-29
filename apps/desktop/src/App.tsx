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
import { useInstallationSafety } from './hooks/useInstallationSafety';
import { useInlineClipContent } from './hooks/useInlineClipContent';
import { tauriExtensionClient, type ExtensionClient } from './extensionClient';
import {
  tauriInstallationSafetyClient,
  type InstallationSafetyClient,
  type SafetyLease,
} from './installationSafetyClient';
import {
  hasSameSourceHint,
  libraryItemRef,
  reconcileSelectedIds,
  selectedItemsInLibraryOrder,
  selectedItemsInSelectionOrder,
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
  libraryItemContainingClip,
  replaceLibraryClip,
  removeLibraryClip,
  asLibraryItem,
  findLibraryClip,
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
import { tauriUpdaterClient, type UpdaterClient } from './updaterClient';
import { useUpdater } from './hooks/useUpdater';
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
  extensionClient?: ExtensionClient;
  client?: ClipClient;
  startupClient?: StartupClient;
  updaterClient?: UpdaterClient;
  safetyClient?: InstallationSafetyClient;
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
  extensionClient = tauriExtensionClient,
  client = tauriClipClient,
  startupClient = tauriStartupClient,
  updaterClient = tauriUpdaterClient,
  safetyClient = tauriInstallationSafetyClient,
}: AppProps) {
  const safety = useInstallationSafety(safetyClient);
  const editorLease = useRef<SafetyLease | null>(null);
  const confirmationLease = useRef<SafetyLease | null>(null);
  const editorOpening = useRef(false);
  const editorClosing = useRef(false);
  const confirmationOpening = useRef(false);
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
    readLatest,
  } = useClipLibrary(client);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const operationPending = useRef(false);
  const actionResolving = useRef(false);
  const [isActionResolving, setIsActionResolving] = useState(false);
  const latestLibrary = useRef(clips);
  latestLibrary.current = clips;
  const [inlineGroup, setInlineGroup] = useState<ClipGroup | null>(null);
  const inline = useInlineClipContent({
    client,
    safety,
    beginOperation,
    finishOperation,
    onSaved: async (updated) => {
      if (updated.kind === 'clip') {
        setClips((current) => replaceLibraryClip(current, updated.clip));
        await reconcileSavedClip(updated.clip);
      } else {
        setClips((current) =>
          current.map((item) =>
            item.kind === 'group' && item.group.id === updated.group.id
              ? updated
              : item,
          ),
        );
        try {
          const latest = await readLatest();
          if (!latest) return;
          latestLibrary.current = latest;
          setClips(latest);
        } catch {
          setActionError(
            'Title saved, but the library could not refresh. Refresh the library to see its current state.',
          );
        }
      }
    },
    onFinished: async (edited, kind) => {
      if (!inlineGroup && kind === 'content') return;
      try {
        const latest = await readLatest();
        if (!latest) {
          setInlineGroup(null);
          return;
        }
        latestLibrary.current = latest;
        setClips(latest);
      } catch {
        setActionError(
          'Editing finished, but the library could not refresh. Refresh the library to see its current group.',
        );
      }
      const containing =
        edited.kind === 'clip'
          ? libraryItemContainingClip(latestLibrary.current, edited.clip.id)
          : (latestLibrary.current.find(
              (item) =>
                item.kind === 'group' && item.group.id === edited.group.id,
            ) ??
            edited.group.members
              .map((member) =>
                libraryItemContainingClip(latestLibrary.current, member.id),
              )
              .find(Boolean));
      updateSelectedId(containing ? libraryItemId(containing) : null);
      if (!containing) {
        setDetailOrigin(null);
        currentWorkspaceMode.current = 'calendar';
        setWorkspaceMode('calendar');
      }
      setInlineGroup(null);
    },
  });
  const updateBlocked = Boolean(
    formMode ||
    deleteTarget ||
    isSaving ||
    isBusy ||
    isActionResolving ||
    safety.frozen ||
    inline.draft ||
    inline.isOpening,
  );
  const updater = useUpdater(updaterClient, updateBlocked);
  const closeRequested = useRef<() => void>(() => undefined);
  closeRequested.current = () => {
    if (!inline.isActive()) {
      setActionError('Finish the current editor before closing Slate.');
      return;
    }
    inline.afterSave(async () => {
      try {
        if (!safetyClient.hideMainAfterSave)
          throw new Error('Hide unavailable');
        await safetyClient.hideMainAfterSave();
      } catch {
        setActionError(
          'Your content is saved, but Slate could not hide. Try closing the window again.',
        );
      }
    });
  };
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void safetyClient
      .onCloseRequested?.(() => {
        if (active) closeRequested.current();
      })
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch(() => {
        if (active)
          setActionError(
            'Slate could not connect its close safeguard. Save or cancel editing before closing.',
          );
      });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [safetyClient]);
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
  function beginOperation(repeatedFeedback?: string) {
    if (
      operationPending.current ||
      actionResolving.current ||
      isRefreshing ||
      isLoading ||
      safety.frozen
    )
      return false;
    operationPending.current = true;
    invalidate();
    setIsBusy(true);
    if (status?.message !== repeatedFeedback) setStatus(null);
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
  // A background capture can group the selected clip while its inline draft is
  // open. Keep that editor mounted until persistence/cancellation and lease
  // cleanup finish, then resolve the containing group by the same clip ID.
  const currentInlineGroup = inlineGroup
    ? clips.find(
        (item) => item.kind === 'group' && item.group.id === inlineGroup.id,
      )
    : undefined;
  const selectedClip: LibraryItem | null =
    inlineGroup &&
    (inline.editingClip || inline.editingGroup) &&
    inline.isActive()
      ? {
          kind: 'group',
          group:
            currentInlineGroup?.kind === 'group'
              ? currentInlineGroup.group
              : { ...inlineGroup, members: [] },
        }
      : inline.editingClip &&
          inline.isActive() &&
          inline.editingClip.id === selectedId
        ? { kind: 'clip', clip: inline.editingClip }
        : (clips.find((item) => libraryItemId(item) === selectedId) ??
          (selectedId
            ? libraryItemContainingClip(clips, selectedId)
            : undefined) ??
          null);
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
  const initialLoadFailure =
    !!loadError && clips.length === 0 && !isLoading && !inline.isActive();
  const ThemeIcon = themeMode === 'light' ? Sun : Moon;
  const themeActionLabel =
    themeMode === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
  function clearFilters() {
    setSearchText('');
    setContentType('all');
  }

  function refreshLibrary() {
    if (actionResolving.current) return;
    if (inline.isActive()) {
      inline.afterSave(refreshLibrary);
      return;
    }
    if (!operationPending.current) {
      setStatus(null);
      setActionError(null);
      void refresh();
    }
  }

  function deferInlineAction(
    action: (latest: LibraryItem[]) => void | Promise<void>,
  ): boolean {
    if (actionResolving.current) return true;
    if (!inline.isActive()) return false;
    inline.afterSave(async () => {
      actionResolving.current = true;
      setIsActionResolving(true);
      try {
        const latest = await readLatest();
        if (!latest) {
          unavailableAction();
          return;
        }
        latestLibrary.current = latest;
        setClips(latest);
        actionResolving.current = false;
        setIsActionResolving(false);
        await action(latest);
      } catch {
        setStatus(null);
        setActionError(
          'Could not complete the requested action. Refresh the library and try again.',
        );
      } finally {
        actionResolving.current = false;
        setIsActionResolving(false);
      }
    });
    return true;
  }

  function unavailableAction() {
    setStatus(null);
    setActionError(
      'This clip or group changed or is no longer available. Refresh the library and try again.',
    );
  }

  function groupIn(items: LibraryItem[], id: string) {
    const item = items.find(
      (candidate) => candidate.kind === 'group' && candidate.group.id === id,
    );
    return item?.kind === 'group' ? item.group : undefined;
  }

  async function beginInline(clip: Clip, group?: ClipGroup, title = false) {
    if (
      deferInlineAction(async (latest) => {
        const current = findLibraryClip(latest, clip.id);
        if (!current) {
          unavailableAction();
          return;
        }
        const containing = libraryItemContainingClip(latest, clip.id);
        if (title && containing?.kind === 'group') {
          unavailableAction();
          return;
        }
        await beginInline(
          current,
          containing?.kind === 'group' ? containing.group : undefined,
          title,
        );
      })
    )
      return;
    if (
      formMode ||
      deleteTarget ||
      editorOpening.current ||
      editorClosing.current ||
      confirmationOpening.current ||
      editorLease.current ||
      confirmationLease.current ||
      operationPending.current
    )
      return;
    setStatus(null);
    setInlineGroup(group ?? null);
    currentWorkspaceMode.current = 'detail';
    setWorkspaceMode('detail');
    if (group) updateSelectedId(group.id);
    else updateSelectedId(clip.id);
    if (!(await (title ? inline.beginTitle(clip) : inline.begin(clip))))
      setInlineGroup(null);
  }

  async function beginGroupTitle(group: ClipGroup) {
    if (
      deferInlineAction(async (latest) => {
        const current = groupIn(latest, group.id);
        if (current) await beginGroupTitle(current);
        else unavailableAction();
      })
    )
      return;
    if (
      formMode ||
      deleteTarget ||
      editorOpening.current ||
      editorClosing.current ||
      confirmationOpening.current ||
      editorLease.current ||
      confirmationLease.current ||
      operationPending.current
    )
      return;
    if (!group.titleState) {
      unavailableAction();
      return;
    }
    setStatus(null);
    setInlineGroup(group);
    updateSelectedId(group.id);
    currentWorkspaceMode.current = 'detail';
    setWorkspaceMode('detail');
    if (!(await inline.beginGroupTitle(group))) setInlineGroup(null);
  }

  function requestMemberMenu(group: ClipGroup, clip: Clip, open: () => void) {
    const resolve = async (latest: LibraryItem[]) => {
      const current = groupIn(latest, group.id);
      if (current?.members.some((member) => member.id === clip.id)) open();
      else unavailableAction();
    };
    if (
      deferInlineAction(resolve) ||
      operationPending.current ||
      actionResolving.current
    )
      return;
    actionResolving.current = true;
    setIsActionResolving(true);
    void readLatest()
      .then((latest) => {
        if (!latest) {
          unavailableAction();
          return;
        }
        latestLibrary.current = latest;
        setClips(latest);
        return resolve(latest);
      })
      .catch(unavailableAction)
      .finally(() => {
        actionResolving.current = false;
        setIsActionResolving(false);
      });
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
    const selected = selectedItemsInSelectionOrder(clips, selectedClipIds);
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
      setStatus(null);
    } finally {
      finishOperation();
    }
  }

  function updateSelectedId(id: string | null) {
    currentSelectedId.current = id;
    setSelectedId(id);
  }

  function openClip(id: string, origin: DetailOrigin) {
    if (
      deferInlineAction((latest) => {
        const target =
          latest.find((item) => libraryItemId(item) === id) ??
          libraryItemContainingClip(latest, id);
        if (target) openClip(libraryItemId(target), origin);
        else unavailableAction();
      })
    )
      return;
    updateSelectedId(id);
    setDetailOrigin(origin);
    currentWorkspaceMode.current = 'detail';
    setWorkspaceMode('detail');
  }

  function returnToCalendar(origin: DetailOrigin | null = detailOrigin) {
    if (actionResolving.current) return;
    if (inline.isActive()) {
      inline.afterSave(() => returnToCalendar(origin));
      return;
    }
    if (currentWorkspaceMode.current === 'calendar') return;
    currentWorkspaceMode.current = 'calendar';
    pendingCalendarFocus.current = {
      targetId: origin?.focusTargetId ?? null,
      fallbackId: origin?.fallbackFocusTargetId ?? null,
    };
    setWorkspaceMode('calendar');
  }

  async function openEditor(mode: FormMode) {
    if (
      deferInlineAction(async (latest) => {
        if (mode.type === 'create') await openEditor(mode);
        else {
          const target = findLibraryClip(latest, mode.clip.id);
          if (target) await openEditor({ type: 'edit', clip: target });
          else unavailableAction();
        }
      })
    )
      return;
    if (
      editorOpening.current ||
      editorClosing.current ||
      formMode ||
      operationPending.current
    )
      return;
    editorOpening.current = true;
    setStatus(null);
    try {
      // A completed save may have lost its release acknowledgement. Retry only
      // the lease cleanup, never the already-confirmed database mutation.
      if (editorLease.current) {
        if (!(await safety.release(editorLease.current))) return;
        editorLease.current = null;
      }
      const lease = await safety.acquire('editor');
      if (!lease) {
        setActionError('Slate is not ready to open an editor. Try again.');
        return;
      }
      editorLease.current = lease;
      setFormError(null);
      if (mode.type === 'create') {
        exitSelectionMode();
        setActiveView('all');
        setExpandedSection('all');
      }
      setFormMode(mode);
    } finally {
      editorOpening.current = false;
    }
  }
  function editClip(clip: Clip) {
    void openEditor({ type: 'edit', clip });
  }
  async function cancelEditor() {
    if (
      operationPending.current ||
      isSaving ||
      editorOpening.current ||
      editorClosing.current
    )
      return false;
    editorClosing.current = true;
    // Cancellation is explicit. End editing before awaiting lease cleanup so
    // input cannot change after the user has chosen to discard the draft.
    setFormMode(null);
    setFormError(null);
    try {
      if (!(await safety.release(editorLease.current))) return false;
      editorLease.current = null;
      return true;
    } finally {
      editorClosing.current = false;
    }
  }
  async function requestDelete(target: DeleteTarget) {
    if (
      deferInlineAction(async (latest) => {
        if (target.type === 'group') {
          const group = groupIn(latest, target.group.id);
          if (group) await requestDelete({ ...target, group });
          else unavailableAction();
        } else {
          const clip = findLibraryClip(latest, target.clip.id);
          if (
            clip &&
            (target.type === 'clip' ||
              groupIn(latest, target.groupId)?.members.some(
                (member) => member.id === clip.id,
              ))
          )
            await requestDelete({ ...target, clip });
          else unavailableAction();
        }
      })
    )
      return;
    if (confirmationOpening.current || deleteTarget || operationPending.current)
      return;
    confirmationOpening.current = true;
    try {
      if (confirmationLease.current) {
        if (!(await releaseConfirmation())) return;
      }
      const lease = await safety.acquire('confirmation');
      if (!lease) {
        setActionError('Slate is not ready to open a confirmation. Try again.');
        return;
      }
      confirmationLease.current = lease;
      if (target.type === 'group') {
        const latest = await readLatest();
        const group = latest && groupIn(latest, target.group.id);
        if (!group) {
          unavailableAction();
          await releaseConfirmation();
          return;
        }
        // Keep the reviewed membership fixed even if the library later refreshes.
        setDeleteTarget({
          type: 'group',
          group: { ...group, members: [...group.members] },
        });
      } else {
        setDeleteTarget(target);
      }
    } catch {
      setStatus(null);
      setActionError(
        'Could not load this group. Refresh the library and try again.',
      );
      await releaseConfirmation();
    } finally {
      confirmationOpening.current = false;
    }
  }
  async function releaseConfirmation() {
    if (!(await safety.release(confirmationLease.current))) return false;
    confirmationLease.current = null;
    return true;
  }

  function afterEditorClosed(navigate: () => void) {
    if (actionResolving.current) return;
    if (inline.isActive()) {
      inline.afterSave(navigate);
      return;
    }
    if (
      editorOpening.current ||
      editorClosing.current ||
      operationPending.current
    )
      return;
    if (!editorLease.current) {
      navigate();
      return;
    }
    void cancelEditor().then((closed) => {
      if (closed) navigate();
    });
  }

  function showLibrary(view: Exclude<AppView, 'settings'>) {
    afterEditorClosed(() => {
      setActiveView(view);
      setExpandedSection(view);
      setFormMode(null);
    });
  }

  useEffect(() => {
    setSelectedClipIds((current) => {
      const next = reconcileSelectedIds(current, clips);
      return next.size === current.size ? current : next;
    });
  }, [clips]);

  function toggleLibrarySection(view: Exclude<AppView, 'settings'>) {
    afterEditorClosed(() => {
      setActiveView(view);
      setExpandedSection((current) => (current === view ? null : view));
      setFormMode(null);
    });
  }

  async function reconcileSavedClip(saved: Clip) {
    try {
      const latest = await readLatest();
      if (!latest) return undefined;
      latestLibrary.current = latest;
      setClips(latest);
      return libraryItemContainingClip(latest, saved.id);
    } catch {
      // The write has already committed. Never turn a refresh failure into a
      // retryable Create/Edit form or invent standalone membership.
      setClips((current) => replaceLibraryClip(current, saved));
      setActionError(
        'Clip saved, but the library could not refresh. Refresh the library to see its current group.',
      );
      return undefined;
    }
  }

  async function saveClip(input: ClipInput) {
    if (!beginOperation()) return;
    setFormError(null);
    setIsSaving(true);
    try {
      const editing = formMode?.type === 'edit';
      const saved = editing
        ? await client.update(formMode.clip.id, input)
        : await client.create(input);
      const containing = await reconcileSavedClip(saved);
      if (!editing) {
        setActiveView('all');
        setExpandedSection('all');
        const createdMonth = calendarMonthFromTimestamp(
          containing?.kind === 'group'
            ? containing.group.createdAt
            : saved.createdAt,
        );
        if (createdMonth) setVisibleMonth(createdMonth);
        if (containing) openClip(libraryItemId(containing), { type: 'create' });
      } else if (containing) {
        updateSelectedId(libraryItemId(containing));
      }
      if (await safety.release(editorLease.current)) editorLease.current = null;
      setFormMode(null);
      setFormError(null);
      notify('Clip saved.');
    } catch (saveError) {
      setStatus(null);
      setFormError(safeErrorMessage(saveError));
    } finally {
      setIsSaving(false);
      finishOperation();
    }
  }

  async function setPinned(clip: Clip, isPinned: boolean) {
    if (
      deferInlineAction(async (latest) => {
        const current = findLibraryClip(latest, clip.id);
        if (current) await setPinned(current, isPinned);
        else unavailableAction();
      })
    )
      return;
    if (!beginOperation()) return;
    setActionError(null);
    try {
      const updated = await client.setPinned(clip.id, isPinned);
      setClips((current) => replaceLibraryClip(current, updated));
      notify(isPinned ? 'Clip pinned.' : 'Clip unpinned.');
    } catch (pinError) {
      setStatus(null);
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
      setClips((current) => removeLibraryClip(current, clip.id));
      if (libraryItemContainingClip(clips, clip.id)?.kind === 'group') {
        try {
          setClips(
            recentLibraryItems((await client.list()).map(asLibraryItem)),
          );
        } catch {
          // Deletion committed; keep its local result and offer a read retry.
          setActionError(
            'Clip deleted, but the library could not refresh. Refresh the library to see its current group.',
          );
        }
      }
      if (currentSelectedId.current === clip.id) {
        updateSelectedId(null);
        setDetailOrigin(null);
        returnToCalendar(null);
      }
      notify('Clip deleted.');
    } catch (deleteError) {
      setStatus(null);
      setActionError(safeErrorMessage(deleteError));
    } finally {
      await releaseConfirmation();
      finishOperation();
    }
  }

  async function setItemPinned(item: LibraryItem, isPinned: boolean) {
    if (
      deferInlineAction(async (latest) => {
        const current = latest.find(
          (candidate) => libraryItemId(candidate) === libraryItemId(item),
        );
        if (current) await setItemPinned(current, isPinned);
        else unavailableAction();
      })
    )
      return;
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
      setStatus(null);
    } finally {
      finishOperation();
    }
  }

  async function unmergeMember(group: ClipGroup, clip: Clip) {
    if (
      deferInlineAction(async (latest) => {
        const current = groupIn(latest, group.id);
        const member = current?.members.find(
          (candidate) => candidate.id === clip.id,
        );
        if (current && member) await unmergeMember(current, member);
        else unavailableAction();
      })
    )
      return;
    if (!beginOperation()) return;
    setActionError(null);
    try {
      await client.unmergeMember(group.id, clip.id);
      await refresh();
      notify('Clip unmerged.');
    } catch (error) {
      setActionError(safeErrorMessage(error));
      setStatus(null);
    } finally {
      finishOperation();
    }
  }

  async function unmergeGroup(group: ClipGroup) {
    if (
      deferInlineAction(async (latest) => {
        const current = groupIn(latest, group.id);
        if (current) await unmergeGroup(current);
        else unavailableAction();
      })
    )
      return;
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
      setStatus(null);
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
      setStatus(null);
    } finally {
      await releaseConfirmation();
      finishOperation();
    }
  }

  async function deleteGroup(group: ClipGroup) {
    if (!beginOperation()) return;
    setDeleteTarget(null);
    setActionError(null);
    try {
      await client.deleteGroup(
        group.id,
        group.members.map((clip) => clip.id),
      );
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
      setStatus(null);
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'group_changed'
      ) {
        // Reconcile for review only. A new dialog and explicit confirmation
        // are required; never retry a destructive operation after refreshing.
        await refresh();
      }
    } finally {
      await releaseConfirmation();
      finishOperation();
    }
  }

  async function copyClip(clip: Clip) {
    if (
      deferInlineAction(async (latest) => {
        const current = findLibraryClip(latest, clip.id);
        if (current) await copyClip(current);
        else unavailableAction();
      })
    )
      return;
    if (!beginOperation('Clip copied.')) return;
    setActionError(null);
    try {
      await client.copyContent(clip.id);
      notify('Clip copied.');
    } catch (copyError) {
      setStatus(null);
      setActionError(safeErrorMessage(copyError));
    } finally {
      finishOperation();
    }
  }

  async function copyGroup(group: ClipGroup) {
    if (
      deferInlineAction(async (latest) => {
        const current = groupIn(latest, group.id);
        if (current) await copyGroup(current);
        else unavailableAction();
      })
    )
      return;
    if (!beginOperation('All clips copied.')) return;
    setActionError(null);
    try {
      // Explicitly carry the displayed order, never previews or unsaved drafts.
      await client.copyContent(
        group.id,
        group.members.map((member) => member.id),
      );
      notify('All clips copied.');
    } catch (copyError) {
      setStatus(null);
      setActionError(safeErrorMessage(copyError));
    } finally {
      finishOperation();
    }
  }

  async function openSource(clip: Clip) {
    if (
      deferInlineAction(async (latest) => {
        const current = findLibraryClip(latest, clip.id);
        if (current?.sourceUrl) await openSource(current);
        else unavailableAction();
      })
    )
      return;
    if (!beginOperation()) return;
    setActionError(null);
    try {
      await client.openSource(clip.id);
    } catch (openError) {
      setStatus(null);
      setActionError(safeErrorMessage(openError));
    } finally {
      finishOperation();
    }
  }

  function focusSearch() {
    if (actionResolving.current) return;
    flushSync(() => {
      if (activeView === 'settings') {
        setActiveView('all');
        setExpandedSection('all');
      }
    });
    searchRef.current?.focus();
    searchRef.current?.select();
  }

  const detailIdentity = selectedClip
    ? `${selectedClip.kind}:${libraryItemId(selectedClip)}`
    : null;
  useEffect(() => {
    persistThemeMode(themeMode);

    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [themeMode]);

  useEffect(() => {
    if (workspaceMode !== 'detail' || !selectedClip || inline.isActive())
      return;
    detailBackRef.current?.focus({ preventScroll: true });
    // A refreshed record is not navigation. Refocusing Back on each new object
    // steals focus from member controls and scrolls the detail to its header.
  }, [selectedId, detailIdentity, workspaceMode]);

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
      inline.isActive() ||
      !selectedId ||
      isLoading ||
      isRefreshing ||
      clips.some((clip) => libraryItemId(clip) === selectedId)
    )
      return;
    const containing = libraryItemContainingClip(clips, selectedId);
    if (containing) {
      updateSelectedId(libraryItemId(containing));
      return;
    }
    updateSelectedId(null);
    setDetailOrigin(null);
    returnToCalendar(null);
  }, [
    clips,
    isLoading,
    isRefreshing,
    selectedId,
    workspaceMode,
    inline.draft,
    inline.isOpening,
  ]);

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
      <div
        className="app-shell"
        onClickCapture={(event) => {
          if (
            inline.isActive() &&
            event.target instanceof Element &&
            !event.target.closest('[data-inline-content-editor]')
          )
            void inline.save();
        }}
      >
        {safety.error && (
          <p role="alert" className="error-message">
            {safety.error}
          </p>
        )}
        <SidebarProvider
          className="workspace min-h-0"
          open={sidebarOpen}
          onOpenChange={setSidebarOpen}
        >
          <AppSidebar
            onOpenExtension={async () => {
              if (!(await inline.save()))
                throw new Error('Resolve the inline edit first.');
              await extensionClient.openListing();
            }}
            updater={updater}
            updateBlocked={updateBlocked}
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
                afterEditorClosed(() => {
                  exitSelectionMode();
                  setActiveView('settings');
                  setFormMode(null);
                });
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
                          pending={
                            validSelectedCount >= 2 && (isBusy || isRefreshing)
                          }
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
                          onClick={() => void openEditor({ type: 'create' })}
                          pending={
                            !isLoading &&
                            (isRefreshing || (isBusy && !inline.draft))
                          }
                          disabled={
                            isLoading ||
                            isRefreshing ||
                            (isBusy && !inline.draft)
                          }
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
                            pending={!isLoading && (isBusy || isRefreshing)}
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
                            onClick={refreshLibrary}
                            pending={
                              !formMode &&
                              !deleteTarget &&
                              (isRefreshing || (isBusy && !inline.draft))
                            }
                            disabled={
                              isRefreshing ||
                              (isBusy && !inline.draft) ||
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
                        onClick={refreshLibrary}
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
                        onClick={refreshLibrary}
                      >
                        Retry
                      </Button>
                    </div>
                  ) : workspaceMode === 'detail' &&
                    selectedClip?.kind === 'clip' ? (
                    <ClipDetail
                      clip={selectedClip.clip}
                      pending={(isBusy && !inline.draft) || isRefreshing}
                      disabled={(isBusy && !inline.draft) || isRefreshing}
                      inline={{
                        draft:
                          inline.editingKind === 'content'
                            ? inline.draft
                            : null,
                        isOpening: inline.isOpening,
                        onBegin: () => void beginInline(selectedClip.clip),
                        onChange: inline.change,
                        onSave: () => void inline.save(),
                        onCancel: () => void inline.cancel(),
                      }}
                      inlineTitle={{
                        draft:
                          inline.editingKind === 'clip-title'
                            ? inline.draft
                            : null,
                        isOpening: inline.isOpening,
                        onBegin: () =>
                          void beginInline(selectedClip.clip, undefined, true),
                        onChange: inline.change,
                        onSave: () => void inline.save(),
                        onCancel: () => void inline.cancel(),
                      }}
                      backButtonRef={detailBackRef}
                      onBack={() => returnToCalendar()}
                      onCopy={() => void copyClip(selectedClip.clip)}
                      onDelete={() =>
                        void requestDelete({
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
                      pending={(isBusy && !inline.draft) || isRefreshing}
                      disabled={(isBusy && !inline.draft) || isRefreshing}
                      groupAvailable={clips.some(
                        (item) =>
                          item.kind === 'group' &&
                          item.group.id === selectedClip.group.id,
                      )}
                      inline={{
                        clip:
                          inline.editingKind === 'content'
                            ? inline.editingClip
                            : null,
                        draft:
                          inline.editingKind === 'content'
                            ? inline.draft
                            : null,
                        isOpening: inline.isOpening,
                        onBegin: () => undefined,
                        onBeginMember: (clip) =>
                          void beginInline(clip, selectedClip.group),
                        onChange: inline.change,
                        onSave: () => void inline.save(),
                        onCancel: () => void inline.cancel(),
                      }}
                      inlineTitle={{
                        draft:
                          inline.editingKind === 'group-title'
                            ? inline.draft
                            : null,
                        isOpening: inline.isOpening,
                        onBegin: () => void beginGroupTitle(selectedClip.group),
                        onChange: inline.change,
                        onSave: () => void inline.save(),
                        onCancel: () => void inline.cancel(),
                      }}
                      onRequestMemberMenu={(clip, open) =>
                        requestMemberMenu(selectedClip.group, clip, open)
                      }
                      backButtonRef={detailBackRef}
                      onBack={() => returnToCalendar()}
                      onSetPinned={(isPinned) =>
                        void setItemPinned(selectedClip, isPinned)
                      }
                      onUnmergeMember={(clip) =>
                        void unmergeMember(selectedClip.group, clip)
                      }
                      onDeleteMember={(clip) =>
                        void requestDelete({
                          type: 'member',
                          groupId: selectedClip.group.id,
                          clip,
                        })
                      }
                      onUnmergeGroup={() =>
                        void unmergeGroup(selectedClip.group)
                      }
                      onDeleteGroup={() =>
                        void requestDelete({
                          type: 'group',
                          group: selectedClip.group,
                        })
                      }
                      onOpenSource={(clip) => void openSource(clip)}
                      onEditMember={editClip}
                      onCopyMember={(clip) => void copyClip(clip)}
                      onCopyAll={() => void copyGroup(selectedClip.group)}
                    />
                  ) : (
                    <MemoryCalendar
                      actionsDisabled={isBusy || isRefreshing}
                      actionsPending={isBusy || isRefreshing}
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
                        void requestDelete(
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
                <SettingsView startupClient={startupClient} updater={updater} />
              )}
            </div>
          </SidebarInset>
        </SidebarProvider>
        {status && (
          <ClipFeedback
            notificationId={status.id}
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
                void cancelEditor();
              }
            }}
            onSubmit={saveClip}
          />
        )}

        <AlertDialog
          open={deleteTarget !== null}
          onOpenChange={(open) => {
            if (!open && !operationPending.current) {
              void releaseConfirmation().then((released) => {
                if (released) setDeleteTarget(null);
              });
            }
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
                onClick={(event) => {
                  event.preventDefault();
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
