import type { Clip, ClipContentType } from '@ai-clip-memory/shared';

export function truncatePresentation(text: string, maxLength: number): string {
  if (maxLength <= 0) return text.length > 0 ? '…' : '';

  const segments =
    typeof Intl.Segmenter === 'function'
      ? Array.from(
          new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
            text,
          ),
          ({ segment }) => segment,
        )
      : Array.from(text);
  return segments.length > maxLength
    ? segments.slice(0, maxLength).join('') + '…'
    : text;
}

export function formatContentType(type: ClipContentType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

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
  return truncatePresentation(content, 90);
}

export function recentClips(clips: Clip[]): Clip[] {
  return [...clips].sort(
    (a, b) =>
      Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
