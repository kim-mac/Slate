import { defineConfig } from 'astro/config';
import { site } from './src/data/site.ts';

export default defineConfig({
  output: 'static',
  site: site.url ?? undefined,
  trailingSlash: 'always',
  devToolbar: { enabled: false },
  // Keep prerendering independent of unrelated ancestor node_modules/cookie packages.
  // This is build-time bundling only; the output remains static and uses no cookies.
  vite: {
    environments: { prerender: { resolve: { noExternal: ['cookie'] } } },
  },
});
