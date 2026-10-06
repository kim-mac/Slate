// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://chatgpt.com/c/test"}
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CaptureClipResponse } from '@ai-clip-memory/shared';
import type { SendNativeMessage } from './bridge';
import { sendFloatingCaptureMessage } from './contentMessaging';
import { CAPTURE_NOTIFICATION_ID } from './contextMenuFeedback';
import { installFloatingSave } from './floatingSave';

const success: CaptureClipResponse = {
  version: 1,
  ok: true,
  clipId: 'f7a6c48d-bfd5-4f13-b54d-e238f7cd7842',
};
const sender: chrome.runtime.MessageSender = {
  id: 'test-extension',
  tab: { id: 7 } as chrome.tabs.Tab,
  frameId: 0,
  url: 'https://chatgpt.com/c/test',
  origin: 'https://chatgpt.com',
};
type MessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (response: unknown) => void,
) => boolean | undefined;
type ClickListener = (
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab,
) => void;

let cleanup: (() => void) | undefined;

async function connectCapture(
  sendNativeMessage = vi.fn<SendNativeMessage>().mockResolvedValue(success),
) {
  let messageListener: MessageListener | undefined;
  let clickListener: ClickListener | undefined;
  const notification = {
    clear: vi.fn().mockResolvedValue(true),
    create: vi.fn().mockResolvedValue(CAPTURE_NOTIFICATION_ID),
  };
  const respond = vi.fn<(response: unknown) => void>();
  vi.stubGlobal('chrome', {
    notifications: notification,
    contextMenus: {
      onClicked: {
        addListener: (listener: ClickListener) => {
          clickListener = listener;
        },
      },
    },
    runtime: {
      id: sender.id,
      getURL: (path: string) => `chrome-extension://test-extension/${path}`,
      sendNativeMessage,
      onInstalled: { addListener: vi.fn() },
      onMessage: {
        addListener: (listener: MessageListener) => {
          messageListener = listener;
        },
      },
      sendMessage: (message: unknown) =>
        new Promise<unknown>((resolve, reject) => {
          const handled = messageListener?.(message, sender, (response) => {
            respond(response);
            resolve(response);
          });
          if (!handled) reject(new Error('Capture message was not handled'));
        }),
    },
  });
  await import('./background');

  // Deliver a browser-trusted activation at the DOM listener boundary, as in
  // floatingSave.test.ts. Production selection, messaging, and feedback run unchanged.
  const original = HTMLButtonElement.prototype.addEventListener;
  let activation: EventListener | undefined;
  vi.spyOn(HTMLButtonElement.prototype, 'addEventListener').mockImplementation(
    function (this: HTMLButtonElement, type, listener, options) {
      if (type === 'click' && typeof listener === 'function')
        activation = listener;
      original.call(this, type, listener, options);
    },
  );
  cleanup = installFloatingSave(
    document,
    (payload) =>
      sendFloatingCaptureMessage({ type: 'floating_capture', payload }),
    '',
  );
  return {
    notification,
    sendNativeMessage,
    respond,
    activate: () => activation?.({ isTrusted: true } as unknown as Event),
    click: (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) =>
      clickListener?.(info, tab),
  };
}

function selectText(text = 'notification test selection') {
  const paragraph = document.createElement('p');
  paragraph.textContent = text;
  document.body.append(paragraph);
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  range.getBoundingClientRect = () => ({
    left: 20,
    right: 100,
    top: 30,
    bottom: 50,
    width: 80,
    height: 20,
    x: 20,
    y: 30,
    toJSON: () => ({}),
  });
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);
  document.dispatchEvent(new Event('pointerup'));
}

function control() {
  return document
    .querySelector('[data-ai-clip-save]')
    ?.shadowRoot?.querySelector('button');
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  document.title = 'Capture test page';
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  document.body.replaceChildren();
  document.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('floating capture system feedback', () => {
  test('acknowledges one save before requesting one notification and retains inline Saved', async () => {
    const capture = await connectCapture();
    selectText();
    capture.activate();
    capture.activate();
    await vi.waitFor(() => expect(control()?.textContent).toBe('Saved'));
    await vi.waitFor(() =>
      expect(capture.notification.create).toHaveBeenCalledTimes(1),
    );
    expect(capture.respond).toHaveBeenCalledExactlyOnceWith(success);
    expect(capture.respond.mock.invocationCallOrder[0]).toBeLessThan(
      capture.notification.clear.mock.invocationCallOrder[0]!,
    );
    expect(capture.sendNativeMessage).toHaveBeenCalledExactlyOnceWith(
      'com.aiclipmemory.bridge',
      {
        version: 1,
        type: 'capture_clip',
        payload: {
          content: 'notification test selection',
          contentType: 'text',
          sourceApp: 'ChatGPT',
          sourceUrl: 'https://chatgpt.com/c/test',
          sourcePageTitle: 'Capture test page',
        },
      },
    );
    expect(control()?.disabled).toBe(true);
    expect(
      document
        .querySelector('[data-ai-clip-save]')
        ?.shadowRoot?.querySelector('[role=status]')?.textContent,
    ).toBe('Saved locally');
    expect(capture.notification.clear).toHaveBeenCalledExactlyOnceWith(
      CAPTURE_NOTIFICATION_ID,
    );
    expect(capture.notification.create).toHaveBeenCalledWith(
      CAPTURE_NOTIFICATION_ID,
      {
        type: 'basic',
        iconUrl: 'chrome-extension://test-extension/icons/notification.png',
        title: 'Slate',
        message: 'Clip saved locally.',
      },
    );
  });

  test('does not notify while persistence acknowledgement is pending', async () => {
    let acknowledge!: (response: CaptureClipResponse) => void;
    const capture = await connectCapture(
      vi.fn<SendNativeMessage>().mockImplementation(
        () =>
          new Promise((resolve) => {
            acknowledge = resolve;
          }),
      ),
    );
    selectText();
    capture.activate();
    expect(control()?.textContent).toBe('Saving…');
    await vi.advanceTimersByTimeAsync(100);
    expect(capture.respond).not.toHaveBeenCalled();
    expect(capture.notification.clear).not.toHaveBeenCalled();
    expect(capture.notification.create).not.toHaveBeenCalled();
    acknowledge(success);
    await vi.waitFor(() =>
      expect(capture.notification.create).toHaveBeenCalledTimes(1),
    );
    expect(capture.sendNativeMessage).toHaveBeenCalledTimes(1);
  });

  test.each([
    'storage failure',
    'transport failure',
    'malformed acknowledgement',
  ])(
    'keeps existing inline retry feedback and requests no notification after %s',
    async (failure) => {
      const send = vi.fn<SendNativeMessage>();
      if (failure === 'transport failure')
        send.mockRejectedValue(new Error('host unavailable'));
      else
        send.mockResolvedValue(
          failure === 'storage failure'
            ? { version: 1, ok: false, error: 'storage_unavailable' }
            : { ok: true },
        );
      const capture = await connectCapture(send);
      selectText();
      capture.activate();
      await vi.waitFor(() => expect(control()?.textContent).toBe('Retry'));
      expect(capture.respond).toHaveBeenCalledWith(
        expect.objectContaining({ ok: false }),
      );
      expect(capture.notification.clear).not.toHaveBeenCalled();
      expect(capture.notification.create).not.toHaveBeenCalled();
      expect(send).toHaveBeenCalledTimes(1);
    },
  );

  test('notification failure preserves successful inline feedback without retrying persistence', async () => {
    const warning = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    vi.stubEnv('DEV', true);
    const capture = await connectCapture();
    capture.notification.create.mockRejectedValue(
      new Error('sensitive notification error'),
    );
    selectText();
    capture.activate();
    await vi.waitFor(() => expect(control()?.textContent).toBe('Saved'));
    await vi.waitFor(() =>
      expect(warning).toHaveBeenCalledExactlyOnceWith(
        'Slate: Chrome capture notification could not be shown.',
      ),
    );
    capture.activate();
    expect(capture.respond).toHaveBeenCalledExactlyOnceWith(success);
    expect(capture.sendNativeMessage).toHaveBeenCalledTimes(1);
    expect(capture.notification.create).toHaveBeenCalledTimes(1);
    expect(control()?.textContent).toBe('Saved');
    expect(control()?.disabled).toBe(true);
  });

  test('does not wait for a pending notification before delivering inline success', async () => {
    const capture = await connectCapture();
    let finishNotification!: (id: string) => void;
    capture.notification.create.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishNotification = resolve;
        }),
    );
    selectText();
    capture.activate();
    await vi.waitFor(() => expect(control()?.textContent).toBe('Saved'));
    await vi.waitFor(() =>
      expect(capture.notification.create).toHaveBeenCalledTimes(1),
    );
    expect(capture.respond).toHaveBeenCalledExactlyOnceWith(success);
    expect(capture.sendNativeMessage).toHaveBeenCalledTimes(1);
    finishNotification(CAPTURE_NOTIFICATION_ID);
  });

  test('does not log notification-only failures in production', async () => {
    vi.stubEnv('DEV', false);
    const warning = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const capture = await connectCapture();
    capture.notification.create.mockRejectedValue(
      new Error('notification unavailable'),
    );
    selectText();
    capture.activate();
    await vi.waitFor(() => expect(control()?.textContent).toBe('Saved'));
    await vi.waitFor(() =>
      expect(capture.notification.create).toHaveBeenCalledTimes(1),
    );
    await Promise.resolve();
    expect(warning).not.toHaveBeenCalled();
    expect(capture.sendNativeMessage).toHaveBeenCalledTimes(1);
  });

  test('separate identical-content captures each request feedback once using the existing fixed ID', async () => {
    const capture = await connectCapture();
    for (let index = 0; index < 3; index++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      selectText('repeated selection');
      capture.activate();
      await vi.waitFor(() => expect(control()?.textContent).toBe('Saved'));
      await vi.waitFor(() =>
        expect(capture.notification.create).toHaveBeenCalledTimes(index + 1),
      );
    }
    expect(capture.sendNativeMessage).toHaveBeenCalledTimes(3);
    expect(capture.respond).toHaveBeenCalledTimes(3);
    expect(capture.notification.clear).toHaveBeenCalledTimes(3);
    expect(
      capture.notification.create.mock.calls.every(
        ([id]) => id === CAPTURE_NOTIFICATION_ID,
      ),
    ).toBe(true);
  });

  test('still requests feedback for a successful save whose inline control was dismissed', async () => {
    let acknowledge!: (response: CaptureClipResponse) => void;
    const capture = await connectCapture(
      vi.fn<SendNativeMessage>().mockImplementation(
        () =>
          new Promise((resolve) => {
            acknowledge = resolve;
          }),
      ),
    );
    selectText();
    capture.activate();
    window.dispatchEvent(new Event('blur'));
    acknowledge(success);
    await vi.waitFor(() =>
      expect(capture.notification.create).toHaveBeenCalledTimes(1),
    );
    expect(control()).toBeUndefined();
    expect(capture.sendNativeMessage).toHaveBeenCalledTimes(1);
  });

  test('rejects unsupported floating page payloads without sending or notifying', async () => {
    const capture = await connectCapture();
    await expect(
      sendFloatingCaptureMessage({
        type: 'floating_capture',
        payload: {
          content: 'https://chatgpt.com/c/test',
          contentType: 'link',
          sourceApp: 'ChatGPT',
          sourceUrl: 'https://chatgpt.com/c/test',
          sourcePageTitle: 'Capture test page',
        },
      }),
    ).resolves.toEqual({ version: 1, ok: false, error: 'invalid_payload' });
    expect(capture.sendNativeMessage).not.toHaveBeenCalled();
    expect(capture.notification.create).not.toHaveBeenCalled();
  });

  test('right-click selection still acknowledges one save and requests existing feedback exactly once', async () => {
    const capture = await connectCapture();
    capture.click(
      {
        menuItemId: 'save-selection-to-ai-clip-memory',
        editable: false,
        pageUrl: 'https://chatgpt.com/c/test',
        selectionText: 'right-click selection',
      },
      { title: 'Capture test page' } as chrome.tabs.Tab,
    );
    await vi.waitFor(() =>
      expect(capture.notification.create).toHaveBeenCalledTimes(1),
    );
    expect(capture.sendNativeMessage).toHaveBeenCalledTimes(1);
    expect(capture.notification.clear).toHaveBeenCalledExactlyOnceWith(
      CAPTURE_NOTIFICATION_ID,
    );
    expect(capture.notification.create).toHaveBeenCalledWith(
      CAPTURE_NOTIFICATION_ID,
      expect.objectContaining({
        title: 'Slate',
        message: 'Clip saved locally.',
      }),
    );
  });
});
