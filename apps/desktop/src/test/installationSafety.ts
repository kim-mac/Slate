import { vi } from 'vitest';
import type {
  InstallationSafetyClient,
  SafetySnapshot,
} from '../installationSafetyClient';

// IPC boundary double only. Rust tests exercise the authoritative coordinator.
export function installationSafetyFixture() {
  let receive: ((value: SafetySnapshot) => void) | undefined;
  let id = 0;
  const client: InstallationSafetyClient = {
    listen: vi.fn(async (handler) => {
      receive = handler;
      return vi.fn();
    }),
    connect: vi.fn(async () => ({ generation: 1 })),
    status: vi.fn(async () => ({ generation: 0, preparing: false })),
    acquire: vi.fn(async (generation) => ({ generation, leaseId: ++id })),
    release: vi.fn(async () => undefined),
    acknowledge: vi.fn(async () => undefined),
  };
  return { client, emit: (value: SafetySnapshot) => receive?.(value) };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
import type { Clip } from '@ai-clip-memory/shared';

export const safetyClip: Clip = {
  id: 'safety-synthetic',
  title: 'Synthetic safety note',
  content: 'Synthetic content only',
  contentType: 'text',
  sourceApp: null,
  sourceUrl: null,
  sourcePageTitle: null,
  isPinned: false,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
};
