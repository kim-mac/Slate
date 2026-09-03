import type { Clip, ClipInput } from '@ai-clip-memory/shared';
import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { tauriClipClient } from './clipClient';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const input: ClipInput = {
  content: 'Useful content',
  contentType: 'text',
  title: null,
  sourceApp: null,
  sourceUrl: null,
  sourcePageTitle: null,
};

const clip: Clip = {
  ...input,
  id: '8d96bdf2-e58f-4384-b2f7-242819011e74',
  isPinned: false,
  createdAt: '2026-09-02T15:00:00.000Z',
  updatedAt: '2026-09-02T15:00:00.000Z',
};

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe('tauriClipClient', () => {
  test('maps clip operations to the narrow Tauri commands', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce([clip])
      .mockResolvedValueOnce(clip)
      .mockResolvedValueOnce(clip)
      .mockResolvedValueOnce(clip)
      .mockResolvedValue(undefined);

    await expect(tauriClipClient.list()).resolves.toEqual([clip]);
    await expect(tauriClipClient.create(input)).resolves.toEqual(clip);
    await expect(tauriClipClient.update(clip.id, input)).resolves.toEqual(clip);
    await expect(tauriClipClient.setPinned(clip.id, true)).resolves.toEqual(
      clip,
    );
    await tauriClipClient.delete(clip.id);
    await tauriClipClient.copyContent(clip.id);
    await tauriClipClient.openSource(clip.id);

    expect(vi.mocked(invoke).mock.calls).toEqual([
      ['list_clips'],
      ['create_clip', { input }],
      ['update_clip', { id: clip.id, input }],
      ['set_clip_pinned', { id: clip.id, isPinned: true }],
      ['delete_clip', { id: clip.id }],
      ['copy_clip_content', { id: clip.id }],
      ['open_clip_source', { id: clip.id }],
    ]);
  });
});
