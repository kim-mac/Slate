import { APP_NAME } from '@ai-clip-memory/shared';
import { useState } from 'react';

type View = 'all' | 'pinned' | 'settings';

interface EmptyLibraryProps {
  description: string;
  heading: string;
  title: string;
}

function EmptyLibrary({ description, heading, title }: EmptyLibraryProps) {
  return (
    <section className="library-view" aria-labelledby="library-heading">
      <header className="section-header">
        <h1 id="library-heading">{heading}</h1>
        <p>{description}</p>
      </header>

      <div className="empty-state">
        <div className="empty-state-mark" aria-hidden="true">
          {heading === 'Pinned' ? '◇' : '□'}
        </div>
        <h2>{title}</h2>
        <p>
          {heading === 'Pinned'
            ? 'Clips you pin will appear here.'
            : 'Save something from your browser to see it here.'}
        </p>
      </div>
    </section>
  );
}

export function App() {
  const [activeView, setActiveView] = useState<View>('all');
  const [searchText, setSearchText] = useState('');

  return (
    <div className="app-shell">
      <header className="titlebar">
        <span>{APP_NAME}</span>
      </header>

      <div className="searchbar">
        <label htmlFor="clip-search">Search clips</label>
        <input
          id="clip-search"
          type="search"
          placeholder="Search clips..."
          value={searchText}
          onChange={(event) => setSearchText(event.currentTarget.value)}
        />
      </div>

      <div className="workspace">
        <aside className="sidebar">
          <nav aria-label="Clip library">
            <button
              type="button"
              aria-pressed={activeView === 'all'}
              onClick={() => setActiveView('all')}
            >
              <span>All Clips</span>
              <span className="item-count" aria-hidden="true">
                0
              </span>
            </button>
            <button
              type="button"
              aria-pressed={activeView === 'pinned'}
              onClick={() => setActiveView('pinned')}
            >
              <span>Pinned</span>
              <span className="item-count" aria-hidden="true">
                0
              </span>
            </button>
          </nav>

          <button
            className="settings-link"
            type="button"
            aria-pressed={activeView === 'settings'}
            onClick={() => setActiveView('settings')}
          >
            Settings &amp; About
          </button>
        </aside>

        <main className="content">
          {activeView === 'all' && (
            <EmptyLibrary
              heading="All Clips"
              description="Your saved clips will appear here."
              title="No clips yet"
            />
          )}

          {activeView === 'pinned' && (
            <EmptyLibrary
              heading="Pinned"
              description="Keep frequently used clips within easy reach."
              title="No pinned clips"
            />
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

              <section
                className="privacy-note"
                aria-labelledby="privacy-heading"
              >
                <div className="privacy-mark" aria-hidden="true">
                  ✓
                </div>
                <div>
                  <h2 id="privacy-heading">Private by default</h2>
                  <p>
                    Your clips are stored locally on this computer. No account
                    or cloud connection is required.
                  </p>
                </div>
              </section>

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
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
