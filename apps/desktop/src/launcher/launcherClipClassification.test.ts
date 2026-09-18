import { describe, expect, test } from 'vitest';

import {
  automaticContentType,
  isSingleHttpUrl,
} from './launcherClipClassification';

describe('launcher clip URL classification', () => {
  test.each([
    'http://example.com',
    'https://example.com/path?query=one',
    '  https://example.com/kept-whitespace  ',
  ])('recognizes a single HTTP(S) URL: %s', (content) => {
    expect(isSingleHttpUrl(content)).toBe(true);
    expect(automaticContentType(content)).toBe('link');
  });

  test.each([
    '',
    '   ',
    'ftp://example.com',
    'https://example.com another value',
    'https://example.com\nhttps://openai.com',
    'not a URL',
  ])('keeps non-single-web-URL content as Text: %s', (content) => {
    expect(isSingleHttpUrl(content)).toBe(false);
    expect(automaticContentType(content)).toBe('text');
  });
});
