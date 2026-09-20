import { describe, expect, test } from 'vitest';
import { createHash, createPublicKey } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

import manifest from '../public/manifest.json';
import * as contextMenus from './contextMenu';

const EXPECTED_CHROME_EXTENSION_ID = 'jjfaegknedfakmidhhdlmbebnjafcjfi';
const APPROVED_ICON_HASHES = {
  'icon-16.png':
    'b466c041952280848792826782a56e01822c11044b3ab372cce58f5a371f4c08',
  'icon-32.png':
    '4a6e7515edb84b0b9905cd5a7bdeaa2894b4e31f2640733cf67cb6a9c33b6816',
  'icon-48.png':
    '7d08da2101df9a712f14ff421e378dcf338c4accb6c51366dd2ee6c24d574164',
  'icon-128.png':
    '7994ab5f9e0c62acb5364c9b548461aec5c1ab77dbd5965d425e38cb99302847',
  'notification.png':
    '7994ab5f9e0c62acb5364c9b548461aec5c1ab77dbd5965d425e38cb99302847',
} as const;

const APPROVED_WINDOWS_FRAME_HASHES = {
  16: APPROVED_ICON_HASHES['icon-16.png'],
  20: '27996f5447747c3d8ab61e415af7a25ebcc5fbb7fb37a7fd9379ade6fd1bb5af',
  24: '3d4c25efafc89053e0bf0c0af711e98f873756dfdd24a08af6a0450b162f5939',
  32: APPROVED_ICON_HASHES['icon-32.png'],
  48: APPROVED_ICON_HASHES['icon-48.png'],
  64: '356f5935d7e82d1a95203fad7151e4cba4d275d1eeaa9409d1c07dc0bd85ac57',
  256: '7925d6e54a702474533efc6fa4957ec5524625e1abfe940cbbb52ad8773e2cbe',
} as const;

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

function decodeRgbaPng(png: Buffer) {
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

  return { width, height, pixels };
}

function rgbaAt(
  decoded: ReturnType<typeof decodeRgbaPng>,
  x: number,
  y: number,
) {
  const offset = (y * decoded.width + x) * 4;
  return {
    red: decoded.pixels[offset]!,
    green: decoded.pixels[offset + 1]!,
    blue: decoded.pixels[offset + 2]!,
    alpha: decoded.pixels[offset + 3]!,
  };
}

function rgbaAlphaBounds(png: Buffer) {
  const decoded = decodeRgbaPng(png);
  let minX = decoded.width;
  let minY = decoded.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < decoded.height; y += 1) {
    for (let x = 0; x < decoded.width; x += 1) {
      if (rgbaAt(decoded, x, y).alpha === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  return { minX, minY, maxX, maxY };
}

function expectOpaqueWhite(pixel: ReturnType<typeof rgbaAt>) {
  expect(pixel.alpha).toBe(255);
  expect(pixel.red).toBeGreaterThanOrEqual(245);
  expect(pixel.green).toBeGreaterThanOrEqual(245);
  expect(pixel.blue).toBeGreaterThanOrEqual(245);
}

function expectOpaqueBlack(pixel: ReturnType<typeof rgbaAt>) {
  expect(pixel.alpha).toBe(255);
  expect(pixel.red).toBeLessThanOrEqual(5);
  expect(pixel.green).toBeLessThanOrEqual(5);
  expect(pixel.blue).toBeLessThanOrEqual(5);
}

function icoPngFrames(ico: Buffer) {
  expect(ico.readUInt16LE(0)).toBe(0);
  expect(ico.readUInt16LE(2)).toBe(1);
  const frames = new Map<number, Buffer>();

  for (let index = 0; index < ico.readUInt16LE(4); index += 1) {
    const entryOffset = 6 + index * 16;
    const size = ico[entryOffset] === 0 ? 256 : ico[entryOffset]!;
    const byteLength = ico.readUInt32LE(entryOffset + 8);
    const imageOffset = ico.readUInt32LE(entryOffset + 12);
    frames.set(size, ico.subarray(imageOffset, imageOffset + byteLength));
  }

  return frames;
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

  test('locks the corrected Slate Chromium icon assets', () => {
    const icons = resolve(import.meta.dirname, '../public/icons');

    for (const [filename, expectedHash] of Object.entries(
      APPROVED_ICON_HASHES,
    )) {
      const digest = createHash('sha256')
        .update(readFileSync(resolve(icons, filename)))
        .digest('hex');
      expect(digest).toBe(expectedHash);
    }
  });

  test('renders the approved master with an opaque white S on opaque black', () => {
    const master = decodeRgbaPng(
      readFileSync(
        resolve(
          import.meta.dirname,
          '../../../assets/brand/slate-icon-master-1024.png',
        ),
      ),
    );

    expectOpaqueWhite(rgbaAt(master, 512, 200));
    expectOpaqueBlack(rgbaAt(master, 100, 512));
    expect(rgbaAt(master, 0, 0).alpha).toBe(0);
  });

  test('keeps opaque white and black logo interiors at every Chromium size', () => {
    const icons = resolve(import.meta.dirname, '../public/icons');
    const samples = {
      'icon-16.png': { s: [8, 4], background: [3, 3] },
      'icon-32.png': { s: [16, 8], background: [6, 6] },
      'icon-48.png': { s: [24, 12], background: [9, 9] },
      'icon-128.png': { s: [64, 35], background: [35, 35] },
      'notification.png': { s: [64, 35], background: [35, 35] },
    } as const;

    for (const [filename, sample] of Object.entries(samples)) {
      const decoded = decodeRgbaPng(readFileSync(resolve(icons, filename)));
      expectOpaqueWhite(rgbaAt(decoded, sample.s[0], sample.s[1]));
      expectOpaqueBlack(
        rgbaAt(decoded, sample.background[0], sample.background[1]),
      );
      expect(rgbaAt(decoded, 0, 0).alpha).toBe(0);
    }
  });

  test('keeps opaque white and black logo interiors in every Windows icon frame', () => {
    const ico = readFileSync(
      resolve(import.meta.dirname, '../../desktop/src-tauri/icons/icon.ico'),
    );
    const frames = icoPngFrames(ico);
    expect([...frames.keys()]).toEqual([32, 16, 20, 24, 48, 64, 256]);

    for (const [size, png] of frames) {
      const decoded = decodeRgbaPng(png);
      const sX = Math.round(size * 0.5);
      const sY = Math.round((size * 200) / 1024);
      const backgroundX = Math.max(1, Math.round((size * 100) / 1024));
      const backgroundY = Math.round(size * 0.5);

      expectOpaqueWhite(rgbaAt(decoded, sX, sY));
      expectOpaqueBlack(rgbaAt(decoded, backgroundX, backgroundY));
      expect(rgbaAt(decoded, 0, 0).alpha).toBe(0);
    }
  });

  test('uses genuine approved native rasters for every Windows icon frame', () => {
    const ico = readFileSync(
      resolve(import.meta.dirname, '../../desktop/src-tauri/icons/icon.ico'),
    );
    const frames = icoPngFrames(ico);

    for (const [size, expectedHash] of Object.entries(
      APPROVED_WINDOWS_FRAME_HASHES,
    )) {
      const frame = frames.get(Number(size));
      expect(frame, `missing ${size}x${size} Windows frame`).toBeDefined();
      expect(createHash('sha256').update(frame!).digest('hex')).toBe(
        expectedHash,
      );
      expect(frame!.readUInt32BE(16)).toBe(Number(size));
      expect(frame!.readUInt32BE(20)).toBe(Number(size));
    }
  });

  test('keeps the store and notification artwork inside the approved safe area', () => {
    const icons = resolve(import.meta.dirname, '../public/icons');

    for (const filename of ['icon-128.png', 'notification.png']) {
      expect(rgbaAlphaBounds(readFileSync(resolve(icons, filename)))).toEqual({
        minX: 16,
        minY: 16,
        maxX: 111,
        maxY: 111,
      });
    }
  });

  test('packages a Chromium-compatible PNG notification icon', () => {
    const icons = resolve(import.meta.dirname, '../public/icons');
    const png = readFileSync(resolve(icons, 'notification.png'));
    expect([...png.subarray(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(png.readUInt32BE(16)).toBe(128);
    expect(png.readUInt32BE(20)).toBe(128);
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
