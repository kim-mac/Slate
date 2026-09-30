import type { LibraryItem, LibraryItemRef } from '@ai-clip-memory/shared';
import {
  libraryItemId,
  libraryItemSourceUrls,
  recentLibraryItems,
} from './libraryItems';

export function selectedItemsInLibraryOrder(
  items: readonly LibraryItem[],
  selectedIds: ReadonlySet<string>,
): LibraryItem[] {
  const seen = new Set<string>();
  return recentLibraryItems(items).filter((item) => {
    const id = libraryItemId(item);
    if (!selectedIds.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function reconcileSelectedIds(
  selectedIds: ReadonlySet<string>,
  items: readonly LibraryItem[],
): Set<string> {
  const available = new Set(items.map(libraryItemId));
  return new Set([...selectedIds].filter((id) => available.has(id)));
}

export function libraryItemRef(item: LibraryItem): LibraryItemRef {
  return item.kind === 'clip'
    ? { kind: 'clip', id: item.clip.id }
    : { kind: 'group', id: item.group.id };
}

export function hasSameSourceHint(
  candidate: LibraryItem,
  selectedIds: ReadonlySet<string>,
  allItems: readonly LibraryItem[],
): boolean {
  if (selectedIds.has(libraryItemId(candidate))) return false;
  const selectedUrls = new Set<string>();
  for (const item of allItems) {
    if (!selectedIds.has(libraryItemId(item))) continue;
    for (const url of libraryItemSourceUrls(item)) selectedUrls.add(url);
  }
  if (selectedUrls.size === 0) return false;
  for (const url of libraryItemSourceUrls(candidate)) {
    if (selectedUrls.has(url)) return true;
  }
  return false;
}
