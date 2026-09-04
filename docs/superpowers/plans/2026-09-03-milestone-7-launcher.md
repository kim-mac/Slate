# Milestone 7 implementation plan

**Goal:** Global invocation of a local quick-search-and-copy window.

**Architecture:** Windows adapter -> Rust lifecycle controller -> launcher UI
-> existing ClipClient list/copy -> existing ClipService/SQLite.

**Tech stack:** Existing React/shadcn/Vitest/Tauri, Rust global-shortcut plugin.

1. Install locked dependencies and run the unchanged baseline.
2. Write failing launcher/client tests: readiness subscription cleanup, reset on
   new session, repeat activation, focus, M6 search/order, arrow selection,
   exact-ID copy, repeat/IME guards, Escape, errors/retry and stale completions.
3. Implement src/launcher/{Launcher.tsx,launcherClient.ts,main.tsx,launcher.css}
   with injected list/copy and lifecycle clients. Add launcher.html and the Vite
   multi-page input. Reuse retrieval helpers without editing them.
4. Write native failing lifecycle/monitor and permission tests. Implement
   src-tauri/src/launcher.rs and platform/{mod.rs,windows.rs}; wire lib.rs.
   Add Windows-only Rust plugin, explicit build.rs command ACLs and exact-label
   capabilities. Preserve existing commands/services and CSP.
5. Add test-first LauncherAvailability notice to App, with safe status handling
   and no normal-library layout change. Update README with shortcut/lifecycle.
6. Review spec compliance, then code quality; resolve findings before handoff.
7. Run workspace tests, formatting/check, lint, typecheck, desktop/extension/
   host builds, Cargo check, Tauri build, diff check. Verify Windows lifecycle
   and UI with synthetic test-only data; do not modify user clips. Clean only
   created verification artifacts. Report limitations and do not commit.

## Verification record (2026-09-04)

- Final workspace suite: 56 React, 48 extension, 49 Rust tests passed.
- Formatting/check, ESLint, TypeScript, desktop frontend, extension/native-host
  builds, Cargo check, Tauri release build and git diff check passed.
- Native Windows: external-app invocation, minimized-main invocation, immediate
  typing, repeated-window reuse, search/reset/reload, stored-ID clipboard copy,
  Escape preserving clipboard, blur/close hide, unsaved main draft preservation,
  actual second-instance shortcut conflict, exit/re-registration passed.
- Read-only WebView diagnostics confirmed focused search and 640x420 viewport.
  Temporary loopback diagnostics were process-local, not application settings.
- Browser fixtures checked multi-result keyboard navigation, safe load/copy retry,
  long titles/content, light/dark themes and bounded internal scrolling. Main
  layout was measured at 800x500 and 1200x800; launcher at 640x420, 480x300 and
  800x500. Native light/dark appearances were also inspected.
- Review/verification fixes: modified Enter guard, empty-result copy retry,
  retryable native hide, startup-status initialization race, native/WebView
  focus sequencing, and unavailable-notice placement above the library.
- Physical mixed-DPI/multiple-monitor tests were not performed. Native OS
  clipboard/database failures were not induced; failure UI used injected clients.
- After user approval, the temporary clip displayed as "Milestone 7 launcher
  verification alpha" (ID 2dffac5c-9327-4733-8aee-ef0ff1453428) was deleted.
  Reopening SQLite confirmed deletion and unchanged remaining clip records.
  No pre-existing clips were edited or deleted. A separate unsaved test draft
  was cancelled without saving. Verification app/dev-server processes and
  temporary listeners were confirmed closed.
- No commit or push; no Milestone 8 changes.
