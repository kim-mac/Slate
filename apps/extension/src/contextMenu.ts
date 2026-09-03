import { APP_NAME } from '@ai-clip-memory/shared';

export const CAPTURE_CONTEXT_MENU: chrome.contextMenus.CreateProperties = {
  id: 'save-selection-to-ai-clip-memory',
  title: `Save to ${APP_NAME}`,
  contexts: ['selection'],
  documentUrlPatterns: ['http://*/*', 'https://*/*'],
};
