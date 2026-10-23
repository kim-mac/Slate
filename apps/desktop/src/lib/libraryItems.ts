import type {
  Clip,
  ClipContentType,
  LibraryItem,
} from '@ai-clip-memory/shared';
import { matchesSearch } from './clipRetrieval';
import { clipPreview, displayTitle, formatContentType } from './clipRetrieval';

export function libraryItemId(item: LibraryItem): string {
  return item.kind === 'clip' ? item.clip.id : item.group.id;
}

export function asLibraryItem(item: LibraryItem | Clip): LibraryItem {
  return 'kind' in item ? item : { kind: 'clip', clip: item };
}

export function libraryItemCreatedAt(item: LibraryItem): string {
  return item.kind === 'clip' ? item.clip.createdAt : item.group.createdAt;
}

export function libraryItemPinned(item: LibraryItem): boolean {
  return item.kind === 'clip' ? item.clip.isPinned : item.group.isPinned;
}

export function libraryItemMembers(item: LibraryItem): Clip[] {
  return item.kind === 'clip' ? [item.clip] : item.group.members;
}

export function libraryItemContainingClip(
  items: readonly LibraryItem[],
  id: string,
): LibraryItem | undefined {
  return items.find((item) =>
    libraryItemMembers(item).some((clip) => clip.id === id),
  );
}

export function findLibraryClip(
  items: readonly LibraryItem[],
  id: string,
): Clip | undefined {
  const item = libraryItemContainingClip(items, id);
  return item
    ? libraryItemMembers(item).find((clip) => clip.id === id)
    : undefined;
}

export function replaceLibraryClip(
  items: readonly LibraryItem[],
  updated: Clip,
): LibraryItem[] {
  return items.map((item) =>
    item.kind === 'clip'
      ? item.clip.id === updated.id
        ? { kind: 'clip', clip: updated }
        : item
      : !item.group.members.some((clip) => clip.id === updated.id)
        ? item
        : {
            ...item,
            group: {
              ...item.group,
              members: item.group.members.map((clip) =>
                clip.id === updated.id ? updated : clip,
              ),
            },
          },
  );
}

export function removeLibraryClip(
  items: readonly LibraryItem[],
  id: string,
): LibraryItem[] {
  return items.flatMap((item): LibraryItem[] => {
    if (item.kind === 'clip') return item.clip.id === id ? [] : [item];
    const members = item.group.members.filter((clip) => clip.id !== id);
    if (members.length === item.group.members.length) return [item];
    if (members.length === 0) return [];
    if (members.length === 1) return [{ kind: 'clip', clip: members[0]! }];
    return [{ kind: 'group', group: { ...item.group, members } }];
  });
}

export function recentLibraryItems(
  items: readonly LibraryItem[],
): LibraryItem[] {
  return [...items].sort(
    (a, b) =>
      Date.parse(libraryItemCreatedAt(b)) -
        Date.parse(libraryItemCreatedAt(a)) ||
      (libraryItemId(a) < libraryItemId(b)
        ? -1
        : libraryItemId(a) > libraryItemId(b)
          ? 1
          : 0),
  );
}

export function matchesLibraryItemSearch(
  item: LibraryItem,
  searchText: string,
): boolean {
  return libraryItemMembers(item).some((clip) =>
    matchesSearch(
      item.kind === 'group'
        ? { ...clip, title: `${item.group.title} ${clip.title ?? ''}` }
        : clip,
      searchText,
    ),
  );
}

export function matchesLibraryItemContentType(
  item: LibraryItem,
  contentType: ClipContentType | 'all',
): boolean {
  return (
    contentType === 'all' ||
    libraryItemMembers(item).some((clip) => clip.contentType === contentType)
  );
}

export function libraryItemSourceUrls(item: LibraryItem): Set<string> {
  return new Set(
    libraryItemMembers(item)
      .map((clip) => clip.sourceUrl)
      .filter((url): url is string => url !== null && url.trim().length > 0),
  );
}

export function libraryItemTitle(item: LibraryItem): string {
  return item.kind === 'clip' ? displayTitle(item.clip) : item.group.title;
}

export function libraryItemPreview(item: LibraryItem): string {
  return item.kind === 'clip'
    ? clipPreview(item.clip.content)
    : `${item.group.members.length} clips`;
}

export function libraryItemTypeLabel(item: LibraryItem): string {
  if (item.kind === 'clip') return formatContentType(item.clip.contentType);
  const types = new Set(item.group.members.map((clip) => clip.contentType));
  return types.size === 1
    ? formatContentType(item.group.members[0]!.contentType)
    : 'Mixed';
}

export function libraryItemSourceLabel(item: LibraryItem): string {
  if (item.kind === 'clip') return item.clip.sourceApp || 'Local clip';
  return `${item.group.members.length} clips`;
}
