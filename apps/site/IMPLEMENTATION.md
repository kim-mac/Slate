# Slate landing page: first implementation

## Launch-readiness pass: 2026-10-04

Approved scope: preserve the current homepage, preview, theme and navbar. Reuse the Privacy page layout for concise Support and a minimal 404. Keep downloads manually selected and unavailable until verified. Add desktop/extension pairing guidance, shared version display, domain-conditional metadata/sitemap and one static social card. No application, extension, installer, release-file or dependency changes.

Execution:

- [x] Inspect feature/primary Git state and baseline frozen artifact hashes.
- [x] Verify Privacy claims against extension capture, native host, clipboard, SQLite and uninstall source; preserve meaning and single-color heading.
- [x] Run the existing 23 tests, then add six readiness tests and observe their expected failures before implementation.
- [x] Add Support/404, footer link, concise pairing guidance and centralized Privacy version.
- [x] Add conditional sitemap/robots and social metadata, retaining an unset domain and noindex preview.
- [x] Render a site-owned 1200×630 social PNG using the unchanged approved Slate master; no fabricated product imagery.
- [x] Document scoped Cloudflare Pages commands and explicit build-tool/environment versions.
- [x] Run fresh site/workspace verification, browser/accessibility/responsive/theme QA, and compare frozen hashes.
- [x] Leave the local preview running for user review, with all changes uncommitted.

Results: 29/29 site tests; Astro check across 24 files with zero errors/warnings/hints; site ESLint, repository-wide ESLint, Prettier and static production build pass. Built HTML validates all four routes, internal links/assets, safe external tabs, one theme controller, disabled unverified downloads, metadata and the conditional sitemap.

Browser QA: /, /privacy/, /support/ and /404.html at 1440, 1280, 1024, 768, 430 and 390 in both themes (48 layout checks). No horizontal overflow, navbar overlaps or broken images. Final-state text contrast checks pass in both themes; decorative preview and disabled controls are excluded from text-contrast assertions. Theme choice survives navigation/reload; keyboard toggle, visible focus, skip-link main focus and Download navigation work. Reduced-motion CSS disables animation/smooth scrolling; the system preference was not changed. Built-output console has no warnings/errors.

Workspace limitation: the optional root recursive typecheck cannot finish because the isolated site-only installation has no extension node_modules/@types/chrome. Site typecheck and root lint pass. No application dependencies were repaired or application source changed to hide this unrelated environment limitation.

Primary main remains clean at the base SHA. All four frozen release files match their preflight sizes and SHA-256 hashes. No commit, staging, push, deployment, publication or application/release build occurred. Preview: http://127.0.0.1:4321/; built static preview: http://127.0.0.1:4322/.

Base: `6c72584e5996aeca47760de3393a62f8f87b6088`. Branch: `codex/slate-landing-page`.

The approved design is a static Astro site with Geist typography, neutral tokens derived from Slate, clearly labeled illustrative product states, and disabled release actions until canonical URLs are verified. No desktop components, persistence, extension, or release tooling are imported.

## Execution plan

- [x] Test fail-closed release destinations with Node's test runner before implementation.
- [x] Add the site package, static configuration, independent tooling and centralized metadata.
- [x] Build navigation, hero, capture, Quick Search, groups, local-first, workflows, downloads and footer.
- [x] Add responsive styles, accessible controls and reduced-motion-safe CSS. Preserve content without JavaScript.
- [x] Add privacy, deployment and manual screenshot documentation.
- [x] Run check, lint, format, tests and build; inspect local browser layouts at six widths.
- [x] Verify primary main and all four frozen artifact hashes unchanged. Leave changes uncommitted.

Scope is `apps/site`, additive dependency entries in `pnpm-lock.yaml`, and the demonstrated necessary root ESLint parser-root setting for multi-config workspace integration. No application/release tooling or user-data operation is part of this work.

## Original implementation verification

- Astro check: 23 files, zero errors/warnings/hints.
- Site lint and repository-wide lint: pass.
- Site formatting and root ESLint-config formatting: pass.
- Static build: two HTML pages plus robots and local assets; zero scripts in production.
- Node tests: 13/13 pass.
- Browser: six requested widths, no horizontal overflow/broken images; desktop/mobile screenshots reviewed.
- Keyboard: visible focus, working skip link, navigation, privacy and download anchor.
- Reduced motion: production CSS disables animation/smooth scrolling for the reduced-motion preference. The system preference itself was not changed.
- Production browser: no warning/error console entries.
- Primary main and frozen release files: unchanged. No staging, commits, pushes or deployment.

Real screenshots, verified download URLs and a chosen public domain remain review/pre-launch inputs, not fabricated substitutes.

## Approved compact redesign: 2026-10-02

Goal: reduce reading effort using the supplied reference's centered hierarchy and whitespace, keeping Slate's neutral palette and truthful release state.

Plan (inline execution; no commits or deployment):

- [x] Replace the output hierarchy test and add a navbar/GitHub regression test; run against the previous output and confirm failure.
- [x] Center the hero around “Keep what matters. Find it again.”, one sentence, Windows/GitHub actions and one existing product illustration. Preserve its sample-content disclosure.
- [x] Replace the five long workflow sections with one three-column feature summary: Capture, Quick Search, Merge. Preserve original-record group semantics.
- [x] Simplify header, footer and download copy. Keep architecture-specific release actions disabled until verified; no invented GitHub count. Public GitHub metadata returned 404, so use the honest Star action fallback.
- [x] Replace obsolete layout CSS/components, leaving privacy content and original color tokens intact; make mobile navigation and preview fit without overflow.
- [x] Run fresh check, lint, format, build and output/release tests; inspect desktop/mobile and keyboard navigation.
- [x] Recheck primary main and frozen release hashes. Leave all landing-page work unstaged and uncommitted.

Files: site components/pages/styles, centralized site metadata, site output tests, and site README/implementation notes only. No dependency, application, installer or release-artifact edits are needed for this redesign.

Compact redesign verification: Astro check 19 files with zero errors/warnings/hints; site lint, repository-wide lint, Prettier, build, all 14 Node tests, and diff checks passed. Six responsive widths have no horizontal overflow or broken images; GitHub remains visible. Skip link, Download anchor and privacy navigation passed; browser warnings/errors were empty. Primary main and all four frozen release hashes remain unchanged. Work is unstaged/uncommitted; preview runs locally only.

## Approved light/dark theme: 2026-10-02

Design: a compact sun/moon navbar button, system preference on first visit, a site-local saved override, and neutral dark surfaces across both pages and the illustrative preview. Initialize before paint to avoid a light flash. Preserve all content without JavaScript; hide the inactive toggle then. No desktop or release changes, dependencies, commits, or deployment.

Implementation plan (inline execution):

- [x] Add built-output and actual-script behavioral tests covering saved/system preference, toggle persistence, inaccessible storage, accessible labels and both-page presence. Run `pnpm --filter @slate/site test` and verify the missing controller fails.
- [x] Add one local inline theme controller in BaseLayout, a Header button and sun/moon vector paths in Icon. Use `slate-site-theme` rather than desktop storage. Update the no-script assertion to permit exactly that controller and no remote scripts or hydration.
- [x] Add dark tokens and replace hardcoded light illustration colors with corresponding semantic tokens. Keep the light palette. Fit the navbar on narrow screens and preserve focus/reduced-motion behavior.
- [x] Run site format, check, lint, build and tests. Inspect toggling/reload/privacy and desktop/mobile layouts in both themes. Verify primary main and release artifact hashes remain unchanged; leave work uncommitted.

Verification: 17/17 tests, Astro check (zero errors/warnings/hints), ESLint, Prettier and two-page static build passed. Keyboard toggle, saved choice after reload and Privacy navigation passed. Both themes have zero horizontal overflow at 320/390/768/1024/1440px. Primary main remains clean at the same base, and all four frozen release file hashes match the prior baseline.

## Capture-first feature cards

Approved scope: keep the hero and large preview unchanged. Replace only the three feature cards with Browser Capture (ChatGPT/Claude and no manual copy-pasting), Desktop Capture (Ctrl+Alt+Shift+C) and Quick Search (Ctrl+Shift+Space). Reserve two clearly labeled static video placeholders; the user will supply recordings later. No dummy video URLs or playback controls.

Plan: update output assertions and observe failure against the old cards; replace Features.astro and feature-only CSS; update the site media handoff; run format, Astro check, lint, build and output tests; inspect desktop/mobile and confirm primary main/release hashes unchanged. Leave everything uncommitted.

## Approved faithful Calendar preview: 2026-10-02

Goal: remove em dashes from all website copy and tab metadata, and represent the real Slate main window rather than combining Calendar and detail views. Keep the neutral palette, static sample-content disclosure and existing feature cards. No application imports, personal data, dependencies, commits or deployment.

Architecture: static Astro markup, site-local SVG icons and responsive CSS. Match AppSidebar, the main search/New clip header and MemoryCalendar: expandable Library sections, nested title/preview rows, Local only/Settings footer, controls on the left and date on the right, Sunday-first 42-cell month with compact clip labels and actions. Omit the synthetic selected-clip pane. Treat the illustration as one image-like figure; internal controls are noninteractive.

Inline implementation plan (executing-plans and test-first verification):

- [x] Add built-output tests for dash-free HTML/tab metadata and the actual sidebar/42-cell Sunday-first Calendar structure; run `pnpm --filter @slate/site test` against existing output and confirm both fail.
- [x] Update site.ts, Header.astro and privacy.astro copy. Replace Hero.astro sample data and markup; add only the needed site-local vector paths in Icon.astro. Replace preview-only global.css rules and corresponding responsive overrides, retaining theme tokens and all surrounding page layout.
- [x] Run site format, check, lint, build, tests, format:check and git diff --check. Inspect light/dark desktop and mobile preview; save screenshots. Recheck primary main and release artifact hashes. Leave everything unstaged and uncommitted.

Verification: both new tests failed against the prior build and all 23 passed after implementation. Astro check had zero errors/warnings/hints; ESLint, Prettier and the two-page static build passed. Browser checks confirmed dash-free homepage and Privacy titles/copy, 42 calendar cells and no page/toolbar/calendar-heading overflow at 320/390/768/1024/1440px in both themes. Light/dark preview screenshots retain the sample-content label. Primary main and the four frozen release artifact hashes are unchanged. No staging, commits, pushes or deployment.
