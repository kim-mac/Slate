import type { Clip, ClipGroup, ClipInput } from '@ai-clip-memory/shared';
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
const group: ClipGroup = {
  id: 'group-id',
  title: 'Merged clips',
  isPinned: false,
  createdAt: clip.createdAt,
  updatedAt: clip.updatedAt,
  members: [clip, { ...clip, id: 'second' }],
};

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe('tauriClipClient', () => {
  test('group copy uses the existing native clipboard command with explicit displayed member order', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await tauriClipClient.copyContent(group.id, ['second', clip.id]);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('copy_clip_content', {
      id: group.id,
      memberIds: ['second', clip.id],
    });
  });
  test('title-only mode and group rename carry exact nullable and opaque expected states', async () => {
    vi.mocked(invoke).mockResolvedValue(clip);
    await tauriClipClient.update(clip.id, input, {
      titleEdit: { expectedTitle: null },
    });
    await tauriClipClient.renameGroup(group.id, 'Renamed', 'opaque-state');
    expect(vi.mocked(invoke).mock.calls).toEqual([
      [
        'update_clip',
        { id: clip.id, input, titleEdit: { expectedTitle: null } },
      ],
      [
        'rename_group',
        { groupId: group.id, title: 'Renamed', expectedState: 'opaque-state' },
      ],
    ]);
  });
  test('inline content guards use the existing update command without changing full Edit calls', async () => {
    vi.mocked(invoke).mockResolvedValue(clip);
    await tauriClipClient.update(clip.id, input, {
      expectedContent: 'Original content',
    });
    expect(invoke).toHaveBeenCalledExactlyOnceWith('update_clip', {
      id: clip.id,
      input,
      expectedContent: 'Original content',
    });
  });
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

  test('maps persistent group operations to their atomic Tauri commands', async () => {
    vi.mocked(invoke).mockResolvedValue(group);
    const selected = [
      { kind: 'clip' as const, id: clip.id },
      { kind: 'group' as const, id: group.id },
    ];
    await tauriClipClient.merge(selected);
    await tauriClipClient.unmergeMember(group.id, clip.id);
    await tauriClipClient.unmergeGroup(group.id);
    await tauriClipClient.deleteGroupMember(group.id, clip.id);
    await tauriClipClient.deleteGroup(
      group.id,
      group.members.map((clip) => clip.id),
    );
    await tauriClipClient.setGroupPinned(group.id, true);
    expect(vi.mocked(invoke).mock.calls).toEqual([
      ['merge_clips', { selected }],
      ['unmerge_group_member', { groupId: group.id, clipId: clip.id }],
      ['unmerge_group', { groupId: group.id }],
      ['delete_group_member', { groupId: group.id, clipId: clip.id }],
      [
        'delete_group',
        {
          groupId: group.id,
          expectedMemberIds: group.members.map((clip) => clip.id),
        },
      ],
      ['set_group_pinned', { groupId: group.id, isPinned: true }],
    ]);
  });
});
