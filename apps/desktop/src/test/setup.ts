import { vi } from 'vitest';

// Desktop component tests do not run Tauri. Mock only the safety IPC boundary;
// focused safety tests inject their own controllable client and Rust tests own policy.
vi.mock('../installationSafetyClient', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../installationSafetyClient')>();
  let leaseId = 0;
  return {
    ...actual,
    tauriInstallationSafetyClient: {
      listen: async () => () => undefined,
      connect: async () => ({ generation: 1 }),
      status: async () => ({ generation: 0, preparing: false }),
      acquire: async (generation: number) => ({
        generation,
        leaseId: ++leaseId,
      }),
      release: async () => undefined,
      acknowledge: async () => undefined,
    },
  };
});

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string): MediaQueryList => ({
    addEventListener: () => undefined,
    addListener: () => undefined,
    dispatchEvent: () => false,
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: () => undefined,
    removeListener: () => undefined,
  }),
  writable: true,
});
