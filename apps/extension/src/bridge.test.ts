import { describe, expect, test, vi } from 'vitest';

import type { BrowserCapturePayload } from '@ai-clip-memory/shared';

import {
  createCaptureRequest,
  sendCaptureToDesktop,
  type SendNativeMessage,
} from './bridge';

const payload: BrowserCapturePayload = {
  content: '  exact selected text\n',
  contentType: 'text',
  sourceApp: 'ChatGPT',
  sourceUrl: 'https://chatgpt.com/c/example',
  sourcePageTitle: 'Example conversation',
};

describe('native messaging bridge client', () => {
  test('constructs the exact versioned capture request', () => {
    expect(createCaptureRequest(payload)).toEqual({
      version: 1,
      type: 'capture_clip',
      payload,
    });
  });

  test('uses the unchanged envelope for a Link page capture', () => {
    const pagePayload: BrowserCapturePayload = {
      content: 'https://example.com/path?one=two#three',
      contentType: 'link',
      sourceApp: 'Other Web',
      sourceUrl: 'https://example.com/path?one=two#three',
      sourcePageTitle: 'Example page',
    };

    expect(createCaptureRequest(pagePayload)).toEqual({
      version: 1,
      type: 'capture_clip',
      payload: pagePayload,
    });
  });

  test('accepts a minimal successful response', async () => {
    const sendNativeMessage = vi.fn<SendNativeMessage>().mockResolvedValue({
      version: 1,
      ok: true,
      clipId: 'f7a6c48d-bfd5-4f13-b54d-e238f7cd7842',
    });

    await expect(
      sendCaptureToDesktop(payload, sendNativeMessage),
    ).resolves.toEqual({
      version: 1,
      ok: true,
      clipId: 'f7a6c48d-bfd5-4f13-b54d-e238f7cd7842',
    });
    expect(sendNativeMessage).toHaveBeenCalledWith(
      'com.aiclipmemory.bridge',
      createCaptureRequest(payload),
    );
  });

  test('accepts a declared safe host failure', async () => {
    const sendNativeMessage = vi.fn<SendNativeMessage>().mockResolvedValue({
      version: 1,
      ok: false,
      error: 'invalid_source_url',
    });

    await expect(
      sendCaptureToDesktop(payload, sendNativeMessage),
    ).resolves.toEqual({
      version: 1,
      ok: false,
      error: 'invalid_source_url',
    });
  });

  test.each([
    undefined,
    null,
    {},
    { version: 2, ok: true, clipId: 'not-valid' },
    { version: 1, ok: true, clipId: 'not-a-uuid' },
    { version: 1, ok: false, error: 'raw sqlite failure' },
    { version: 1, ok: false, error: 'invalid_content', content: 'leak' },
  ])('maps an invalid response to a safe failure: %j', async (response) => {
    const sendNativeMessage = vi
      .fn<SendNativeMessage>()
      .mockResolvedValue(response);

    await expect(
      sendCaptureToDesktop(payload, sendNativeMessage),
    ).resolves.toEqual({
      version: 1,
      ok: false,
      error: 'malformed_message',
    });
  });

  test('maps a native messaging runtime failure without logging content', async () => {
    const consoleLog = vi
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const sendNativeMessage = vi
      .fn<SendNativeMessage>()
      .mockRejectedValue(new Error(`Host failed for ${payload.content}`));

    await expect(
      sendCaptureToDesktop(payload, sendNativeMessage),
    ).resolves.toEqual({
      version: 1,
      ok: false,
      error: 'storage_unavailable',
    });
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
