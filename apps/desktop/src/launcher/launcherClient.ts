import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface LauncherState {
  session: number;
  visible: boolean;
}
export interface LauncherStatus {
  available: boolean;
  shortcut: string;
  errorCode: string | null;
}
export interface LauncherHost {
  listen(handler: (state: LauncherState) => void): Promise<() => void>;
  ready(): Promise<LauncherState>;
  hide(session: number): Promise<void>;
}
export const tauriLauncherHost: LauncherHost = {
  listen: (handler) =>
    listen<LauncherState>('launcher-state', (event) => handler(event.payload)),
  ready: () => invoke<LauncherState>('launcher_ready'),
  hide: (session) => invoke<void>('hide_launcher', { session }),
};
export const getLauncherStatus = () =>
  invoke<LauncherStatus>('get_launcher_status');

// Subscribe before the handshake; an event always wins over an older ready reply.
export function connectLauncher(
  host: LauncherHost,
  receive: (state: LauncherState) => void,
  failed: () => void,
): () => void {
  let disposed = false;
  let stop: (() => void) | undefined;
  let eventReceived = false;
  void host
    .listen((state) => {
      eventReceived = true;
      if (!disposed) receive(state);
    })
    .then(async (unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      stop = unlisten;
      const snapshot = await host.ready();
      if (!disposed && !eventReceived) receive(snapshot);
    })
    .catch(() => {
      if (!disposed) failed();
    });
  return () => {
    disposed = true;
    stop?.();
  };
}
