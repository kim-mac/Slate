# Milestone 8 implementation plan

**Goal:** Add explicit floating Save on the four approved AI sites.
**Architecture:** Isolated selection/controller, internal validated message,
existing service-worker native bridge. No privileged or desktop changes.
**Tech stack:** Existing TypeScript/Vite/Vitest; jsdom development-only DOM tests.

Execute inline with test-driven-development and executing-plans. Do not commit.

1. Install frozen dependencies and run existing extension baseline.
2. Add captureMessage.test.ts: call handleFloatingCapture(message, sender, id,
   sendNativeMessage); expect one existing native request for valid payloads,
   safe failure and zero calls for wrong sender/frame/host/origin/shape/source,
   blank content and oversized UTF-8 JSON. Run focused test red, then implement
   captureMessage.ts and rerun green.
3. Add selection.test.ts with actual DOM ranges and mocked geometry only.
   readSelection(document) must preserve text, reject editable/blank selections;
   placeSaveControl(rect, viewport, size) must keep the control in bounds.
   Run red, implement selection.ts, rerun green.
4. Add floatingSave.test.ts: installFloatingSave(document, send, style) returns
   cleanup; real selection/pointer/keyboard events drive the DOM. Assert zero
   sends before trusted activation, dismissal, composition/drag exclusions,
   saving guard, safe retry, stale completion, cleanup and scoped styles.
   Run red, implement controller/CSS/content.ts, rerun green. Mock only browser
   trust at the native event boundary in DOM tests; manually verify real input.
5. Extend background wiring and manifest tests first, run red. Add internal
   listener using async sendResponse with return true, preserve existing menu.
   Add exactly four static matches at document_idle/top frame/isolated world.
6. Add a separate classic-script Vite build and contentBuild.test.ts to verify
   emitted output is self-contained and no native messaging enters content code.
   Add DOM TypeScript types and extension jsdom 30.0.1 dev dependency only.
7. Update README; run pnpm format, format:check, lint, typecheck, test,
   build:extension, build:desktop, build:bridge, check:rust and desktop
   tauri:build; git diff --check. Audit protected paths unchanged.
8. Verify real Chrome/Edge supported pages, multiline/edges/zoom/scroll/SPAs,
   keyboard/IME/editable/repeat/dismiss, success/failure/retry, both themes,
   context-menu fallback and native save -> desktop Refresh. Ask user to perform
   inaccessible browser checks. Clean only authorized synthetic artifacts.

Expected modifications: README.md, pnpm-lock.yaml; extension package.json,
tsconfig.json, public/manifest.json, src/background.ts, background.test.ts,
manifest.test.ts. New files: vite.content.config.ts; src/content.ts,
floatingSave.ts/test.ts/css, selection.ts/test.ts, captureMessage.ts/test.ts,
contentBuild.test.ts; this plan and the corresponding design spec.

## Verification notes

- Baseline: 48 existing extension tests passed before implementation.
- Test-first boundary, selection, controller, worker wiring and built-script
  checks reached 114 passing extension tests.
- Temporary headless Edge fixture used only locally fulfilled synthetic pages,
  the compiled content.js and a fake extension transport. Trusted mouse clicks,
  Enter/Space, exact multiline preservation, zero pre-save transport, viewport
  bounds including feedback, safe retry, light/dark, Escape, SPA pushState and
  scrolling passed. This is not a real unpacked-extension/native-host test.
- Regression fixes: queued selection event replacing Saved feedback; isolated
  system font overridden by host reset; feedback growth near viewport edge;
  keyboard focus entering editable areas. Failing checks preceded fixes.
- Fixture browser closes in finally; its temporary script was removed. No real
  clip, browser registration, listener/server or persistent browser profile was
  created. Real authenticated-site and native end-to-end checks remain manual.
- Focused read-only code review found no critical/important issues. Its minor
  Select All keyboard gap was reproduced test-first and fixed without cancelling
  the browser gesture. The Vite build integration test now has a per-test 30s
  timeout after the default 5s timed out during concurrent native compilation.
- Final full workspace run: 114 extension, 56 desktop and 49 Rust tests passed.
  Formatting/check, ESLint, workspace TypeScript, extension build, desktop
  frontend build, Cargo check, native-host build, Tauri release build (no bundle)
  and git diff --check passed. Protected desktop/shared/bridge files unchanged.
- Unpacked-extension checks on actual ChatGPT/Claude/Gemini/legacy OpenAI,
  browser zoom, and floating Save -> native host -> SQLite -> desktop Refresh
  were completed by the user. ChatGPT, Claude and Gemini floating Save passed;
  chat.openai.com redirected to chatgpt.com. Other Web context-menu fallback,
  exact text/metadata after desktop Refresh, multiline and viewport-edge
  selection, scroll/zoom/SPA dismissal and recreation, editable exclusion,
  repeat activation, Escape/click-away dismissal, both themes, and failure ->
  Retry -> Saved passed. Real-site keyboard activation was not completed because
  normal Tab traversal visits the site's many controls; trusted Enter/Space was
  covered by the compiled Edge fixture and Ctrl+A by unit tests. IME composition
  and visibility during the active drag were automated only. The user removed the verification clips,
  unregistered the temporary Chrome host, and confirmed both its HKCU key and
  generated native-host manifest were absent (`False`, `False`). The unpacked
  extension remains loaded by choice; no temporary registration remains.
