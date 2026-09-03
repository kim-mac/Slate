import { APP_NAME, type Clip, type ClipInput } from '@ai-clip-memory/shared';
import { ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';

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
import { SidebarInset, SidebarProvider } from './components/ui/sidebar';
import { TooltipProvider } from './components/ui/tooltip';

type FormMode = { type: 'create' } | { type: 'edit'; clip: Clip };

interface AppProps {
  client?: ClipClient;
}

function matchesSearch(clip: Clip, searchText: string): boolean {
  const query = searchText.trim().toLocaleLowerCase();
  if (!query) return true;
  return [
    clip.content,
    clip.title,
    clip.sourceApp,
    clip.sourceUrl,
    clip.sourcePageTitle,
    clip.contentType,
  ]
    .filter((value): value is string => value !== null)
    .some((value) => value.toLocaleLowerCase().includes(query));
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
  const [activeView, setActiveView] = useState<AppView>('all');
  const [clips, setClips] = useState<Clip[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<Clip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;
    void client
      .list()
      .then((loadedClips) => {
        if (!isCurrent) return;
        setClips(loadedClips);
        setSelectedId(loadedClips[0]?.id ?? null);
      })
      .catch((loadError: unknown) => {
        if (isCurrent) setError(safeErrorMessage(loadError));
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });
    return () => {
      isCurrent = false;
    };
  }, [client]);

  const visibleClips = useMemo(
    () =>
      clips.filter(
        (clip) =>
          (activeView !== 'pinned' || clip.isPinned) &&
          matchesSearch(clip, searchText),
      ),
    [activeView, clips, searchText],
  );
  const selectedClip =
    visibleClips.find((clip) => clip.id === selectedId) ??
    visibleClips[0] ??
    null;
  const pinnedCount = clips.filter((clip) => clip.isPinned).length;

  function showLibrary(view: Exclude<AppView, 'settings'>) {
    setActiveView(view);
    setFormMode(null);
    setError(null);
  }

  async function saveClip(input: ClipInput) {
    setError(null);
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
    } catch (saveError) {
      setError(safeErrorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  }

  async function setPinned(clip: Clip, isPinned: boolean) {
    setError(null);
    try {
      const updated = await client.setPinned(clip.id, isPinned);
      setClips((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (pinError) {
      setError(safeErrorMessage(pinError));
    }
  }

  async function deleteClip(clip: Clip) {
    setDeleteTarget(null);
    setError(null);
    try {
      await client.delete(clip.id);
      setClips((current) => current.filter((item) => item.id !== clip.id));
      setSelectedId(null);
    } catch (deleteError) {
      setError(safeErrorMessage(deleteError));
    }
  }

  async function copyClip(clip: Clip) {
    setError(null);
    try {
      await client.copyContent(clip.id);
      setStatus('Clip copied.');
    } catch (copyError) {
      setError(safeErrorMessage(copyError));
    }
  }

  async function openSource(clip: Clip) {
    setError(null);
    try {
      await client.openSource(clip.id);
    } catch (openError) {
      setError(safeErrorMessage(openError));
    }
  }

  return (
    <TooltipProvider>
      <div className="app-shell">
        <SidebarProvider
          className="workspace min-h-0"
          style={{ '--sidebar-width': '15rem' } as CSSProperties}
        >
          <AppSidebar
            activeView={activeView}
            allCount={clips.length}
            searchText={searchText}
            pinnedCount={pinnedCount}
            onNewClip={() => {
              setActiveView('all');
              setFormMode({ type: 'create' });
              setError(null);
            }}
            onSearchTextChange={setSearchText}
            onSelectView={(view) => {
              if (view === 'settings') {
                setActiveView('settings');
                setFormMode(null);
                setError(null);
              } else {
                showLibrary(view);
              }
            }}
          />

          <SidebarInset className="content">
            {error && !formMode && (
              <p role="alert" className="error-message">
                {error}
              </p>
            )}
            {status && (
              <p role="status" className="status-message">
                {status}
              </p>
            )}

            {activeView !== 'settings' && (
              <section
                className="library-view"
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
                </header>

                {isLoading ? (
                  <div className="empty-state">
                    <p>Loading clips…</p>
                  </div>
                ) : visibleClips.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-state-mark" aria-hidden="true">
                      {activeView === 'pinned' ? '◇' : '□'}
                    </div>
                    <h2>
                      {searchText.trim()
                        ? 'No matching clips'
                        : activeView === 'pinned'
                          ? 'No pinned clips'
                          : 'No clips yet'}
                    </h2>
                    <p>
                      {searchText.trim()
                        ? 'Try a different search.'
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
                        onCopy={() => void copyClip(selectedClip)}
                        onDelete={() => setDeleteTarget(selectedClip)}
                        onEdit={() =>
                          setFormMode({ type: 'edit', clip: selectedClip })
                        }
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
                  <h1 id="settings-heading">Settings &amp; About</h1>
                  <p>Basic information about this local-first application.</p>
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
                      Your clips are stored locally on this computer. No account
                      or cloud connection is required.
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
                    </dl>
                  </CardContent>
                </Card>
              </section>
            )}
          </SidebarInset>
        </SidebarProvider>

        {formMode && activeView !== 'settings' && (
          <ClipFormDialog
            key={formMode.type === 'edit' ? formMode.clip.id : 'create'}
            {...(formMode.type === 'edit' ? { clip: formMode.clip } : {})}
            error={error}
            isSaving={isSaving}
            open
            onOpenChange={(open) => {
              if (!open) setFormMode(null);
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
                This removes the clip from local storage and cannot be undone.
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
