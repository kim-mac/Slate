import type { Clip, ClipGroup } from '@ai-clip-memory/shared';
import { expect, test, vi } from 'vitest';
import { groupPreview } from './groupPreview';

function group(...contents: string[]): Pick<ClipGroup, 'members'> {
  return { members: contents.map((content) => ({ content }) as Clip) };
}

function graphemes(text: string): string[] {
  return Array.from(
    new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
    ({ segment }) => segment,
  );
}

test('preserves member order while normalizing whitespace and skipping empty duplicates', () => {
  expect(
    groupPreview(
      group(
        '\n \t',
        '  first\n\t idea  ',
        'first idea',
        'second\u00a0idea',
        ' third ',
      ),
    ),
  ).toBe('first idea · second idea · third');
});

test('uses an exact fallback when no inspected member has visible content', () => {
  expect(groupPreview(group())).toBe('No preview available');
  expect(groupPreview(group('', ' \n\t\r '))).toBe('No preview available');
});

test('keeps 48 graphemes unchanged and includes ellipsis within a truncated snippet budget', () => {
  expect(groupPreview(group('a'.repeat(48)))).toBe('a'.repeat(48));
  expect(groupPreview(group('a'.repeat(49)))).toBe(`${'a'.repeat(47)}…`);
  expect(graphemes(groupPreview(group('a'.repeat(49))))).toHaveLength(48);
});

test('preserves emoji and combining characters when truncating graphemes', () => {
  const family = '👨‍👩‍👧‍👦';
  const accented = 'e\u0301';
  expect(groupPreview(group(family.repeat(49)))).toBe(`${family.repeat(47)}…`);
  expect(groupPreview(group(accented.repeat(49)))).toBe(
    `${accented.repeat(47)}…`,
  );
});

test('deduplicates the normalized displayed snippets after truncation', () => {
  const common = 'x'.repeat(48);
  expect(groupPreview(group(`${common} one`, `${common}\n two`, 'next'))).toBe(
    `${'x'.repeat(47)}… · next`,
  );
});

test('stops after three distinct snippets and indicates omitted members', () => {
  const input = group('one', 'two', 'three', 'four');
  Object.defineProperty(input.members, 3, {
    get: () => {
      throw new Error('read fourth member');
    },
  });
  expect(groupPreview(input)).toBe('one · two · three…');
  expect(groupPreview(group('one', 'two', 'x'.repeat(49), 'four'))).toBe(
    `one · two · ${'x'.repeat(47)}…`,
  );
});

test('keeps the largest reachable combined preview within 160 graphemes including omission ellipsis', () => {
  const snippets = ['a'.repeat(48), 'b'.repeat(48), 'c'.repeat(48)];
  expect(groupPreview(group(...snippets))).toBe(snippets.join(' · '));
  const omitted = groupPreview(group(...snippets, 'fourth'));
  expect(omitted).toBe(`${snippets.join(' · ')}…`);
  expect(graphemes(omitted)).toHaveLength(151);
  expect(graphemes(omitted).length).toBeLessThanOrEqual(160);
});

test('inspects at most the first twelve members and indicates the cap', () => {
  const input = group('first', ...Array<string>(11).fill(''), 'outside limit');
  Object.defineProperty(input.members, 12, {
    get: () => {
      throw new Error('read thirteenth member');
    },
  });
  expect(groupPreview(input)).toBe('first…');
  const empty = group(...Array<string>(12).fill(''), 'outside limit');
  expect(groupPreview(empty)).toBe('No preview available');
});

test('counts the bounded prefix in Unicode code points rather than UTF-16 units', () => {
  const longEmoji = `${'👩\u200d'.repeat(1023)}👩`;
  expect(Array.from(longEmoji)).toHaveLength(2047);
  expect(groupPreview(group(`${longEmoji}x`))).toBe(`${longEmoji}x`);
  expect(groupPreview(group(`${longEmoji}xy`))).toBe(`${longEmoji}…`);
});

test('does not read visible content beyond the 2048-code-point prefix', () => {
  expect(groupPreview(group(`${' '.repeat(2046)}ABC`))).toBe('A…');
  expect(groupPreview(group(`${' '.repeat(2048)}hidden`))).toBe(
    'No preview available',
  );
});

test('drops an incomplete trailing ZWJ or combining grapheme at the prefix bound', () => {
  expect(groupPreview(group(`start ${'👩\u200d'.repeat(1100)}👩 end`))).toBe(
    'start…',
  );
  expect(groupPreview(group(`start e${'\u0301'.repeat(2050)} end`))).toBe(
    'start…',
  );
});

test('bounds scanning and segmentation even when a member contains a million code points', () => {
  const input = group('x'.repeat(1_000_000));
  const codePointAt = vi.spyOn(String.prototype, 'codePointAt');
  const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment');
  try {
    expect(groupPreview(input)).toBe(`${'x'.repeat(47)}…`);
    expect(codePointAt.mock.calls.length).toBeLessThanOrEqual(2048);
    expect(segment).toHaveBeenCalled();
    for (const [text] of segment.mock.calls) {
      expect(Array.from(text).length).toBeLessThanOrEqual(2048);
    }
  } finally {
    codePointAt.mockRestore();
    segment.mockRestore();
  }
});

test('is deterministic without mutating frozen groups, members, or clips', () => {
  const input = group(' first\nidea ', 'second');
  input.members.forEach(Object.freeze);
  Object.freeze(input.members);
  Object.freeze(input);
  expect(groupPreview(input)).toBe('first idea · second');
  expect(groupPreview(input)).toBe('first idea · second');
  expect(input.members[0]!.content).toBe(' first\nidea ');
});
