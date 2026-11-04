# Slate landing page

An independent static Astro site for Slate. The public Windows desktop release is v0.3.2 for x64 and ARM64, and the published Chrome extension is v0.1.2. macOS is coming soon. Download destinations and current versions come from `src/data/releases.ts`; website development does not publish a desktop or extension release. Production deployment requires separate approval.

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

`apps/*` already includes this package and its dependencies are already locked. This website revision changes neither workspace configuration, root manifests nor the lockfile.

Root and site ESLint explicitly set their parser root to their own config directory. Without this tooling-only setting, repository-wide lint discovers both configs and TypeScript's inferred-root heuristic fails before source linting. Existing lint rules remain unchanged.

Astro 7 uses a separate Vite `prerender` environment. Its build-only `cookie` dependency is bundled there so Node cannot resolve an unrelated older CommonJS package in an ancestor node_modules directory. This adds neither browser cookies nor a deployed server.

## Downloads and domain

`src/data/releases.ts` is the source of truth for site release versions and download destinations. The Windows x64 and ARM64 installers and checksums point to the published v0.3.2 GitHub release. The homepage, Windows guide and Support link to the [published Chrome extension](https://chromewebstore.google.com/detail/slate/hgbfaclkpmcecikjepoejgjccddjbekh). Browser capture requires Slate Desktop. macOS is in development and has no public download. The shared `downloadUrl()` helper only enables verified HTTPS destinations. Never copy installers or the Chrome Web Store upload package into public assets.

The homepage’s `#download` section has two equal-width cards: Slate for Windows and Chrome Extension. Its Windows CTA, like the unchanged hero CTA, opens `/download/windows/?start=1`. Architecture-specific installers, checksum details and Copy controls belong only on the dedicated guide. The compact Chrome card notes the desktop-app requirement. Homepage cards need no download-controller script; the guide retains its progressive enhancement, and Astro may inline that module when it no longer shares code with another page.

The homepage FAQ follows Get Slate and uses native named `details` elements: one answer can be open at a time in current browsers, including without JavaScript. Older browsers without named-disclosure grouping may allow multiple answers to stay open; the answers remain accessible. Enter/Space toggle a focused summary, and reduced-motion preferences disable the optional CSS animation. Answers describe the shipped Windows app, optional extension, offline library, no-account workflow and unencrypted local storage, not planned features.

Homepage download buttons use decorative Windows and Apple SVG paths from [Bootstrap Icons v1.13.1](https://github.com/twbs/icons/tree/v1.13.1), with its MIT license shipped at `/licenses/bootstrap-icons-LICENSE.txt`. No icon dependency is added. Both marks inherit button text color; macOS remains disabled with no download URL.

The homepage’s primary Download for Windows action opens `/download/windows/?start=1`. The guide consumes the exact, single `start=1` opt-in with `history.replaceState` before asynchronous detection, preserving other query values, the fragment and history state. It requests an installer once only when Client Hints explicitly identify 64-bit Windows x86 or ARM. Missing, ambiguous, denied, 32-bit or non-Windows hints leave manual downloads available; x64 is never guessed. A manual installer click or a hidden page cancels pending automatic initiation. Refreshing the consumed URL and visiting the guide directly do not initiate a download. Browsers may block requests; the status reports a request, never download completion or installer execution.

The guide is a compact confirmation screen: a short hero and four illustration-led steps in one equal-width row at desktop widths (1024px and up), wrapping to two columns on tablet and stacking on mobile. The fourth step links to the official Chrome extension as an optional companion to Slate Desktop. Pastel illustration surfaces adapt to light/dark themes. Only this route opts out of the shared footer; the navbar and other pages’ footers remain unchanged. A native, initially closed “Downloads & verification” disclosure contains only the architecture choices and installer cards with full hashes and Copy controls. The prominent hero fallback opens it and cancels pending automatic initiation. Its fragment targets content inside the disclosure so native browser navigation can reveal it without JavaScript too.

The guide keeps both immutable architecture links and complete hashes in no-JavaScript HTML. `WindowsDownloadOptions.astro` renders its installer cards; `windowsDownloadGuide.ts` shares the existing recommendation detection result and checksum-copy behavior. The hero says “Your download should start automatically” only after an explicit opt-in with successful architecture detection and a request attempt; direct visits, denied/ambiguous detection and failures ask the user to choose manually. Four original SVG illustrations have accessible illustration labels without repetitive visible captions. Step 2 uses the short, unlinked protection-warning wording and conditions Run anyway on trusting the installer. The former verification tutorial and resource links have been removed, not relocated.

`src/data/site.ts` sets the canonical production origin to `https://tryslate.tech`. Canonicals, Open Graph URLs, absolute sharing-image URLs, robots' sitemap reference, and sitemap entries use this apex origin for /, /privacy/, /support/ and /download/windows/. These four public routes are indexable; the 404 stays noindex and is excluded. Privacy/support navigation remains relative to the current origin. An explicitly unset or invalid origin still fails closed in the metadata helpers.

Cloudflare Pages preview deployments receive Cloudflare's `X-Robots-Tag: noindex` response header; their URLs must never replace the canonical production origin. If `www.tryslate.tech` is used, configure its redirect to `https://tryslate.tech` in Cloudflare, preserving paths and query strings. No repository or DNS changes are needed for the site to use apex canonicals. Domain configuration does not enable any download destination or imply Chrome Web Store publication.

Routes: /, /privacy/, /support/, /download/windows/, and /404.html (also shown for missing pages). Support’s installation link opens the guide without an automatic-download flag. Support uses the existing repository link because public Issues availability has not been verified; no support email is invented.

`public/brand/social-preview.png` is a site-owned 1200×630 card, using the unchanged approved raster master and “Your memory, outside the tab.” It is not a product screenshot or Chrome Web Store promo asset. Its optional renderer is `node scripts/render-social-preview.mjs`, using Astro's existing Sharp dependency. Normal builds do not regenerate it.

The limited privacy page describes current plaintext local storage, user-initiated capture, clipboard behavior and uninstall retention. It does not claim encryption or broad legal guarantees. Reconfirm hosting-specific details before publication.

## Cloudflare Pages build settings

No Cloudflare project, deployment or DNS change is made by this preparation. Verify the existing project's actual production branch, connected repository, build settings and deployment method before approving a push or deployment; they are not defined in this repository. Do not switch the site's production branch to the desktop release branch or merge all desktop work merely to deploy this site.

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

These settings follow Cloudflare's [build image](https://developers.cloudflare.com/pages/configuration/build-image/) and [build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/) documentation. The scoped install/build commands are verified locally. Do not use CF_PAGES_URL as the canonical production domain. No runtime variables or secrets are required.

Ensure the build image uses pinned pnpm; don't let automatic installation/building include unrelated workspace apps. `_headers` provides static security headers. No Workers, functions, auth, database or runtime service is needed.

## Production desktop update manifest

The permanent endpoint is `https://tryslate.tech/updates/windows/latest.json`.
Astro copies `public/updates/windows/latest.json` byte-for-byte into `dist`.
The production manifest serves v0.3.2 with version-specific GitHub URLs and
updater signatures for `windows-x86_64` and `windows-aarch64`.

`public/_headers` sets the JSON content type and `Cache-Control: no-store`.
A missing manifest must return 404. Keep the manifest and the exact
byte-preservation tests with subsequent website builds. Website-only changes
must preserve the live manifest bytes. The offline validator at
`scripts/windows/validate-desktop-update-release.mjs` checks the release
contract. Schema tests alone do not authenticate installers or their signed
versions. Keep installers, signing keys and private URLs out of public assets.

### Deployment approval gate and rollback

Before any Git operation, confirm the live Pages project's production branch and
automatic-deployment controls. Prefer a reviewed site-only commit/PR onto that
existing branch; preserve the manifest, `_headers`, website tests and their offline
validator dependency. Pushing a production branch may itself trigger deployment and needs
explicit deployment approval. Do not introduce a second hosting pipeline.

After an approved deployment, verify the exact live manifest bytes, JSON content
type, `Cache-Control: no-store`, absence of challenges/redirects, both download
links, privacy and support. Rebuild from that same reconciled source to prove the
manifest remains present on future deployments. Archive the approved static bundle
and record the prior production deployment before release.

For a website-only regression, restore a verified Pages production deployment or
revert only the site changes after approval. A rollback to a deployment without a
manifest makes update checks fail safely; it does not downgrade or uninstall Slate.
Do not alter immutable GitHub assets or advertise a lower application version as
an update. A faulty desktop release requires a separately approved higher-version
fix, not replacement of immutable release assets. Restoring a previous manifest
cannot revoke an offer/download retained by a running client or reverse an
installation or schema migration. See the preparation documents below.

### Release and recovery records

- [Published v0.3.2 Windows release](https://github.com/kim-mac/Slate/releases/tag/v0.3.2).
- [Historical v0.3.1 activation checklist](../../docs/releases/v0.3.1/ACTIVATION-CHECKLIST.md).
- [Database backup procedure and recovery limits](../../docs/releases/v0.3.1/MIGRATION-BACKUP.md).

## Product visuals

The hero is an HTML product illustration containing sample content, not a real screenshot or interactive app embed. Its accessible figure description identifies it as such; the approved design has no visible illustration/sample-content caption. Decorative controls are excluded from the accessibility tree. Site controls are semantic links/buttons.

The compact page keeps its centered hero and large library/Calendar illustration, followed by Browser Capture, Desktop Capture and Quick Search cards. Browser Capture highlights saving from ChatGPT/Claude without manual copy-pasting. Desktop Capture shows Ctrl+Alt+Shift+C. The three feature cards use original HTML/CSS demonstrations, with coordinated playback, pause controls and static reduced-motion fallbacks; no video URL or video placeholder is shipped. The hero's four static Slate miniatures and three original concept tiles are decorative and hide progressively at narrower widths. Merge is not marketed on this homepage. The page does not advertise connectors, agent memory, MCP, Autofill, semantic merging, summaries, cloud sync or macOS as shipping.

The header's GitHub link displays Star on GitHub, retaining its icon and new-tab behavior alongside the theme toggle and home link. The navbar’s redundant Download CTA is removed. `src/data/site.ts` leaves `githubStars` null; the current design does not display a star count. There is no browser-side API request or invented number.

Unmodified asset copies:

- `public/brand/slate-icon.png` from `apps/extension/public/icons/icon-128.png`, retaining its padding.
- `public/favicon.png` from `apps/extension/public/icons/icon-32.png`.

No desktop/extension artwork was edited. [SCREENSHOTS.md](SCREENSHOTS.md) records an earlier proposed media handoff, including former video placeholders; it does not describe the current feature demonstrations. [IMPLEMENTATION.md](IMPLEMENTATION.md) preserves historical implementation and validation observations. This README describes the current website.

## QA

Check widths 1920, 1440, 1280, 1024, 768, 390 and 320. Narrow layouts reflow the three feature summaries and four installation cards while keeping the GitHub/star link and theme toggle visible. The single product preview scales without horizontal overflow. Inline navigation works without a hamburger script.

Keyboard-check skip link, GitHub, the Windows guide CTA, both Windows installer links on the dedicated guide, checksum expansion/copy, Add to Chrome, the Support store link and privacy. Test the guide’s direct visit and opt-in separately; never launch an installer for website QA. macOS remains intentionally disabled. Focus rings and reduced-motion CSS are included; no essential content relies on motion or JavaScript.

The compact navbar sun/moon button switches the entire site between neutral light and dark themes. First visits use the system preference; explicit choices are saved locally as `slate-site-theme`, separate from desktop preferences. A small local inline controller initializes before paint and still toggles when storage is unavailable. No framework hydration is added. Without JavaScript, content remains available and the inactive toggle is hidden.

## Hosting analytics

Cloudflare Web Analytics is enabled separately through the existing hosting configuration. Its hosting-injected beacon measures website traffic and performance without analytics cookies; the privacy page discloses this separately from Slate's local clip storage. Local static builds do not include the hosting-injected beacon. No application-managed analytics SDK, consent banner, conversion tracking, or visitor identifier is included in this site. No analytics environment variable is required. Theme preference storage remains unchanged.

Keep the existing Cloudflare Web Analytics configuration intact. Normal site-only builds and tests must not add a replacement tracker, manually insert a second beacon, or change hosting settings.

Only site files belong in this revision; no dependency or lockfile changes are needed. Do not commit generated output, desktop changes, data or release artifacts.
