import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { CAPTURE_CONTEXT_MENU } from './contextMenu';
import type { SendNativeMessage } from './bridge';

type ClickListener = (
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab,
) => void;

interface FakeChromeState {
  messageListener?: (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    respond: (response: unknown) => void,
  ) => boolean | undefined;
  clickListener?: ClickListener;
  createdMenu?: chrome.contextMenus.CreateProperties;
  installListener?: () => void;
  removedMenus: boolean;
}

function installFakeChrome(state: FakeChromeState) {
  vi.stubGlobal('chrome', {
    contextMenus: {
      create(properties: chrome.contextMenus.CreateProperties) {
        state.createdMenu = properties;
      },
      onClicked: {
        addListener(listener: ClickListener) {
          state.clickListener = listener;
        },
      },
      removeAll(callback: () => void) {
        state.removedMenus = true;
        callback();
      },
    },
    runtime: {
      id: 'own-id',
      onMessage: {
        addListener(listener: NonNullable<FakeChromeState['messageListener']>) {
          state.messageListener = listener;
        },
      },
      onInstalled: {
        addListener(listener: () => void) {
          state.installListener = listener;
        },
      },
    },
  });
}

describe('Manifest V3 background service worker', () => {
  test('routes internal messages asynchronously and rejects unrelated senders safely', async () => {
    const state: FakeChromeState = { removedMenus: false };
    installFakeChrome(state);
    await import('./background');
    const respond = vi.fn();
    expect(state.messageListener).toBeTypeOf('function');
    expect(
      state.messageListener?.(
        { type: 'floating_capture', payload: {} },
        {},
        respond,
      ),
    ).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(respond).toHaveBeenCalledWith({
      version: 1,
      ok: false,
      error: 'invalid_payload',
    });
    respond.mockClear();
    expect(
      state.messageListener?.({ type: 'unrelated' }, {}, respond),
    ).toBeUndefined();
    expect(respond).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('replaces stale context menus with the capture menu on installation', async () => {
    const state: FakeChromeState = { removedMenus: false };
    installFakeChrome(state);

    await import('./background');
    state.installListener?.();

    expect(state.removedMenus).toBe(true);
    expect(state.createdMenu).toEqual(CAPTURE_CONTEXT_MENU);
    expect(state.clickListener).toBeTypeOf('function');
  });

  test('maps a matching menu click to an ephemeral capture payload', async () => {
    const state: FakeChromeState = { removedMenus: false };
    installFakeChrome(state);
    const { createCapturePayloadFromContextMenu } =
      await import('./background');

    expect(
      createCapturePayloadFromContextMenu(
        {
          menuItemId: CAPTURE_CONTEXT_MENU.id!,
          pageUrl: 'https://chatgpt.com/c/example',
          selectionText: '  exact selection\n',
        },
        { title: 'ChatGPT conversation' },
      ),
    ).toEqual({
      content: '  exact selection\n',
      contentType: 'text',
      sourceApp: 'ChatGPT',
      sourceUrl: 'https://chatgpt.com/c/example',
      sourcePageTitle: 'ChatGPT conversation',
    });
  });

  test('ignores unrelated menu clicks and invalid capture input', async () => {
    const state: FakeChromeState = { removedMenus: false };
    installFakeChrome(state);
    const { createCapturePayloadFromContextMenu } =
      await import('./background');

    expect(
      createCapturePayloadFromContextMenu({
        menuItemId: 'unrelated-menu',
        pageUrl: 'https://example.com/',
        selectionText: 'Selected text',
      }),
    ).toBeNull();
    expect(
      createCapturePayloadFromContextMenu({
        menuItemId: CAPTURE_CONTEXT_MENU.id!,
        pageUrl: 'https://example.com/',
        selectionText: '   ',
      }),
    ).toBeNull();
  });

  test('allows a matching click to omit the tab title', async () => {
    const state: FakeChromeState = { removedMenus: false };
    installFakeChrome(state);
    const { createCapturePayloadFromContextMenu } =
      await import('./background');

    expect(
      createCapturePayloadFromContextMenu({
        menuItemId: CAPTURE_CONTEXT_MENU.id!,
        pageUrl: 'https://example.com/',
        selectionText: 'Selected text',
      }),
    ).toMatchObject({ sourcePageTitle: '' });
  });

  test('sends a valid capture through native messaging exactly once', async () => {
    const state: FakeChromeState = { removedMenus: false };
    installFakeChrome(state);
    const { handleCaptureClick } = await import('./background');
    const sendNativeMessage = vi.fn<SendNativeMessage>().mockResolvedValue({
      version: 1,
      ok: true,
      clipId: 'f7a6c48d-bfd5-4f13-b54d-e238f7cd7842',
    });

    await expect(
      handleCaptureClick(
        {
          menuItemId: CAPTURE_CONTEXT_MENU.id!,
          pageUrl: 'https://chatgpt.com/c/example',
          selectionText: '  exact selection\n',
        },
        { title: 'ChatGPT conversation' },
        sendNativeMessage,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(sendNativeMessage).toHaveBeenCalledTimes(1);
    expect(sendNativeMessage).toHaveBeenCalledWith('com.aiclipmemory.bridge', {
      version: 1,
      type: 'capture_clip',
      payload: {
        content: '  exact selection\n',
        contentType: 'text',
        sourceApp: 'ChatGPT',
        sourceUrl: 'https://chatgpt.com/c/example',
        sourcePageTitle: 'ChatGPT conversation',
      },
    });
  });

  test('does not contact the bridge for invalid capture input', async () => {
    const state: FakeChromeState = { removedMenus: false };
    installFakeChrome(state);
    const { handleCaptureClick } = await import('./background');
    const sendNativeMessage = vi.fn<SendNativeMessage>();

    await expect(
      handleCaptureClick(
        {
          menuItemId: CAPTURE_CONTEXT_MENU.id!,
          pageUrl: 'https://example.com/',
          selectionText: '   ',
        },
        undefined,
        sendNativeMessage,
      ),
    ).resolves.toBeNull();
    expect(sendNativeMessage).not.toHaveBeenCalled();
  });

  test('handles bridge failure without logging or changing the menu', async () => {
    const state: FakeChromeState = { removedMenus: false };
    installFakeChrome(state);
    const { handleCaptureClick } = await import('./background');
    const consoleLog = vi
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const sendNativeMessage = vi
      .fn<SendNativeMessage>()
      .mockRejectedValue(new Error('native host unavailable'));

    await expect(
      handleCaptureClick(
        {
          menuItemId: CAPTURE_CONTEXT_MENU.id!,
          pageUrl: 'https://example.com/',
          selectionText: 'sensitive selection',
        },
        undefined,
        sendNativeMessage,
      ),
    ).resolves.toEqual({
      version: 1,
      ok: false,
      error: 'storage_unavailable',
    });
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(state.createdMenu).toBeUndefined();
  });
});
