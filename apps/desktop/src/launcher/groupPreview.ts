import type { ClipGroup } from '@ai-clip-memory/shared';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const memberLimit = 12;
const codePointLimit = 2048;
const snippetLimit = 48;
const displayLimit = 3;

function memberPreview(content: string): string {
  let end = 0;
  for (let count = 0; count < codePointLimit && end < content.length; count++) {
    end += content.codePointAt(end)! > 0xffff ? 2 : 1;
  }

  const clipped = end < content.length;
  let prefix = content.slice(0, end);
  if (clipped) {
    // The last cluster may continue beyond our bounded prefix. Drop it even
    // when it happens to be complete, without inspecting more of the content.
    let lastStart = 0;
    for (const { index } of segmenter.segment(prefix)) lastStart = index;
    prefix = prefix.slice(0, lastStart);
  }

  const normalized = prefix.replace(/\s+/gu, ' ').trim();
  if (!normalized) return '';

  const graphemes = Array.from(
    segmenter.segment(normalized),
    ({ segment }) => segment,
  );
  return clipped || graphemes.length > snippetLimit
    ? `${graphemes.slice(0, snippetLimit - 1).join('')}…`
    : normalized;
}

export function groupPreview(group: Pick<ClipGroup, 'members'>): string {
  const snippets: string[] = [];
  const seen = new Set<string>();
  let inspected = 0;
  while (
    inspected < Math.min(group.members.length, memberLimit) &&
    snippets.length < displayLimit
  ) {
    const snippet = memberPreview(group.members[inspected++]!.content);
    if (snippet && !seen.has(snippet)) {
      seen.add(snippet);
      snippets.push(snippet);
    }
  }

  if (snippets.length === 0) return 'No preview available';
  const preview = snippets.join(' · ');
  // Three 48-grapheme snippets, two separators, and an omission marker total
  // at most 151 graphemes, within the combined 160-grapheme budget.
  return inspected < group.members.length && !preview.endsWith('…')
    ? `${preview}…`
    : preview;
}
