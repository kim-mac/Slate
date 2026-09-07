import type {
  BrowserCapturePayload,
  CaptureClipResponse,
} from '@ai-clip-memory/shared';

import { sendCaptureToDesktop, type SendNativeMessage } from './bridge';
import { createCapturePayload, type BrowserCaptureInput } from './capture';
import { CAPTURE_CONTEXT_MENU } from './contextMenu';
import {
  FLOATING_CAPTURE_MESSAGE,
  handleFloatingCapture,
} from './captureMessage';
import { notifyCaptureResult } from './contextMenuFeedback';

type CaptureClickInfo = Pick<
  chrome.contextMenus.OnClickData,
  'menuItemId' | 'pageUrl' | 'selectionText'
>;
type CaptureTab = Pick<chrome.tabs.Tab, 'title'>;

export function createCapturePayloadFromContextMenu(
  info: CaptureClickInfo,
  tab?: CaptureTab,
): BrowserCapturePayload | null {
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
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void handleCaptureClick(info, tab).then((result) => {
    if (result)
      void notifyCaptureResult(
        result,
        (id, options) => chrome.notifications.create(id, options),
        chrome.runtime.getURL('icons/notification.png'),
        (id) => chrome.notifications.clear(id),
      ).catch(() => undefined);
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
    respond,
    () => respond({ version: 1, ok: false, error: 'invalid_payload' }),
  );
  return true;
});
