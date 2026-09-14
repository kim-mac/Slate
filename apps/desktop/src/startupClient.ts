import { invoke } from '@tauri-apps/api/core';

export interface StartupClient {
  getEnabled(): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<boolean>;
}

export const tauriStartupClient: StartupClient = {
  getEnabled: () => invoke<boolean>('get_autostart_enabled'),
  setEnabled: (enabled) =>
    invoke<boolean>('set_autostart_enabled', { enabled }),
};
