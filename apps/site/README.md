# Slate landing page

An independent static Astro site for current Slate 0.1.0 functionality. This is a local preview, not a deployment or an announcement that downloads are available.

## Local development

From the repository root, use the existing pinned pnpm 11.19.0 workflow and Node `^22.13.0 || >=24.0.0` (tested with Node 22.16.0):

```powershell
$env:ASTRO_TELEMETRY_DISABLED = '1'
pnpm install --frozen-lockfile --filter @slate/site --filter ai-clip-memory --ignore-scripts
pnpm --filter @slate/site dev
```

Open <http://127.0.0.1:4321/>. No desktop or extension build is needed. Do not use the root recursive build for site-only work.

Verification:

```powershell
pnpm --filter @slate/site check
pnpm --filter @slate/site lint
pnpm --filter @slate/site format:check
pnpm --filter @slate/site build
pnpm --filter @slate/site test
git diff --check
```

Build before the complete Node test command; it validates generated HTML/CSS as well as release configuration. The configuration tests alone can run before building:

```powershell
pnpm --filter @slate/site exec node --experimental-strip-types --test tests/releases.test.mjs
```

Node 22 labels TypeScript stripping experimental; it is only a test-runner feature, not deployed JavaScript. Generated `.astro`, `dist` and `node_modules` are ignored.

## Dependency boundary

- Astro 7.3.5: the requested static build pipeline; no framework integration, adapter or hydrated component.
- Geist 5.3.0: one self-hosted Latin variable font matching Slate's typography. Its SIL Open Font License is shipped at `/fonts/OFL.txt`.
- Astro check 0.9.10 and TypeScript: Astro/TypeScript validation; TypeScript reuses the workspace catalog.
- eslint-plugin-astro 3.2.1: Astro-aware linting.
- prettier-plugin-astro 1.1.0: Astro formatting.
- @types/node 26.4.1: Node configuration types.

ESLint, Prettier and TypeScript lint support reuse existing root tooling. No animation, icon, UI, state, analytics or browser-testing package is added. Decorative glyphs are small inline SVGs; the Slate mark is the approved raster, not a redrawn logo.

`apps/*` already includes this package: workspace configuration and root manifests are unchanged. The lockfile adds site dependencies while retaining all pre-existing importers, resolutions and snapshots.

Root and site ESLint explicitly set their parser root to their own config directory. Without this tooling-only setting, repository-wide lint discovers both configs and TypeScript's inferred-root heuristic fails before source linting. Existing lint rules remain unchanged.

Astro 7 uses a separate Vite `prerender` environment. Its build-only `cookie` dependency is bundled there so Node cannot resolve an unrelated older CommonJS package in an ancestor node_modules directory. This adds neither browser cookies nor a deployed server.

## Downloads and domain

`src/data/releases.ts` is the only source for release destinations. Windows x64 and ARM64 use verified GitHub Release v0.1.0 installer URLs and retain the frozen SHA-256 hashes. Chrome Web Store and future macOS Apple Silicon remain unverified with null URLs. The hero's Download for Windows action leads to the two architecture-specific downloads; Coming soon for macOS remains a disabled informational button. The Chrome extension is not yet publicly available, and its CWS upload ZIP must not be linked as a manual unpacked installation download. Verify each actual public HTTPS destination before setting its state to verified. The shared `downloadUrl()` helper still fails closed. Never copy installers into public.

`src/data/site.ts` sets the canonical production origin to `https://tryslate.tech`. Canonicals, Open Graph URLs, absolute sharing-image URLs, robots' sitemap reference, and sitemap entries use this apex origin for /, /privacy/ and /support/. These three public routes are indexable; the 404 stays noindex and is excluded. Privacy/support navigation remains relative to the current origin. An explicitly unset or invalid origin still fails closed in the metadata helpers.

Cloudflare Pages preview deployments receive Cloudflare's `X-Robots-Tag: noindex` response header; their URLs must never replace the canonical production origin. If `www.tryslate.tech` is used, configure its redirect to `https://tryslate.tech` in Cloudflare, preserving paths and query strings. No repository or DNS changes are needed for the site to use apex canonicals. Domain configuration does not enable any download destination or imply Chrome Web Store publication.

Routes: /, /privacy/, /support/, and /404.html (also shown for missing pages). Support uses the existing repository link because public Issues availability has not been verified; no support email is invented.

`public/brand/social-preview.png` is a site-owned 1200×630 card, using the unchanged approved raster master and “Your memory, outside the tab.” It is not a product screenshot or Chrome Web Store promo asset. Its optional renderer is `node scripts/render-social-preview.mjs`, using Astro's existing Sharp dependency. Normal builds do not regenerate it.

The limited privacy page describes current plaintext local storage, user-initiated capture, clipboard behavior and uninstall retention. It does not claim encryption or broad legal guarantees. Reconfirm hosting-specific details before publication.

## Future Cloudflare Pages setup

No Cloudflare project or DNS change is made by this implementation.

| Setting                   | Value                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| Root                      | Repository root                                                                                           |
| Install                   | `pnpm install --frozen-lockfile --filter @slate/site --filter ai-clip-memory --ignore-scripts`            |
| Build                     | `pnpm --filter @slate/site build`                                                                         |
| Output                    | `apps/site/dist`                                                                                          |
| Node                      | 22.16.0 tested; must satisfy the package engine                                                           |
| pnpm                      | 11.19.0, pinned in the root manifest                                                                      |
| Runtime variables/secrets | None                                                                                                      |
| Build variables           | `NODE_VERSION=22.16.0`, `PNPM_VERSION=11.19.0`, `SKIP_DEPENDENCY_INSTALL=1`, `ASTRO_TELEMETRY_DISABLED=1` |

Cloudflare Pages provides one build-command field, not a separate custom install field. With automatic installation skipped, use this combined command:

```sh
pnpm install --frozen-lockfile --filter @slate/site --filter ai-clip-memory --ignore-scripts && pnpm --filter @slate/site build
```

These settings follow Cloudflare's [build image](https://developers.cloudflare.com/pages/configuration/build-image/) and [build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/) documentation. The scoped install/build commands are verified locally; no Cloudflare deployment has been tested or performed. Do not use CF_PAGES_URL as the canonical production domain. No runtime variables or secrets are required.

Ensure the build image uses pinned pnpm; don't let automatic installation/building include unrelated workspace apps. `_headers` provides static security headers. No Workers, functions, auth, database or runtime service is needed.

## Product visuals

The hero is an HTML product illustration containing sample content, not a real screenshot or interactive app embed. Its accessible figure description identifies it as such; the approved design has no visible illustration/sample-content caption. Decorative controls are excluded from the accessibility tree. Site controls are semantic links/buttons.

The compact page keeps its centered hero and large library/Calendar illustration, followed by Browser Capture, Desktop Capture and Quick Search cards. Browser Capture highlights saving from ChatGPT/Claude without manual copy-pasting. Desktop Capture shows Ctrl+Alt+Shift+C. The browser/Quick Search cards reserve clearly labeled static spaces for real videos supplied later; no video URL or fake playback control is shipped. Merge is not marketed on this homepage. The page does not advertise connectors, agent memory, MCP, Autofill, semantic merging, summaries, cloud sync or macOS as shipping.

The header's GitHub link displays Star on GitHub, retaining its icon and new-tab behavior. `src/data/site.ts` leaves `githubStars` null; the current design does not display a star count. There is no browser-side API request or invented number.

Unmodified asset copies:

- `public/brand/slate-icon.png` from `apps/extension/public/icons/icon-128.png`, retaining its padding.
- `public/favicon.png` from `apps/extension/public/icons/icon-32.png`.

No desktop/extension artwork was edited. [SCREENSHOTS.md](SCREENSHOTS.md) specifies safe real screenshots to replace the illustrations.

## QA

Check widths 1440, 1280, 1024, 768, 430 and 390. Narrow layouts stack the three feature summaries while keeping the GitHub/star link and Download action visible. The single product preview scales without horizontal overflow. Inline navigation works without a hamburger script.

Keyboard-check skip link, GitHub, the download anchor, both Windows installer links and privacy. Chrome and macOS remain intentionally disabled. Focus rings and reduced-motion CSS are included; no essential content relies on motion or JavaScript.

The compact navbar sun/moon button switches the entire site between neutral light and dark themes. First visits use the system preference; explicit choices are saved locally as `slate-site-theme`, separate from desktop preferences. A small local inline controller initializes before paint and still toggles when storage is unavailable. No framework hydration, tracking, or remote script is added. Without JavaScript, content remains available and the inactive toggle is hidden.

Only site files and additive lockfile entries belong in this branch. Do not commit generated output, desktop changes, data or release artifacts.
