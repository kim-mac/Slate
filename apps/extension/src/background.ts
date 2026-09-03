import type { BrowserCapturePayload } from '@ai-clip-memory/shared';

import { createCapturePayload, type BrowserCaptureInput } from './capture';
import { CAPTURE_CONTEXT_MENU } from './contextMenu';

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

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create(CAPTURE_CONTEXT_MENU);
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  createCapturePayloadFromContextMenu(info, tab);
});
