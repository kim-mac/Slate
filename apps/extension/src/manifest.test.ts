import { describe, expect, test } from 'vitest';
import { createHash, createPublicKey } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

import manifest from '../public/manifest.json';
import * as contextMenus from './contextMenu';

const EXPECTED_CHROME_EXTENSION_ID = 'jjfaegknedfakmidhhdlmbebnjafcjfi';

function paethPredictor(
  left: number,
  above: number,
  upperLeft: number,
): number {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);

  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance)
    return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function rgbaAlphaBounds(png: Buffer) {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  expect(png[24]).toBe(8);
  expect(png[25]).toBe(6);

  const idatChunks: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') {
      idatChunks.push(png.subarray(offset + 8, offset + 8 + length));
    }
    offset += length + 12;
  }

  const bytesPerPixel = 4;
  const rowLength = width * bytesPerPixel;
  const filtered = inflateSync(Buffer.concat(idatChunks));
  const pixels = Buffer.alloc(rowLength * height);

  for (let y = 0; y < height; y += 1) {
    const filter = filtered[y * (rowLength + 1)];
    const sourceOffset = y * (rowLength + 1) + 1;
    const targetOffset = y * rowLength;

    for (let x = 0; x < rowLength; x += 1) {
      const raw = filtered[sourceOffset + x]!;
      const left = x >= bytesPerPixel ? pixels[targetOffset + x - 4]! : 0;
      const above = y > 0 ? pixels[targetOffset + x - rowLength]! : 0;
      const upperLeft =
        y > 0 && x >= bytesPerPixel
          ? pixels[targetOffset + x - rowLength - bytesPerPixel]!
          : 0;
      const reconstructed =
        filter === 0
          ? raw
          : filter === 1
            ? raw + left
            : filter === 2
              ? raw + above
              : filter === 3
                ? raw + Math.floor((left + above) / 2)
                : raw + paethPredictor(left, above, upperLeft);
      pixels[targetOffset + x] = reconstructed & 0xff;
    }
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[y * rowLength + x * bytesPerPixel + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  return { minX, minY, maxX, maxY };
}

function extensionIdFromManifestKey(key: string): string {
  const digest = createHash('sha256')
    .update(Buffer.from(key, 'base64'))
    .digest();
  const alphabet = 'abcdefghijklmnop';

  return [...digest.subarray(0, 16)]
    .flatMap((byte) => [alphabet[byte >> 4], alphabet[byte & 0x0f]])
    .join('');
}

describe('extension manifest', () => {
  test('declares valid packaged Chromium icons at the standard sizes', () => {
    expect(manifest.icons).toEqual({
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png',
    });

    for (const [size, relativePath] of Object.entries(manifest.icons)) {
      const png = readFileSync(
        resolve(import.meta.dirname, '../public', relativePath),
      );
      expect([...png.subarray(0, 8)]).toEqual([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      expect(png.readUInt32BE(16)).toBe(Number(size));
      expect(png.readUInt32BE(20)).toBe(Number(size));
    }
  });

  test('centers the 128 pixel store artwork with 16 pixels of transparent padding', () => {
    const icon = readFileSync(
      resolve(import.meta.dirname, '../public/icons/icon-128.png'),
    );

    expect(rgbaAlphaBounds(icon)).toEqual({
      minX: 16,
      minY: 16,
      maxX: 111,
      maxY: 111,
    });
  });

  test('packages a Chromium-compatible PNG notification icon', () => {
    const icons = resolve(import.meta.dirname, '../public/icons');
    const png = readFileSync(resolve(icons, 'notification.png'));
    expect([...png.subarray(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(existsSync(resolve(icons, 'notification.svg'))).toBe(false);
  });
  test('uses the aligned MVP release version', () => {
    expect(manifest.version).toBe('0.1.0');
  });

  test('has a deterministic unpacked Chrome extension identity', () => {
    expect(typeof manifest.key).toBe('string');
    expect(
      createPublicKey({
        key: Buffer.from(manifest.key, 'base64'),
        format: 'der',
        type: 'spki',
      }).asymmetricKeyType,
    ).toBe('rsa');
    expect(extensionIdFromManifestKey(manifest.key)).toBe(
      EXPECTED_CHROME_EXTENSION_ID,
    );
  });

  test('uses Manifest V3 with only the capture and native messaging permissions', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(new Set(manifest.permissions)).toEqual(
      new Set([
        'activeTab',
        'contextMenus',
        'nativeMessaging',
        'notifications',
      ]),
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
  test('registers independent selection and page actions on HTTP and HTTPS documents', () => {
    expect(contextMenus.CAPTURE_CONTEXT_MENU).toEqual({
      id: 'save-selection-to-ai-clip-memory',
      title: 'Save selection',
      contexts: ['selection'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'],
    });
    expect(
      (contextMenus as Record<string, unknown>).SAVE_PAGE_CONTEXT_MENU,
    ).toEqual({
      id: 'save-page-to-ai-clip-memory',
      title: 'Save this page',
      contexts: ['page', 'selection', 'link', 'image', 'video', 'audio'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'],
    });
  });
});
