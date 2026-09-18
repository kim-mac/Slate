export const CAPTURE_CONTEXT_MENU: chrome.contextMenus.CreateProperties = {
  id: 'save-selection-to-ai-clip-memory',
  title: 'Save selection',
  contexts: ['selection'],
  documentUrlPatterns: ['http://*/*', 'https://*/*'],
};

export const SAVE_PAGE_CONTEXT_MENU: chrome.contextMenus.CreateProperties = {
  id: 'save-page-to-ai-clip-memory',
  title: 'Save this page',
  contexts: ['page', 'selection', 'link', 'image', 'video', 'audio'],
  documentUrlPatterns: ['http://*/*', 'https://*/*'],
};
