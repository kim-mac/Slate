import { invoke } from '@tauri-apps/api/core';

export interface ExtensionClient {
  openListing(): Promise<void>;
}

// The native main-only command owns the destination. Never pass a URL from JS.
export const tauriExtensionClient: ExtensionClient = {
  openListing: () => invoke<void>('open_extension_listing'),
};
