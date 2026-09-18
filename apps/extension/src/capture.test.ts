import { describe, expect, test } from 'vitest';

import * as capture from './capture';

const { createCapturePayload, detectBrowserSource } = capture;

type PageCaptureInput = {
  tabUrl?: string;
  pageUrl?: string;
  pageTitle?: string;
};

function createPageCapturePayload(input: PageCaptureInput) {
  const builder = (
    capture as typeof capture & {
      createPageCapturePayload?: (value: PageCaptureInput) => unknown;
    }
  ).createPageCapturePayload;
  if (!builder) throw new Error('createPageCapturePayload is not implemented');
  return builder(input);
}

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

describe('createPageCapturePayload', () => {
  test.each([
    ['http://example.com/page', 'Other Web'],
    ['https://chatgpt.com/c/example', 'ChatGPT'],
    ['https://claude.ai/chat/example', 'Claude'],
    ['https://gemini.google.com/app/example', 'Gemini'],
  ] as const)('creates a Link capture for %s', (url, sourceApp) => {
    expect(
      createPageCapturePayload({
        tabUrl: url,
        pageTitle: '  Exact page title  ',
      }),
    ).toEqual({
      content: url,
      contentType: 'link',
      sourceApp,
      sourceUrl: url,
      sourcePageTitle: '  Exact page title  ',
    });
  });

  test('preserves the exact URL including query parameters and fragments', () => {
    const url = 'https://example.com/Path?query=One&next=%2Ftwo#Section';

    expect(
      createPageCapturePayload({ tabUrl: url, pageTitle: 'Page' }),
    ).toEqual({
      content: url,
      contentType: 'link',
      sourceApp: 'Other Web',
      sourceUrl: url,
      sourcePageTitle: 'Page',
    });
  });

  test.each([undefined, '', '   \n\t'])(
    'normalizes a blank title to empty text',
    (pageTitle) => {
      expect(
        createPageCapturePayload({
          tabUrl: 'https://example.com/',
          ...(pageTitle === undefined ? {} : { pageTitle }),
        }),
      ).toMatchObject({ sourcePageTitle: '' });
    },
  );

  test('prefers the top-level tab URL and falls back to the context page URL', () => {
    expect(
      createPageCapturePayload({
        tabUrl: 'https://example.com/top',
        pageUrl: 'https://example.com/top',
        pageTitle: 'Top',
      }),
    ).toMatchObject({ content: 'https://example.com/top' });
    expect(
      createPageCapturePayload({
        pageUrl: 'https://example.com/fallback',
        pageTitle: 'Fallback',
      }),
    ).toMatchObject({ content: 'https://example.com/fallback' });
  });

  test('rejects a stale click when tab and context page URLs disagree', () => {
    expect(
      createPageCapturePayload({
        tabUrl: 'https://example.com/new',
        pageUrl: 'https://example.com/old',
        pageTitle: 'Page',
      }),
    ).toBeNull();
  });

  test.each([
    undefined,
    '',
    'not a URL',
    'chrome://extensions/',
    'edge://extensions/',
    'file:///C:/private.txt',
    'data:text/plain,private',
    'blob:https://example.com/id',
    'javascript:alert(1)',
    'ftp://example.com/file.txt',
    'https://user:secret@example.com/private',
    'https://',
  ])('rejects an unsupported current page URL: %s', (tabUrl) => {
    expect(
      createPageCapturePayload({
        ...(tabUrl === undefined ? {} : { tabUrl }),
        pageTitle: 'Page',
      }),
    ).toBeNull();
  });
});
