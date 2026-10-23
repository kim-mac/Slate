import type { UpdaterClient, UpdateSnapshot } from '../updaterClient';
export function fixtureClient(): UpdaterClient {
  let state: UpdateSnapshot = {
    revision: 0,
    phase: 'available',
    currentVersion: '0.3.1',
    availableVersion: 'visual-only',
    downloadedBytes: 0,
    totalBytes: null,
    dismissed: false,
    error: null,
    installationEnabled: false,
    developmentFixture: true,
  };
  const denied = async (): Promise<UpdateSnapshot> => {
    throw new Error(
      'Actual updater actions are disabled in UX development mode.',
    );
  };
  return {
    listen: async () => () => {},
    getStatus: async () => state,
    check: denied,
    download: denied,
    cancel: denied,
    restart: denied,
    dismiss: async () => {
      state = { ...state, revision: state.revision + 1, dismissed: true };
      return state;
    },
  };
}
