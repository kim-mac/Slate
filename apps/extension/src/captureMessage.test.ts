import { describe, expect, test, vi } from 'vitest';
import type { BrowserCapturePayload } from '@ai-clip-memory/shared';
import { createCaptureRequest, type SendNativeMessage } from './bridge';
import {
  handleFloatingCapture,
  FLOATING_CAPTURE_MESSAGE,
} from './captureMessage';

const payload: BrowserCapturePayload = {
  content: '  exact\n selection\t',
  contentType: 'text',
  sourceApp: 'ChatGPT',
  sourceUrl: 'https://chatgpt.com/c/test',
  sourcePageTitle: 'Test',
};
const sender: chrome.runtime.MessageSender = {
  id: 'own-id',
  tab: {
    id: 2,
    index: 0,
    pinned: false,
    highlighted: false,
    windowId: 1,
    active: true,
    incognito: false,
    selected: true,
    frozen: false,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    lastAccessed: 0,
  },
  frameId: 0,
  url: 'https://chatgpt.com/c/test',
  origin: 'https://chatgpt.com',
};
const success = {
  version: 1,
  ok: true,
  clipId: 'f7a6c48d-bfd5-4f13-b54d-e238f7cd7842',
};
const message = (value: unknown = payload) => ({
  type: FLOATING_CAPTURE_MESSAGE,
  payload: value,
});

describe('floating capture boundary', () => {
  test('preserves payload and uses existing native bridge once', async () => {
    const send = vi.fn<SendNativeMessage>().mockResolvedValue(success);
    expect(
      await handleFloatingCapture(message(), sender, 'own-id', send),
    ).toEqual(success);
    expect(send).toHaveBeenCalledExactlyOnceWith(
      'com.aiclipmemory.bridge',
      createCaptureRequest(payload),
    );
  });
  test.each([
    {},
    { ...sender, id: 'other' },
    { ...sender, tab: undefined },
    { ...sender, tab: { ...sender.tab, id: undefined } },
    { ...sender, frameId: 1 },
    { ...sender, frameId: undefined },
    { ...sender, url: 'http://chatgpt.com/' },
    { ...sender, url: 'https://team.chatgpt.com/' },
    { ...sender, url: 'https://chatgpt.com.evil.test/' },
    { ...sender, origin: 'https://claude.ai' },
    { ...sender, origin: 'null' },
  ])('rejects untrusted sender %# without transport', async (invalid) => {
    const send = vi.fn<SendNativeMessage>();
    expect(
      await handleFloatingCapture(
        message(),
        invalid as chrome.runtime.MessageSender,
        'own-id',
        send,
      ),
    ).toMatchObject({ ok: false });
    expect(send).not.toHaveBeenCalled();
  });
  test.each([
    null,
    [],
    {},
    { ...payload, extra: 'no' },
    { ...payload, content: '' },
    { ...payload, content: '\n\t ' },
    { ...payload, content: 1 },
    { ...payload, contentType: 'code' },
    { ...payload, sourceApp: 'Claude' },
    { ...payload, sourceApp: 'Unknown' },
    { ...payload, sourcePageTitle: null },
    { ...payload, sourceUrl: 'https://claude.ai/' },
    { ...payload, sourceUrl: 'javascript:alert(1)' },
    { ...payload, sourceUrl: 'not a URL' },
  ])('rejects invalid payload %# without transport', async (invalid) => {
    const send = vi.fn<SendNativeMessage>();
    expect(
      await handleFloatingCapture(message(invalid), sender, 'own-id', send),
    ).toMatchObject({ ok: false });
    expect(send).not.toHaveBeenCalled();
  });
  test.each([
    null,
    {},
    { type: 'other', payload },
    { ...message(), extra: true },
  ])('rejects envelope %#', async (invalid) => {
    const send = vi.fn<SendNativeMessage>();
    expect(
      await handleFloatingCapture(invalid, sender, 'own-id', send),
    ).toMatchObject({ ok: false });
    expect(send).not.toHaveBeenCalled();
  });
  test.each([
    ['https://claude.ai/chat/test', 'Claude'],
    ['https://gemini.google.com/app/test', 'Gemini'],
    ['https://chat.openai.com/c/test', 'ChatGPT'],
  ])('accepts approved host %s', async (url, sourceApp) => {
    const send = vi.fn<SendNativeMessage>().mockResolvedValue(success);
    expect(
      await handleFloatingCapture(
        message({ ...payload, sourceUrl: url, sourceApp }),
        { ...sender, url, origin: new URL(url).origin },
        'own-id',
        send,
      ),
    ).toEqual(success);
  });
  test('counts UTF-8 bytes of the whole native envelope at the 1 MiB limit', async () => {
    const overhead = new TextEncoder().encode(
      JSON.stringify(createCaptureRequest({ ...payload, content: '' })),
    ).length;
    const send = vi.fn<SendNativeMessage>().mockResolvedValue(success);
    expect(
      await handleFloatingCapture(
        message({ ...payload, content: 'a'.repeat(1048576 - overhead) }),
        sender,
        'own-id',
        send,
      ),
    ).toEqual(success);
    send.mockClear();
    expect(
      await handleFloatingCapture(
        message({ ...payload, content: 'é'.repeat(524288) }),
        sender,
        'own-id',
        send,
      ),
    ).toEqual({ version: 1, ok: false, error: 'message_too_large' });
    expect(send).not.toHaveBeenCalled();
  });
  test('returns safe failure on unavailable host without logging', async () => {
    const log = vi.spyOn(console, 'log');
    const error = vi.spyOn(console, 'error');
    const send = vi
      .fn<SendNativeMessage>()
      .mockRejectedValue(new Error('private internal detail'));
    expect(
      await handleFloatingCapture(message(), sender, 'own-id', send),
    ).toEqual({ version: 1, ok: false, error: 'storage_unavailable' });
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
