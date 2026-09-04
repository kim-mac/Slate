import { describe, expect, test } from 'vitest';
import { build } from 'vite';
import { resolve } from 'node:path';

describe('classic content script build', () => {
  test('bundles a standalone script without native access or remote resources', async () => {
    const result = await build({
      configFile: resolve(import.meta.dirname, '../vite.content.config.ts'),
      build: { write: false },
    });
    const outputs = (Array.isArray(result) ? result : [result]).flatMap(
      (item) => ('output' in item ? item.output : []),
    );
    const chunk = outputs.find(
      (item) => item.type === 'chunk' && item.fileName === 'content.js',
    );
    expect(chunk?.type).toBe('chunk');
    if (chunk?.type !== 'chunk') throw new Error('Missing content script');
    expect(chunk.imports).toEqual([]);
    expect(chunk.dynamicImports).toEqual([]);
    expect(chunk.code).not.toMatch(
      /sendNativeMessage|com\.aiclipmemory\.bridge|console\.|localStorage|sessionStorage|fetch\(|XMLHttpRequest|WebSocket/,
    );
    expect(chunk.code).toContain('sendMessage');
    expect(chunk.code).toContain('prefers-color-scheme');
  }, 30_000);
});
