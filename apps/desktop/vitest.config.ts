import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(currentDirectory, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    maxWorkers: 4,
    setupFiles: ['./src/test/setup.ts'],
  },
});
