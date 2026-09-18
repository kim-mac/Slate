import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { CAPTURE_CONTEXT_MENU, SAVE_PAGE_CONTEXT_MENU } from './contextMenu';
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
  createdMenus?: chrome.contextMenus.CreateProperties[];
  installListener?: () => void;
  removedMenus: boolean;
  menuEvents?: string[];
  clearedNotifications?: string[];
  notifications?: Array<{
    id: string;
    options: chrome.notifications.NotificationCreateOptions;
  }>;
}

function installFakeChrome(state: FakeChromeState) {
  vi.stubGlobal('chrome', {
    notifications: {
      clear(id: string) {
        state.clearedNotifications ??= [];
        state.clearedNotifications.push(id);
        return Promise.resolve(true);
      },
      create(
        id: string,
        options: chrome.notifications.NotificationCreateOptions,
      ) {
        state.notifications ??= [];
        state.notifications.push({ id, options });
        return Promise.resolve(id);
      },
    },
    contextMenus: {
      create(properties: chrome.contextMenus.CreateProperties) {
        state.menuEvents ??= [];
        state.menuEvents.push(`create:${String(properties.id)}`);
        state.createdMenus ??= [];
        state.createdMenus.push(properties);
      },
      onClicked: {
        addListener(listener: ClickListener) {
          state.clickListener = listener;
        },
      },
      removeAll(callback: () => void) {
        state.menuEvents ??= [];
        state.menuEvents.push('removeAll');
        state.removedMenus = true;
        callback();
      },
    },
    runtime: {
      id: 'own-id',
      getURL(path: string) {
        return `chrome-extension://own-id/${path}`;
      },
      sendNativeMessage() {
        return Promise.resolve({
          version: 1,
          ok: true,
          clipId: 'f7a6c48d-bfd5-4f13-b54d-e238f7cd7842',
        });
      },
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

  test('replaces stale context menus with independent selection and page actions', async () => {
    const state: FakeChromeState = { removedMenus: false };
    installFakeChrome(state);

    await import('./background');
    state.installListener?.();

    expect(state.removedMenus).toBe(true);
    expect(state.createdMenus).toEqual([
      CAPTURE_CONTEXT_MENU,
      SAVE_PAGE_CONTEXT_MENU,
    ]);
    expect(state.menuEvents).toEqual([
      'removeAll',
      'create:save-selection-to-ai-clip-memory',
      'create:save-page-to-ai-clip-memory',
    ]);
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

  test('maps a page action to an exact Link capture without requiring a selection', async () => {
    const state: FakeChromeState = { removedMenus: false };
    installFakeChrome(state);
    const { createCapturePayloadFromContextMenu } =
      await import('./background');

    expect(
      createCapturePayloadFromContextMenu(
        {
          menuItemId: SAVE_PAGE_CONTEXT_MENU.id!,
          pageUrl: 'https://example.com/path?one=two#three',
          selectionText: 'must be ignored',
          linkUrl: 'https://different.example/link',
          frameUrl: 'https://different.example/frame',
        },
        {
          url: 'https://example.com/path?one=two#three',
          title: 'Exact page title',
        },
      ),
    ).toEqual({
      content: 'https://example.com/path?one=two#three',
      contentType: 'link',
      sourceApp: 'Other Web',
      sourceUrl: 'https://example.com/path?one=two#three',
      sourcePageTitle: 'Exact page title',
    });
  });

  test('rejects stale or unsupported page actions before contacting the bridge', async () => {
    const state: FakeChromeState = { removedMenus: false };
    installFakeChrome(state);
    const { handleCaptureClick } = await import('./background');
    const sendNativeMessage = vi.fn<SendNativeMessage>();

    await expect(
      handleCaptureClick(
        {
          menuItemId: SAVE_PAGE_CONTEXT_MENU.id!,
          pageUrl: 'https://example.com/old',
        },
        { url: 'https://example.com/new', title: 'Page' },
        sendNativeMessage,
      ),
    ).resolves.toBeNull();
    await expect(
      handleCaptureClick(
        { menuItemId: SAVE_PAGE_CONTEXT_MENU.id! },
        { url: 'chrome://extensions/', title: 'Extensions' },
        sendNativeMessage,
      ),
    ).resolves.toBeNull();
    expect(sendNativeMessage).not.toHaveBeenCalled();
  });

  test('sends a valid page action through native messaging exactly once', async () => {
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
          menuItemId: SAVE_PAGE_CONTEXT_MENU.id!,
          pageUrl: 'https://claude.ai/chat/example',
        },
        { url: 'https://claude.ai/chat/example', title: 'Claude chat' },
        sendNativeMessage,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(sendNativeMessage).toHaveBeenCalledTimes(1);
    expect(sendNativeMessage).toHaveBeenCalledWith('com.aiclipmemory.bridge', {
      version: 1,
      type: 'capture_clip',
      payload: {
        content: 'https://claude.ai/chat/example',
        contentType: 'link',
        sourceApp: 'Claude',
        sourceUrl: 'https://claude.ai/chat/example',
        sourcePageTitle: 'Claude chat',
      },
    });
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

  test('shows content-free feedback after a context-menu capture', async () => {
    const state: FakeChromeState = { removedMenus: false };
    installFakeChrome(state);
    await import('./background');
    state.clickListener?.(
      {
        menuItemId: CAPTURE_CONTEXT_MENU.id!,
        pageUrl: 'https://example.com/',
        selectionText: 'private selected text',
      } as chrome.contextMenus.OnClickData,
      { title: 'Private title' } as chrome.tabs.Tab,
    );
    await vi.waitFor(() => expect(state.notifications).toHaveLength(1));
    expect(state.clearedNotifications).toEqual([
      'ai-clip-memory-capture-result',
    ]);
    expect(JSON.stringify(state.notifications)).not.toContain('private');
    expect(state.notifications?.[0]?.options.message).toBe(
      'Clip saved locally.',
    );
    expect(state.notifications?.[0]?.options.iconUrl).toBe(
      'chrome-extension://own-id/icons/notification.png',
    );
  });

  test('shows generic content-free feedback when a page action is rejected locally', async () => {
    const state: FakeChromeState = { removedMenus: false };
    installFakeChrome(state);
    await import('./background');
    state.clickListener?.(
      {
        menuItemId: SAVE_PAGE_CONTEXT_MENU.id!,
        pageUrl: 'https://example.com/stale-private-path',
      } as chrome.contextMenus.OnClickData,
      {
        url: 'https://example.com/current-private-path',
        title: 'Private title',
      } as chrome.tabs.Tab,
    );
    await vi.waitFor(() => expect(state.notifications).toHaveLength(1));
    expect(state.notifications?.[0]?.options.message).toBe(
      'Could not save this page.',
    );
    expect(JSON.stringify(state.notifications)).not.toContain('private');
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
    expect(state.createdMenus).toBeUndefined();
  });
});
