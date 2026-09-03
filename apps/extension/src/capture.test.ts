import { describe, expect, test } from 'vitest';

import { createCapturePayload, detectBrowserSource } from './capture';

describe('detectBrowserSource', () => {
  test.each([
    ['https://chatgpt.com/c/123', 'ChatGPT'],
    ['https://team.chatgpt.com/c/123', 'ChatGPT'],
    ['https://chat.openai.com/c/123', 'ChatGPT'],
    ['https://claude.ai/chat/123', 'Claude'],
    ['https://team.claude.ai/chat/123', 'Claude'],
    ['https://gemini.google.com/app/123', 'Gemini'],
    ['https://workspace.gemini.google.com/app/123', 'Gemini'],
    ['https://example.com/article', 'Other Web'],
  ] as const)('detects %s as %s', (sourceUrl, expected) => {
    expect(detectBrowserSource(new URL(sourceUrl))).toBe(expected);
  });

  test.each([
    'https://notchatgpt.com/',
    'https://chatgpt.com.example.org/',
    'https://notclaude.ai/',
    'https://claude.ai.example.org/',
    'https://notgemini.google.com/',
    'https://gemini.google.com.example.org/',
    'https://team.chat.openai.com/',
  ])('does not use substring matching for %s', (sourceUrl) => {
    expect(detectBrowserSource(new URL(sourceUrl))).toBe('Other Web');
  });
});

describe('createCapturePayload', () => {
  test('creates the shared browser capture payload without changing selected text', () => {
    const payload = createCapturePayload({
      selectionText: '  selected text\n',
      pageUrl: 'https://example.com/page',
      pageTitle: 'Example page',
    });

    expect(payload).toEqual({
      content: '  selected text\n',
      contentType: 'text',
      sourceApp: 'Other Web',
      sourceUrl: 'https://example.com/page',
      sourcePageTitle: 'Example page',
    });
  });

  test.each([undefined, '', '   \n\t'])(
    'rejects a missing or blank selection: %s',
    (selectionText) => {
      expect(
        createCapturePayload({
          ...(selectionText === undefined ? {} : { selectionText }),
          pageUrl: 'https://example.com/',
          pageTitle: 'Example',
        }),
      ).toBeNull();
    },
  );

  test.each([
    undefined,
    '',
    'not a URL',
    'file:///C:/private.txt',
    'chrome://extensions/',
    'ftp://example.com/file.txt',
  ])('rejects an invalid or unsupported page URL: %s', (pageUrl) => {
    expect(
      createCapturePayload({
        selectionText: 'Selected text',
        ...(pageUrl === undefined ? {} : { pageUrl }),
        pageTitle: 'Example',
      }),
    ).toBeNull();
  });

  test('uses an empty page title when the tab title is unavailable', () => {
    expect(
      createCapturePayload({
        selectionText: 'Selected text',
        pageUrl: 'https://claude.ai/chat/example',
      }),
    ).toEqual({
      content: 'Selected text',
      contentType: 'text',
      sourceApp: 'Claude',
      sourceUrl: 'https://claude.ai/chat/example',
      sourcePageTitle: '',
    });
  });

  test('preserves supplied URL and title metadata exactly', () => {
    expect(
      createCapturePayload({
        selectionText: 'Selected text',
        pageUrl: 'https://example.com/Path?query=One#section',
        pageTitle: '  Page title  ',
      }),
    ).toMatchObject({
      sourceUrl: 'https://example.com/Path?query=One#section',
      sourcePageTitle: '  Page title  ',
    });
  });
});
