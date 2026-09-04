import type { Clip } from '@ai-clip-memory/shared';

export function matchesSearch(clip: Clip, searchText: string): boolean {
  const query = searchText.trim().toLocaleLowerCase();
  if (!query) return true;
  const fields = [
    clip.content,
    clip.title,
    clip.sourceApp,
    clip.sourceUrl,
    clip.sourcePageTitle,
    clip.contentType,
  ]
    .filter((value): value is string => value !== null)
    .map((value) => value.toLocaleLowerCase());
  return (
    fields.some((value) => value.includes(query)) ||
    query
      .split(/\s+/u)
      .every((term) => fields.some((value) => value.includes(term)))
  );
}

export function displayTitle(clip: Clip): string {
  return (
    clip.title?.trim() ||
    clip.sourcePageTitle?.trim() ||
    clip.content
      .split(/\r?\n/u)
      .find((line) => line.trim())
      ?.trim() ||
    'Untitled clip'
  );
}

export function clipPreview(content: string): string {
  return content.length > 90 ? content.slice(0, 90) + '…' : content;
}

export function recentClips(clips: Clip[]): Clip[] {
  return [...clips].sort(
    (a, b) =>
      Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
