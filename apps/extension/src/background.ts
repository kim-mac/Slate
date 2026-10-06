import type {
  BrowserCapturePayload,
  CaptureClipResponse,
} from '@ai-clip-memory/shared';

import { sendCaptureToDesktop, type SendNativeMessage } from './bridge';
import {
  createCapturePayload,
  createPageCapturePayload,
  type BrowserCaptureInput,
} from './capture';
import { CAPTURE_CONTEXT_MENU, SAVE_PAGE_CONTEXT_MENU } from './contextMenu';
import {
  FLOATING_CAPTURE_MESSAGE,
  handleFloatingCapture,
} from './captureMessage';
import { notifyCaptureResult } from './contextMenuFeedback';

function reportNotificationFailure(): void {
  if (import.meta.env.DEV)
    console.warn('Slate: Chrome capture notification could not be shown.');
}

type CaptureClickInfo = Pick<
  chrome.contextMenus.OnClickData,
  'menuItemId' | 'pageUrl' | 'selectionText' | 'linkUrl' | 'frameUrl'
>;
type CaptureTab = Pick<chrome.tabs.Tab, 'title' | 'url'>;

export function createCapturePayloadFromContextMenu(
  info: CaptureClickInfo,
  tab?: CaptureTab,
): BrowserCapturePayload | null {
  if (info.menuItemId === SAVE_PAGE_CONTEXT_MENU.id) {
    return createPageCapturePayload({
      ...(tab?.url === undefined ? {} : { tabUrl: tab.url }),
      ...(info.pageUrl === undefined ? {} : { pageUrl: info.pageUrl }),
      ...(tab?.title === undefined ? {} : { pageTitle: tab.title }),
    });
  }
  if (info.menuItemId !== CAPTURE_CONTEXT_MENU.id) return null;

  const input: BrowserCaptureInput = {};
  if (info.selectionText !== undefined) {
    input.selectionText = info.selectionText;
  }
  if (info.pageUrl !== undefined) input.pageUrl = info.pageUrl;
  if (tab?.title !== undefined) input.pageTitle = tab.title;
  return createCapturePayload(input);
}

export async function handleCaptureClick(
  info: CaptureClickInfo,
  tab?: CaptureTab,
  sendNativeMessage?: SendNativeMessage,
): Promise<CaptureClipResponse | null> {
  const payload = createCapturePayloadFromContextMenu(info, tab);
  if (payload === null) return null;

  return sendCaptureToDesktop(payload, sendNativeMessage);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create(CAPTURE_CONTEXT_MENU);
    chrome.contextMenus.create(SAVE_PAGE_CONTEXT_MENU);
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const captureKind =
    info.menuItemId === SAVE_PAGE_CONTEXT_MENU.id ? 'page' : 'selection';
  void handleCaptureClick(info, tab).then((result) => {
    const feedbackResult =
      result ??
      (captureKind === 'page'
        ? ({ version: 1, ok: false, error: 'invalid_payload' } as const)
        : null);
    if (feedbackResult)
      void notifyCaptureResult(
        feedbackResult,
        (id, options) => chrome.notifications.create(id, options),
        chrome.runtime.getURL('icons/notification.png'),
        (id) => chrome.notifications.clear(id),
        captureKind,
      ).catch(reportNotificationFailure);
  });
});

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (
    typeof message !== 'object' ||
    message === null ||
    !('type' in message) ||
    message.type !== FLOATING_CAPTURE_MESSAGE
  )
    return;
  void handleFloatingCapture(message, sender, chrome.runtime.id).then(
    (result) => {
      // Deliver inline feedback independently of notification availability.
      respond(result);
      if (result.ok)
        void notifyCaptureResult(
          result,
          (id, options) => chrome.notifications.create(id, options),
          chrome.runtime.getURL('icons/notification.png'),
          (id) => chrome.notifications.clear(id),
        ).catch(reportNotificationFailure);
    },
    () => respond({ version: 1, ok: false, error: 'invalid_payload' }),
  );
  return true;
});
