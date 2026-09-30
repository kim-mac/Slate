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
    matchesSearch(clip, searchText),
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
