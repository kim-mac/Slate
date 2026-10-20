// Development-only entry, never imported by main.tsx or launcher.tsx.
import { invoke } from '@tauri-apps/api/core';
import { useState } from 'react';
import { App } from '../App';
import type { ClipClient } from '../clipClient';
import type { UpdateSnapshot, UpdaterClient } from '../updaterClient';

export type PreviewScenario = 'available' | 'progress' | 'failure' | 'ready';

export function createPreviewUpdater() {
  let state: UpdateSnapshot = {
    revision: 1,
    phase: 'available',
    currentVersion: '0.1.0',
    availableVersion: '0.2.0',
    downloadedBytes: 0,
    totalBytes: null,
    dismissed: false,
    error: null,
    installationEnabled: false,
  };
  const listeners = new Set<(value: UpdateSnapshot) => void>();
  function emit(patch: Partial<UpdateSnapshot>) {
    state = { ...state, ...patch, revision: state.revision + 1 };
    listeners.forEach((receive) => receive(state));
    return state;
  }
  function show(scenario: PreviewScenario) {
    return emit({
      phase:
        scenario === 'progress'
          ? 'downloading'
          : scenario === 'failure'
            ? 'error'
            : scenario,
      dismissed: false,
      downloadedBytes: scenario === 'progress' ? 6_000_000 : 0,
      totalBytes: scenario === 'progress' ? 10_000_000 : null,
      error:
        scenario === 'failure'
          ? {
              code: 'download_failed',
              message: 'Download interrupted. Check your connection and retry.',
            }
          : null,
    });
  }
  const client: UpdaterClient = {
    listen: async (receive) => {
      listeners.add(receive);
      return () => {
        listeners.delete(receive);
      };
    },
    getStatus: async () => state,
    check: async () => show('available'),
    download: async () => show('progress'),
    cancel: async () => show('available'),
    dismiss: async () => emit({ dismissed: true }),
  };
  return { client, show };
}

function disabled(): Promise<never> {
  return Promise.reject(new Error('Disabled in the isolated visual preview.'));
}

// No production client fallback; no arbitrary IPC, clipboard, source opener, or writes.
const previewClips: ClipClient = {
  list: () => invoke('list_clips'),
  create: disabled,
  update: disabled,
  delete: disabled,
  setPinned: disabled,
  copyContent: disabled,
  openSource: disabled,
  merge: disabled,
  unmergeMember: disabled,
  unmergeGroup: disabled,
  deleteGroupMember: disabled,
  deleteGroup: disabled,
  setGroupPinned: disabled,
};
const previewStartup = { getEnabled: async () => false, setEnabled: disabled };

export function UpdaterVisualPreview({
  fixture,
  clips = previewClips,
}: {
  fixture: ReturnType<typeof createPreviewUpdater>;
  clips?: ClipClient;
}) {
  const [scenario, setScenario] = useState<PreviewScenario>('available');
  return (
    <>
      <App
        client={clips}
        startupClient={previewStartup}
        updaterClient={fixture.client}
      />
      <aside
        aria-label="Synthetic preview controls"
        style={{
          position: 'fixed',
          bottom: 12,
          right: 12,
          zIndex: 100,
          padding: 8,
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: 'var(--background)',
          fontSize: 12,
        }}
      >
        <label>
          Preview only · No network or installation{' '}
          <select
            aria-label="Mock update state"
            value={scenario}
            onChange={(event) => {
              const value = event.target.value as PreviewScenario;
              setScenario(value);
              fixture.show(value);
            }}
          >
            <option value="available">Update available</option>
            <option value="progress">Download progress (60%)</option>
            <option value="failure">Download failure</option>
            <option value="ready">Verified (installation disabled)</option>
          </select>
        </label>
      </aside>
    </>
  );
}
