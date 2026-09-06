import { describe, expect, test, vi } from 'vitest';

import { notifyCaptureResult } from './contextMenuFeedback';

describe('context-menu capture feedback', () => {
  test('uses one fixed notification with content-free success text', async () => {
    const create = vi.fn().mockResolvedValue('capture-result');
    await notifyCaptureResult(
      { version: 1, ok: true, clipId: 'private-id' },
      create,
    );
    expect(create).toHaveBeenCalledWith(
      'ai-clip-memory-capture-result',
      expect.objectContaining({ message: 'Clip saved locally.' }),
    );
    expect(JSON.stringify(create.mock.calls)).not.toContain('private-id');
  });

  test('maps failures to generic actionable messages', async () => {
    const create = vi.fn().mockResolvedValue('capture-result');
    await notifyCaptureResult(
      { version: 1, ok: false, error: 'storage_unavailable' },
      create,
    );
    expect(create.mock.calls[0]![1].message).toContain('installed');
    await notifyCaptureResult(
      { version: 1, ok: false, error: 'message_too_large' },
      create,
    );
    expect(create.mock.calls[1]![1].message).toContain('too large');
  });
});
