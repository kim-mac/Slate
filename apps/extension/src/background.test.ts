import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { CAPTURE_CONTEXT_MENU } from './contextMenu';

type ClickListener = (
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab,
) => void;

interface FakeChromeState {
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
      onInstalled: {
        addListener(listener: () => void) {
          state.installListener = listener;
        },
      },
    },
  });
}

describe('Manifest V3 background service worker', () => {
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
});
