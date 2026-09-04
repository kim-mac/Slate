import type { Clip } from '@ai-clip-memory/shared';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { tauriClipClient, type ClipClient } from '../clipClient';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  clipPreview,
  displayTitle,
  matchesSearch,
  recentClips,
} from '../lib/clipRetrieval';
import {
  connectLauncher,
  tauriLauncherHost,
  type LauncherHost,
  type LauncherState,
} from './launcherClient';

type RetrievalClient = Pick<ClipClient, 'list' | 'copyContent'>;
interface Props {
  client?: RetrievalClient;
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
  const focusSearch = useRef<(() => void) | null>(null);
  useEffect(
    () =>
      connectLauncher(
        host,
        (next) => {
          setState((current) =>
            next.session < current.session ? current : next,
          );
          if (next.visible) focusSearch.current?.();
        },
        () => setConnectionError(true),
      ),
    [host, connectionAttempt],
  );

  if (connectionError)
    return (
      <main className="launcher-shell">
        <div role="alert">Quick search could not connect. Try again.</div>
        <Button
          onClick={() => {
            setConnectionError(false);
            setConnectionAttempt((n) => n + 1);
          }}
        >
          Retry connection
        </Button>
      </main>
    );
  if (!state.visible) return null;
  return (
    <LauncherSession
      key={state.session}
      session={state.session}
      client={client}
      host={host}
      focusSearch={focusSearch}
    />
  );
}

function LauncherSession({
  session,
  client,
  host,
  focusSearch,
}: {
  session: number;
  client: RetrievalClient;
  host: LauncherHost;
  focusSearch: React.RefObject<(() => void) | null>;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);
  const active = useRef(true);
  const loadingGeneration = useRef(0);
  const copying = useRef(false);
  const composing = useRef(false);
  const [clips, setClips] = useState<Clip[]>([]);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'load' | 'copy' | 'hide' | null>(null);
  const results = recentClips(clips).filter((clip) =>
    matchesSearch(clip, query),
  );
  const selected = results.find((clip) => clip.id === selectedId) ?? results[0];

  async function load() {
    const generation = ++loadingGeneration.current;
    setLoading(true);
    setError(null);
    try {
      const next = await client.list();
      if (active.current && generation === loadingGeneration.current)
        setClips(next);
    } catch {
      if (active.current && generation === loadingGeneration.current)
        setError('load');
    } finally {
      if (active.current && generation === loadingGeneration.current)
        setLoading(false);
    }
  }
  useEffect(() => {
    active.current = true;
    let focusFrame = 0;
    const focus = () => {
      searchRef.current?.focus();
      cancelAnimationFrame(focusFrame);
      focusFrame = requestAnimationFrame(() => {
        if (active.current) searchRef.current?.focus();
      });
    };
    focusSearch.current = focus;
    window.addEventListener('focus', focus);
    focus();
    void load();
    return () => {
      active.current = false;
      window.removeEventListener('focus', focus);
      cancelAnimationFrame(focusFrame);
      loadingGeneration.current++;
      focusSearch.current = null;
    };
    // A session is remounted on every opening; clients are stable for its lifetime.
  }, []);
  useEffect(() => {
    selectedRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected?.id]);

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
    setError(null);
    try {
      await client.copyContent(id);
      if (active.current) await hide();
    } catch {
      if (active.current) setError('copy');
    } finally {
      copying.current = false;
      if (active.current) setBusy(false);
    }
  }
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (
      event.nativeEvent.isComposing ||
      composing.current ||
      event.keyCode === 229 ||
      event.shiftKey ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    if (event.key === 'Escape') {
      event.preventDefault();
      void hide();
      return;
    }
    // Buttons retain their native keyboard activation; only search owns navigation/copy.
    if (event.target !== searchRef.current) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const index = results.findIndex((clip) => clip.id === selected?.id);
      const next = Math.max(
        0,
        Math.min(
          results.length - 1,
          index + (event.key === 'ArrowDown' ? 1 : -1),
        ),
      );
      setSelectedId(results[next]?.id ?? null);
    } else if (event.key === 'Enter' && !event.repeat && selected && !loading) {
      event.preventDefault();
      void copy(selected.id);
    }
  }
  return (
    <main className="launcher-shell" onKeyDown={onKeyDown}>
      <Input
        ref={searchRef}
        type="search"
        aria-label="Search clips"
        role="searchbox"
        aria-controls="launcher-results"
        aria-activedescendant={selected ? `result-${selected.id}` : undefined}
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
      />
      {error && (
        <div className="launcher-error" role="alert">
          <span>
            {error === 'load'
              ? 'Clips could not be loaded.'
              : error === 'copy'
                ? 'Clip could not be copied.'
                : 'Quick search could not close.'}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || (error === 'copy' && !selected)}
            onClick={() => {
              if (error === 'load') void load();
              else if (error === 'copy') {
                if (selected) void copy(selected.id);
              } else void hide();
            }}
          >
            {error === 'load'
              ? 'Retry loading'
              : error === 'copy'
                ? 'Retry copy'
                : 'Retry closing'}
          </Button>
        </div>
      )}
      <div
        className="launcher-results"
        id="launcher-results"
        role="listbox"
        aria-label="Clips"
        aria-busy={loading || busy}
      >
        {loading ? (
          <p className="launcher-empty" role="status">
            Loading clips…
          </p>
        ) : results.length === 0 ? (
          <p className="launcher-empty">
            {clips.length
              ? 'No matching clips'
              : error === 'load'
                ? 'Use Retry loading to try again.'
                : 'No clips yet'}
          </p>
        ) : (
          results.map((clip) => (
            <div
              key={clip.id}
              id={`result-${clip.id}`}
              ref={clip.id === selected?.id ? selectedRef : undefined}
              role="option"
              aria-selected={clip.id === selected?.id}
              className="launcher-result"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setSelectedId(clip.id);
                searchRef.current?.focus();
              }}
            >
              <div className="launcher-title">{displayTitle(clip)}</div>
              <div className="launcher-preview">
                {clipPreview(clip.content)}
              </div>
              <div className="launcher-meta">
                {clip.sourceApp || 'Local clip'} · {clip.contentType}
              </div>
            </div>
          ))
        )}
      </div>
      <footer className="launcher-footer">
        <span>
          {busy
            ? 'Copying…'
            : `${results.length} ${results.length === 1 ? 'clip' : 'clips'} · Local only`}
        </span>
        <span>↑↓ Select · Enter Copy · Esc Close</span>
      </footer>
    </main>
  );
}
