import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type SafetyLeaseKind = 'editor' | 'confirmation' | 'inline';
export interface SafetyLease {
  generation: number;
  leaseId: number;
}
export interface SafetySnapshot {
  generation: number;
  preparing: boolean;
}
export interface InstallationSafetyClient {
  onCloseRequested?(receive: () => void): Promise<() => void>;
  hideMainAfterSave?(): Promise<void>;
  onQuitBlocked?(receive: () => void): Promise<() => void>;
  listen(receive: (snapshot: SafetySnapshot) => void): Promise<() => void>;
  connect(): Promise<{ generation: number }>;
  status(): Promise<SafetySnapshot>;
  acquire(generation: number, kind: SafetyLeaseKind): Promise<SafetyLease>;
  release(lease: SafetyLease): Promise<void>;
  acknowledge(
    windowGeneration: number,
    preparationGeneration: number,
  ): Promise<void>;
}

// Safety accounting only. Deliberately no prepare/install or SDK command binding.
export const tauriInstallationSafetyClient: InstallationSafetyClient = {
  onCloseRequested: (receive) =>
    listen('slate:inline-close-requested', receive),
  hideMainAfterSave: () => invoke('hide_main_after_inline_save'),
  onQuitBlocked: (receive) => listen('slate:quit-blocked', receive),
  listen: (receive) =>
    listen<SafetySnapshot>('slate:installation-safety', (event) =>
      receive(event.payload),
    ),
  connect: () => invoke('connect_installation_safety'),
  status: () => invoke('get_installation_safety_status'),
  acquire: (generation, kind) =>
    invoke('acquire_installation_lease', { generation, kind }),
  release: (lease) => invoke('release_installation_lease', { ...lease }),
  acknowledge: (windowGeneration, preparationGeneration) =>
    invoke('acknowledge_installation_safety', {
      windowGeneration,
      preparationGeneration,
    }),
};
