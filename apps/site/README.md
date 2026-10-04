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

`src/data/releases.ts` is the only source for release destinations. Windows x64, ARM64, Chrome Web Store and future macOS Apple Silicon all begin unverified with null URLs. macOS is not rendered. Later, verify each actual public HTTPS URL, then explicitly set its state to verified. The shared `downloadUrl()` helper fails closed. Never copy installers into public.

`src/data/site.ts` deliberately has `url: null`. This preview is noindex/nofollow; robots disallows indexing. No canonical, absolute sharing-image URL or sitemap is fabricated. Setting the verified HTTPS production domain enables canonicals, the social image URL, robots' sitemap reference, and a sitemap for /, /privacy/ and /support/. The 404 stays noindex and is excluded. Review these outputs before publication.

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

Views are explicitly labeled illustrations with sample content, not screenshots or interactive app embeds. Decorative controls are excluded from the accessibility tree. Site controls are semantic links/buttons.

The compact page keeps its centered hero and large library/Calendar illustration, followed by Browser Capture, Desktop Capture and Quick Search cards. Browser Capture highlights saving from ChatGPT/Claude without manual copy-pasting. Desktop Capture shows Ctrl+Alt+Shift+C. The browser/Quick Search cards reserve clearly labeled static spaces for real videos supplied later; no video URL or fake playback control is shipped. Merge is not marketed on this homepage. The page does not advertise connectors, agent memory, MCP, Autofill, semantic merging, summaries, cloud sync or macOS as shipping.

The header links to GitHub with a star action. Public GitHub metadata returned 404 during verification, so `src/data/site.ts` leaves `githubStars` null and displays “Star” instead of an invented number. Set a count only after verifying public repository metadata; there is no browser-side API request or new script.

Unmodified asset copies:

- `public/brand/slate-icon.png` from `apps/extension/public/icons/icon-128.png`, retaining its padding.
- `public/favicon.png` from `apps/extension/public/icons/icon-32.png`.

No desktop/extension artwork was edited. [SCREENSHOTS.md](SCREENSHOTS.md) specifies safe real screenshots to replace the illustrations.

## QA

Check widths 1440, 1280, 1024, 768, 430 and 390. Narrow layouts stack the three feature summaries while keeping the GitHub/star link and Download action visible. The single product preview scales without horizontal overflow. Inline navigation works without a hamburger script.

Keyboard-check skip link, GitHub, the download anchor and privacy. Downloads remain intentionally disabled. Focus rings and reduced-motion CSS are included; no essential content relies on motion or JavaScript.

The compact navbar sun/moon button switches the entire site between neutral light and dark themes. First visits use the system preference; explicit choices are saved locally as `slate-site-theme`, separate from desktop preferences. A small local inline controller initializes before paint and still toggles when storage is unavailable. No framework hydration, tracking, or remote script is added. Without JavaScript, content remains available and the inactive toggle is hidden.

Only site files and additive lockfile entries belong in this branch. Do not commit generated output, desktop changes, data or release artifacts.
