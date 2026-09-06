import { describe, expect, test, vi } from 'vitest';
import { sendFloatingCaptureMessage } from './contentMessaging';

describe('content-script runtime messaging', () => {
  test('distinguishes invalidated extension context from bridge failures', async () => {
    await expect(
      sendFloatingCaptureMessage(
        {},
        vi.fn().mockRejectedValue(new Error('context invalidated')),
      ),
    ).resolves.toEqual({
      version: 1,
      ok: false,
      error: 'extension_context_invalidated',
    });
    await expect(
      sendFloatingCaptureMessage(
        {},
        vi.fn().mockResolvedValue({
          version: 1,
          ok: false,
          error: 'storage_unavailable',
        }),
      ),
    ).resolves.toEqual({
      version: 1,
      ok: false,
      error: 'storage_unavailable',
    });
  });
});
