import { useState } from 'react';
import { App } from '../App';
import { EXTENSION_DISMISSAL_KEY } from '../extensionDiscoveryPreference';
import { fixtureClient } from './fixtureClient';
import './ux-dev.css';

export function UxDevApp() {
  const [client] = useState(fixtureClient);
  const [resetStatus, setResetStatus] = useState('');
  return (
    <div className="ux-development-shell">
      <aside
        className="ux-development-banner"
        aria-label="UX development isolation"
      >
        <strong>Slate UX Development — isolated test data</strong>
        <span>
          Production updater, autostart and browser capture disabled. Quick
          Search: Ctrl+Alt+Shift+Space.
        </span>
        <button
          type="button"
          onClick={() => {
            try {
              window.localStorage.removeItem(EXTENSION_DISMISSAL_KEY);
              setResetStatus(
                'Suggestion reset. Save or cancel edits, then quit and reopen only Slate UX Development.',
              );
            } catch {
              window.alert(
                'Could not reset the development suggestion preference.',
              );
            }
          }}
        >
          Reset extension suggestion for next restart
        </button>
        {resetStatus && <span role="status">{resetStatus}</span>}
      </aside>
      <App updaterClient={client} />
    </div>
  );
}
