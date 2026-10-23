import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type UpdatePhase =
  | 'unconfigured'
  | 'idle'
  | 'checking'
  | 'up_to_date'
  | 'available'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'preparing'
  | 'error';

export interface UpdateSnapshot {
  /** Only the DEV-only visual fixture supplies this flag. Never native production state. */
  developmentFixture?: boolean;
  revision: number;
  phase: UpdatePhase;
  currentVersion: string;
  availableVersion: string | null;
  downloadedBytes: number;
  totalBytes: number | null;
  dismissed: boolean;
  error: { code: string; message: string } | null;
  installationEnabled: boolean;
}

export interface UpdaterClient {
  listen(receive: (state: UpdateSnapshot) => void): Promise<() => void>;
  getStatus(): Promise<UpdateSnapshot>;
  check(): Promise<UpdateSnapshot>;
  download(): Promise<UpdateSnapshot>;
  cancel(): Promise<UpdateSnapshot>;
  dismiss(): Promise<UpdateSnapshot>;
  // Optional for the isolated visual preview, which has no installation API.
  restart?(): Promise<UpdateSnapshot>;
}

export interface UpdateControls {
  state: UpdateSnapshot | null;
  pending: boolean;
  connectionError: boolean;
  actionError: string | null;
  check(): Promise<void>;
  download(): Promise<void>;
  cancel(): Promise<void>;
  dismiss(): Promise<void>;
  restart?(): Promise<void>;
}

export function updateIsBusy(phase: UpdatePhase | undefined): boolean {
  return (
    phase === 'checking' ||
    phase === 'downloading' ||
    phase === 'verifying' ||
    phase === 'preparing'
  );
}

export const tauriUpdaterClient: UpdaterClient = {
  listen: (receive) =>
    listen<UpdateSnapshot>('slate:update-state', (event) =>
      receive(event.payload),
    ),
  getStatus: () => invoke<UpdateSnapshot>('get_update_status'),
  check: () => invoke<UpdateSnapshot>('check_for_updates'),
  download: () => invoke<UpdateSnapshot>('download_update'),
  cancel: () => invoke<UpdateSnapshot>('cancel_update'),
  dismiss: () => invoke<UpdateSnapshot>('dismiss_update'),
  restart: () => invoke<UpdateSnapshot>('restart_to_update'),
};
