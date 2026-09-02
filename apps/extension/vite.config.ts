import { resolve } from 'node:path';

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(import.meta.dirname, 'src/background.ts'),
      output: {
        entryFileNames: 'background.js',
      },
    },
  },
});
