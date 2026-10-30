import type { Clip, LibraryItem } from '@ai-clip-memory/shared';
import { describe, expect, test } from 'vitest';
import {
  hasSameSourceHint,
  libraryItemRef,
  reconcileSelectedIds,
  selectedItemsInLibraryOrder,
  selectedItemsInSelectionOrder,
} from './mergeClips';
import {
  matchesLibraryItemContentType,
  matchesLibraryItemSearch,
  findLibraryClip,
  libraryItemContainingClip,
  replaceLibraryClip,
  removeLibraryClip,
} from './libraryItems';

const clip = (id: string, content: string, createdAt: string): Clip => ({
  id,
  content,
  contentType: 'code',
  title: id,
  sourceApp: 'Browser',
  sourceUrl: 'https://example.com/source',
  sourcePageTitle: 'Source page',
  isPinned: true,
  createdAt,
  updatedAt: createdAt,
});

const older = clip('older', 'Older content', '2026-09-01T00:00:00.000Z');
const tiedB = clip('b', 'B content', '2026-09-02T00:00:00.000Z');
const tiedA = clip('a', 'A content', '2026-09-02T00:00:00.000Z');

const item = (value: Clip): LibraryItem => ({ kind: 'clip', clip: value });
const group: LibraryItem = {
  kind: 'group',
  group: {
    id: 'group',
    title: 'Source page',
    isPinned: false,
    createdAt: '2026-09-03T00:00:00.000Z',
    updatedAt: '2026-09-03T00:00:00.000Z',
    members: [tiedA, older],
  },
};

describe('Persistent Merge selection', () => {
  test('manual merge retains click order across filtering and deselection', () => {
    expect(
      selectedItemsInSelectionOrder(
        [item(older), item(tiedB), item(tiedA)],
        new Set(['older', 'missing', 'b', 'a']),
      ).map(libraryItemRef),
    ).toEqual([
      { kind: 'clip', id: 'older' },
      { kind: 'clip', id: 'b' },
      { kind: 'clip', id: 'a' },
    ]);
  });

  test('member lookup and replacement preserve the containing group and other members', () => {
    const updated = {
      ...older,
      content: 'Updated member content',
      isPinned: true,
    };
    expect(findLibraryClip([group], older.id)).toEqual(older);
    expect(libraryItemContainingClip([group], older.id)).toEqual(group);
    expect(replaceLibraryClip([group], updated)).toEqual([
      {
        ...group,
        group: { ...group.group, members: [tiedA, updated] },
      },
    ]);
    expect(libraryItemContainingClip([group], 'missing')).toBeUndefined();
  });

  test('committed deletion removes members and dissolves groups without losing survivors', () => {
    expect(removeLibraryClip([group, item(tiedB)], older.id)).toEqual([
      item(tiedA),
      item(tiedB),
    ]);
    const larger = {
      ...group,
      group: { ...group.group, members: [tiedA, older, tiedB] },
    };
    expect(removeLibraryClip([larger], older.id)).toEqual([
      { ...larger, group: { ...larger.group, members: [tiedA, tiedB] } },
    ]);
    expect(removeLibraryClip([group, item(tiedB)], tiedB.id)).toEqual([group]);
    expect(removeLibraryClip([group], 'missing')).toEqual([group]);
  });

  test('orders unique selected IDs newest first with the existing ID tie-breaker', () => {
    expect(
      selectedItemsInLibraryOrder(
        [item(older), item(tiedB), item(tiedA), item(tiedA)],
        new Set(['older', 'a', 'b']),
      ).map((selected) => libraryItemRef(selected).id),
    ).toEqual(['a', 'b', 'older']);
  });

  test('ignores missing IDs and does not let hidden results change ordering', () => {
    expect(
      selectedItemsInLibraryOrder(
        [item(older), item(tiedB), item(tiedA)],
        new Set(['older', 'missing', 'a']),
      ).map((selected) => libraryItemRef(selected).id),
    ).toEqual(['a', 'older']);
    expect(
      reconcileSelectedIds(new Set(['older', 'missing', 'a']), [
        item(older),
        item(tiedA),
      ]),
    ).toEqual(new Set(['older', 'a']));
  });

  test('converts clips and groups to explicit server-side references', () => {
    expect(libraryItemRef(item(older))).toEqual({ kind: 'clip', id: 'older' });
    expect(libraryItemRef(group)).toEqual({ kind: 'group', id: 'group' });
  });

  test('matches a group once when any member matches search or content type', () => {
    expect(matchesLibraryItemSearch(group, 'Older content')).toBe(true);
    expect(matchesLibraryItemSearch(group, 'does not exist')).toBe(false);
    expect(matchesLibraryItemContentType(group, 'code')).toBe(true);
    expect(matchesLibraryItemContentType(group, 'link')).toBe(false);
  });

  test('suggests exact non-empty source URL matches across clips and groups', () => {
    const otherPage = item({
      ...tiedB,
      id: 'other-page',
      sourceUrl: 'https://example.com/other',
    });
    const desktop = item({ ...tiedB, id: 'desktop', sourceUrl: null });
    expect(hasSameSourceHint(group, new Set(['group']), [group])).toBe(false);
    expect(
      hasSameSourceHint(item(tiedB), new Set(['group']), [group, item(tiedB)]),
    ).toBe(true);
    expect(hasSameSourceHint(otherPage, new Set(['group']), [group])).toBe(
      false,
    );
    expect(hasSameSourceHint(desktop, new Set(['group']), [group])).toBe(false);
  });
});
