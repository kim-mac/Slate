import { describe, expect, test } from 'vitest';

import { validateClipInputSize } from './clipInputLimits';

const input = (content: string) => ({
  content,
  contentType: 'text' as const,
  title: null,
  sourceApp: null,
  sourceUrl: null,
  sourcePageTitle: null,
});

describe('clip input byte limits', () => {
  test('measures UTF-8 bytes rather than JavaScript code units', () => {
    expect(validateClipInputSize(input('😀'.repeat(262_144)))).toBeNull();
    expect(validateClipInputSize(input('😀'.repeat(262_145)))).toContain(
      '1 MiB',
    );
  });

  test('limits every optional metadata value independently', () => {
    for (const key of [
      'title',
      'sourceApp',
      'sourceUrl',
      'sourcePageTitle',
    ] as const) {
      expect(
        validateClipInputSize({
          ...input('content'),
          [key]: 'é'.repeat(8_193),
        }),
      ).toContain('16 KiB');
    }
  });
});
