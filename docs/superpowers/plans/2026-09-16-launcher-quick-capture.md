# Launcher Quick Capture and Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add compact create and edit workflows to Quick Search while keeping the launcher visible across focus loss and making Ctrl+Shift+Space show or focus it.

**Architecture:** `LauncherSession` retains clip retrieval, selection, persistence calls, mode transitions, and feedback. A focused `LauncherClipEditor` owns only draft content, content type, automatic URL classification, validation, and editor controls. Existing `ClipClient` create/update commands are reused; Rust changes are limited to launcher lifecycle policy and Windows focus-loss handling.

**Tech Stack:** React 19, TypeScript, Vitest, shadcn/Base UI primitives, Tauri 2, Rust.

---

### Task 1: Pure URL classification and compact editor state

**Files:**
- Create: `apps/desktop/src/launcher/launcherClipClassification.ts`
- Create: `apps/desktop/src/launcher/launcherClipClassification.test.ts`
- Create: `apps/desktop/src/launcher/LauncherClipEditor.tsx`
- Create: `apps/desktop/src/launcher/LauncherClipEditor.test.tsx`

- [ ] Write failing tests for single HTTP/HTTPS URL classification, whitespace/multiple-value rejection, exact content preservation, automatic Text/Link changes, manual override, edit initialization, blank validation, UTF-8 size validation, multiline input, Ctrl/Cmd+Enter, IME, Cancel, pending-save deduplication, and safe failure draft preservation.
- [ ] Run the focused tests and confirm they fail because the helper/component does not exist.
- [ ] Implement the pure classifier and compact editor using existing Button, Select, Textarea, content types, formatting, and size validation.
- [ ] Run focused tests until green, then refactor without changing behavior.

### Task 2: Launcher create/edit integration

**Files:**
- Modify: `apps/desktop/src/launcher/Launcher.tsx`
- Modify: `apps/desktop/src/launcher/Launcher.test.tsx`
- Modify: `apps/desktop/src/launcher/launcher.css`
- Modify: `apps/desktop/src/launcher/launcherCss.test.ts`

- [ ] Write failing launcher tests for New, Edit, latest-metadata merge, missing clip, successful immediate result replacement/selection, Saved feedback, safe failure, Escape mode behavior, focus persistence, and unchanged Search copy behavior.
- [ ] Run focused launcher tests and confirm expected failures.
- [ ] Expand the injected launcher client to existing `list`, `copyContent`, `create`, and `update`; add the discriminated search/create/edit mode and mode-aware focus callback.
- [ ] On create, submit null hidden metadata and update local results from the returned clip.
- [ ] On edit, re-list immediately before update and merge current hidden metadata into the full replacement input.
- [ ] Return successful saves to Search with empty query, selected saved clip, and Saved feedback; keep failed drafts mounted.
- [ ] Add only compact bounded editor styling and verify no native scrollbar or 640x420 overflow regression.
- [ ] Run focused launcher/editor tests until green.

### Task 3: Native launcher lifecycle presentation

**Files:**
- Modify: `apps/desktop/src-tauri/src/launcher.rs`
- Modify: `apps/desktop/src-tauri/src/platform/windows.rs`

- [ ] Write failing Rust policy tests proving hidden shortcut opens, visible shortcut refocuses the same session, repeat latch remains, early readiness remains, and stale session protection remains.
- [ ] Add a static/integration assertion proving the Windows focus-loss event no longer dismisses while CloseRequested still does.
- [ ] Run focused Rust tests and confirm expected failures.
- [ ] Keep the shortcut policy show/focus-only and remove only `WindowEvent::Focused(false)` dismissal.
- [ ] Run focused Rust tests until green.

### Task 4: Narrow launcher permissions

**Files:**
- Modify: `apps/desktop/src-tauri/capabilities/launcher.json`
- Modify: `apps/desktop/src-tauri/tests/launcher_permissions.rs`

- [ ] Update the exact permission regression test first to require existing `allow-create-clip` and `allow-update-clip`, with no other additions.
- [ ] Run the capability test and confirm it fails against current configuration.
- [ ] Add only those two permissions and rerun the capability test.

### Task 5: Full verification and manual handoff

**Files:**
- Review all files above and this plan; do not commit.

- [ ] Run focused editor and launcher React tests.
- [ ] Run all desktop React tests.
- [ ] Run workspace TypeScript typecheck, ESLint, and Prettier.
- [ ] Run focused launcher/capability Rust tests, complete Rust tests, `cargo fmt --check`, and `cargo check`.
- [ ] Run the desktop production frontend build and `git diff --check`.
- [ ] Confirm extension/shared code, schema, commands, ClipService, repository, dependencies, and lockfiles remain unchanged.
- [ ] Provide exact Windows manual checks for create, URL detection, manual override, focus persistence, edit/metadata preservation, shortcut show/focus, Escape, retrieval/copy, Open Tin/X, themes, and 640x420 layout.

### Task 6: Selected-result edit affordance

**Files:**
- Modify: `apps/desktop/src/launcher/Launcher.tsx`
- Modify: `apps/desktop/src/launcher/Launcher.test.tsx`
- Modify: `apps/desktop/src/launcher/launcher.css`

- [ ] Add a failing launcher test that selects a result and asserts one icon-only `Edit selected clip` control appears inside a dedicated title row, while unselected results contain no Edit control.
- [ ] Add a failing assertion that clicking the pencil does not call `copyContent` or change selection, and still opens the existing Edit mode.
- [ ] Run `pnpm --filter @ai-clip-memory/desktop exec vitest run src/launcher/Launcher.test.tsx` and confirm the new structure assertion fails against the bottom Edit placement.
- [ ] Move the existing ghost `Button` into a flex title row beside the bold heading, retain `size="icon-sm"`, add the existing Tooltip with `Edit clip`, and keep mouse/click propagation stopped.
- [ ] Remove the old bottom Edit button and `.launcher-edit` margin rule, then rerun the focused launcher tests until green.
- [ ] Run the full desktop React suite, workspace typecheck, ESLint, Prettier, desktop frontend build, and `git diff --check`; do not commit or push.

### Task 7: Show-or-focus launcher shortcut

**Files:**
- Modify: `apps/desktop/src-tauri/src/launcher.rs`

- [ ] Replace the toggle expectation with a failing policy test proving a released second shortcut press keeps the visible snapshot and session unchanged.
- [ ] Retain assertions that a hidden launcher opens a new session, repeated pressed events are ignored, and early activation waits for frontend readiness.
- [ ] Run the focused launcher policy test and confirm it fails because the current policy hides an already-visible launcher.
- [ ] Change only `LauncherPolicy::shortcut` so a valid press opens a hidden launcher or returns the current visible snapshot for presentation/focus.
- [ ] Run focused launcher tests, the full Rust/integration suite, Rust formatting, Cargo check, desktop React tests, workspace typecheck, ESLint, Prettier, desktop frontend build, and `git diff --check`; do not commit or push.
