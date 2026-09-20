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
      expect.objectContaining({
        title: 'Slate',
        message: 'Clip saved locally.',
      }),
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

  test('uses a generic content-free failure for page capture', async () => {
    const create = vi.fn().mockResolvedValue('capture-result');
    await notifyCaptureResult(
      { version: 1, ok: false, error: 'invalid_source_url' },
      create,
      'icons/notification.png',
      undefined,
      'page',
    );
    expect(create.mock.calls[0]![1].message).toBe('Could not save this page.');
  });

  test('clears the owned notification before recreating it', async () => {
    const order: string[] = [];
    const clear = vi.fn(async (id: string) => {
      order.push(`clear:${id}`);
      return true;
    });
    const create = vi.fn(async (id: string) => {
      order.push(`create:${id}`);
      return id;
    });
    await notifyCaptureResult(
      { version: 1, ok: true, clipId: 'private-id' },
      create,
      'icons/notification.png',
      clear,
    );
    expect(order).toEqual([
      'clear:ai-clip-memory-capture-result',
      'create:ai-clip-memory-capture-result',
    ]);
  });

  test.each(['false result', 'rejection'])(
    'still creates feedback after a clear %s',
    async (mode) => {
      const create = vi.fn().mockResolvedValue('capture-result');
      const clear =
        mode === 'rejection'
          ? vi.fn().mockRejectedValue(new Error('unavailable'))
          : vi.fn().mockResolvedValue(false);
      await notifyCaptureResult(
        { version: 1, ok: false, error: 'storage_unavailable' },
        create,
        'icons/notification.png',
        clear,
      );
      expect(create).toHaveBeenCalledTimes(1);
    },
  );
});
