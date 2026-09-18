# Save This Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Chromium context-menu action that saves the current top-level HTTP/HTTPS page as a normal local Link clip through the existing Native Messaging pipeline.

**Architecture:** Register independent selection and page context-menu actions in the MV3 service worker. Build a page payload from the top-level tab URL and title, send the existing version-1 `capture_clip` envelope, and widen only the existing payload content type plus native boundary validation needed to map a link into `ClipService.create()`.

**Tech Stack:** TypeScript, Chrome MV3 APIs, Vitest, Rust, serde/serde_json, url, rusqlite integration tests.

---

### Task 1: Context-menu registrations and page payload

**Files:**
- Modify: `apps/extension/src/contextMenu.ts`
- Modify: `apps/extension/src/capture.ts`
- Modify: `apps/extension/src/manifest.test.ts`
- Modify: `apps/extension/src/capture.test.ts`

- [ ] Add failing tests for the exact `Save selection` and `Save this page` registrations, approved contexts, HTTP/HTTPS patterns, and unchanged permission/content-script declarations.
- [ ] Add failing tests for a pure page payload builder covering HTTP/HTTPS, exact URL/query/fragment/title preservation, missing title, source classification, credentials, unsupported schemes, top-level URL preference, fallback, mismatch rejection, and ignored frame/link URLs.
- [ ] Run the focused tests and confirm failures are caused by the missing second menu and page builder.
- [ ] Add the two menu constants and minimal page payload builder using the existing source classifier and shared URL parsing helper.
- [ ] Re-run focused tests until green without changing the manifest.

### Task 2: Background routing and feedback

**Files:**
- Modify: `apps/extension/src/background.ts`
- Modify: `apps/extension/src/background.test.ts`
- Modify: `apps/extension/src/contextMenuFeedback.ts`
- Modify: `apps/extension/src/contextMenuFeedback.test.ts`

- [ ] Add failing tests proving `removeAll()` precedes both registrations, selection routes to the existing text builder, page routes without a selection, page ignores selection/link/frame values, invalid page input never contacts Native Messaging, and each valid click sends exactly once.
- [ ] Add failing feedback tests that preserve existing selection messages and use content-free page failure wording.
- [ ] Run focused tests and confirm the routing/feedback failures.
- [ ] Dispatch by exact menu ID, pass `tab.url` and `tab.title` only to the page builder, register both menus after `removeAll()`, and pass a capture kind into the existing notification helper.
- [ ] Re-run focused tests until green.

### Task 3: Shared contract and version-1 bridge compatibility

**Files:**
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/extension/src/bridge.test.ts`

- [ ] Add a failing bridge test showing a link payload uses the unchanged `{version: 1, type: "capture_clip", payload}` envelope.
- [ ] Widen `BrowserCapturePayload.contentType` from `"text"` to `"text" | "link"` without adding fields or changing protocol types.
- [ ] Run shared typecheck and focused bridge tests until green.

### Task 4: Native link validation and mapping

**Files:**
- Modify: `apps/desktop/src-tauri/src/bridge/protocol.rs`
- Modify: `apps/desktop/src-tauri/tests/native_messaging_bridge.rs`

- [ ] Add failing protocol tests for valid link mapping, exact title/source metadata, blank-title normalization, mismatch rejection, HTTP/HTTPS-only validation, credential rejection, and unchanged text behavior.
- [ ] Add a failing real-file persistence test proving the native host stores a normal Link clip through the existing `ClipService` and SQLite path.
- [ ] Run the focused Rust tests and confirm they fail because `link` is currently rejected.
- [ ] Accept `text` and `link`; retain the existing text mapping; for links validate exact content/source URL equality, scheme, host, and absent credentials, then derive `title` from nonblank `sourcePageTitle`.
- [ ] Re-run focused Rust tests until green and retain the existing 1 MiB framing tests unchanged.

### Task 5: Full verification and scope audit

**Files:**
- Verify all files above; do not modify manifest permissions, content scripts, persistence layers, Tauri commands, or lockfiles.

- [ ] Run focused extension tests and complete extension suite.
- [ ] Run shared/workspace typecheck, ESLint, Prettier, Rust formatting, focused native tests, and the complete Rust/integration suite.
- [ ] Build the production extension, desktop frontend, and native host; run Cargo check and `git diff --check`.
- [ ] Inspect the final manifest and diff for exact permissions, unchanged content-script matches, no new dependencies, no schema/service/repository changes, and no sensitive logging.
- [ ] Report automated results and provide manual Chrome and Edge verification steps without committing, pushing, creating a PR, or building an installer.
