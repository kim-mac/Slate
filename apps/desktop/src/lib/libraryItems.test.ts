import type { Clip, ClipGroup, LibraryItem } from '@ai-clip-memory/shared';
import { expect, test } from 'vitest';
import { replaceLibraryClip } from './libraryItems';

test('targeted clip replacement preserves unrelated groups and unchanged members', () => {
  const clip: Clip = {
    id: 'a',
    title: 'A',
    content: 'original',
    contentType: 'text',
    sourceApp: null,
    sourceUrl: null,
    sourcePageTitle: null,
    isPinned: false,
    createdAt: '2026-10-22T00:00:00Z',
    updatedAt: '2026-10-22T00:00:00Z',
  };
  const other = { ...clip, id: 'b' };
  const group: ClipGroup = {
    id: 'g',
    title: 'Group',
    members: [clip, other],
    isPinned: false,
    createdAt: clip.createdAt,
    updatedAt: clip.updatedAt,
  };
  const unrelated: LibraryItem = {
    kind: 'group',
    group: {
      ...group,
      id: 'other',
      members: [
        { ...clip, id: 'c' },
        { ...clip, id: 'd' },
      ],
    },
  };
  const items: LibraryItem[] = [{ kind: 'group', group }, unrelated];
  const updated = { ...clip, content: 'saved' };
  const result = replaceLibraryClip(items, updated);
  expect(result[1]).toBe(unrelated);
  expect(result[0]).not.toBe(items[0]);
  expect(result[0]?.kind === 'group' && result[0].group.members[0]).toBe(
    updated,
  );
  expect(result[0]?.kind === 'group' && result[0].group.members[1]).toBe(other);
  expect(group.members[0]).toBe(clip);
});
