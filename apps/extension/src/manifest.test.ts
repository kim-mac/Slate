import { describe, expect, test } from 'vitest';

import manifest from '../public/manifest.json';
import { CAPTURE_CONTEXT_MENU } from './contextMenu';

describe('extension manifest', () => {
  test('uses Manifest V3 with only the capture and native messaging permissions', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(new Set(manifest.permissions)).toEqual(
      new Set(['activeTab', 'contextMenus', 'nativeMessaging']),
    );
  });

  test('does not request persistent host or unrelated privileged access', () => {
    expect(manifest).not.toHaveProperty('host_permissions');
    expect(manifest).not.toHaveProperty('action');
    expect(manifest).not.toHaveProperty('web_accessible_resources');
    expect(manifest).toHaveProperty('content_scripts', [
      {
        matches: [
          'https://chatgpt.com/*',
          'https://chat.openai.com/*',
          'https://claude.ai/*',
          'https://gemini.google.com/*',
        ],
        js: ['content.js'],
        run_at: 'document_idle',
        all_frames: false,
        world: 'ISOLATED',
      },
    ]);

    const permissions = new Set<string>(manifest.permissions);
    for (const forbiddenPermission of [
      'storage',
      'tabs',
      'scripting',
      'clipboardRead',
      'clipboardWrite',
    ]) {
      expect(permissions.has(forbiddenPermission)).toBe(false);
    }
  });
});

describe('capture context menu', () => {
  test('is limited to selections on HTTP and HTTPS documents', () => {
    expect(CAPTURE_CONTEXT_MENU).toEqual({
      id: 'save-selection-to-ai-clip-memory',
      title: 'Save to AI Clip Memory',
      contexts: ['selection'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'],
    });
  });
});
