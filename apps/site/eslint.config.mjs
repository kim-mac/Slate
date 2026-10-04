import eslint from '@eslint/js';
import astro from 'eslint-plugin-astro';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['dist/**', '.astro/**', 'node_modules/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
  { files: ['src/**/*.astro'], languageOptions: { globals: globals.browser } },
  prettier,
];
