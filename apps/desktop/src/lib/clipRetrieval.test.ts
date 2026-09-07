import type { Clip } from '@ai-clip-memory/shared';
import { expect, test } from 'vitest';
import {
  clipPreview,
  displayTitle,
  formatContentType,
  matchesSearch,
  recentClips,
  truncatePresentation,
} from './clipRetrieval';

const clip: Clip = {
  id: 'b',
  content: '  Use literal [a+b] and local storage.\n',
  title: null,
  contentType: 'text',
  sourceApp: 'ChatGPT',
  sourceUrl: 'https://example.com',
  sourcePageTitle: 'Storage tips',
  isPinned: false,
  createdAt: '2026-09-03T12:00:00.000Z',
  updatedAt: '2026-09-03T12:00:00.000Z',
};

test('matches every term across fields regardless of order or case', () => {
  expect(matchesSearch(clip, 'CHATGPT\tlocal tips')).toBe(true);
  expect(matchesSearch(clip, 'local missing')).toBe(false);
});
test('preserves substring matching and treats punctuation literally', () => {
  expect(matchesSearch(clip, 'local storage')).toBe(true);
  expect(matchesSearch(clip, '[a+b]')).toBe(true);
  expect(matchesSearch(clip, 'a.*b')).toBe(false);
  expect(matchesSearch(clip, ' \n ')).toBe(true);
  expect(
    matchesSearch(
      { ...clip, sourceApp: null, sourceUrl: null, sourcePageTitle: null },
      'local',
    ),
  ).toBe(true);
});
test('derives titles without changing the clip', () => {
  expect(displayTitle({ ...clip, title: 'My title' })).toBe('My title');
  expect(displayTitle(clip)).toBe('Storage tips');
  expect(displayTitle({ ...clip, sourcePageTitle: null })).toBe(
    'Use literal [a+b] and local storage.',
  );
  expect(
    displayTitle({ ...clip, sourcePageTitle: null, content: '\n \t' }),
  ).toBe('Untitled clip');
  expect(clip.title).toBeNull();
  expect(clip.content.startsWith('  ')).toBe(true);
});
test('adds ellipsis only to genuinely truncated previews', () => {
  expect(clipPreview('short')).toBe('short');
  expect(clipPreview('x'.repeat(90))).toBe('x'.repeat(90));
  expect(clipPreview('x'.repeat(91))).toBe('x'.repeat(90) + '…');
});
test('truncates presentation text by grapheme when Intl.Segmenter is available', () => {
  if (typeof Intl.Segmenter !== 'function') return;

  expect(truncatePresentation('👨‍👩‍👧‍👦 family', 1)).toBe('👨‍👩‍👧‍👦…');
  expect(truncatePresentation('e\u0301clair', 1)).toBe('e\u0301…');
  expect(truncatePresentation('short', 5)).toBe('short');
});
test('presents stored content types with consistent casing', () => {
  expect(formatContentType('text')).toBe('Text');
  expect(formatContentType('code')).toBe('Code');
  expect(formatContentType('prompt')).toBe('Prompt');
  expect(formatContentType('link')).toBe('Link');
});
test('sorts newest first with stable ID ties without mutating input', () => {
  const older = {
    ...clip,
    id: 'c',
    createdAt: '2026-09-02T12:00:00.000Z',
    isPinned: true,
  };
  const input = [older, clip, { ...clip, id: 'a' }];
  expect(recentClips(input).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  expect(input[0]).toBe(older);
});
