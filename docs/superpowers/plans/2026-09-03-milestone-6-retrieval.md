# Milestone 6 Retrieval Implementation Plan

> Execute test-first using superpowers:executing-plans. Do not commit.

**Goal:** Find and copy local clips quickly inside the existing desktop window.

**Architecture:** Pure retrieval helpers plus a focused list-loading hook,
composed into existing React/shadcn UI through the unchanged ClipClient.

**Tech Stack:** Existing React, TypeScript, Vitest, shadcn/Base UI, Tauri.

## 1. Baseline

- [ ] Install with `pnpm install --frozen-lockfile` and run existing tests.

## 2. Pure retrieval helpers

- [ ] Add `src/lib/clipRetrieval.test.ts` covering cross-field AND terms,
  literal punctuation, original substrings, nulls, title fallback, truncation,
  and deterministic recent ordering.
- [ ] Run the focused test and observe missing-module failure.
- [ ] Implement `matchesSearch(clip, query)`, `displayTitle(clip)`,
  `clipPreview(content)`, and `recentClips(clips)` in `clipRetrieval.ts`.
- [ ] Re-run focused tests to green.

## 3. Refresh boundary

- [ ] Add `hooks/useClipLibrary.test.ts` with deferred list promises: initial
  failure/retry, retained data on refresh failure, stale completion, unmount,
  and mutation invalidation.
- [ ] Observe red with the focused test, then implement `useClipLibrary(client)`
  exposing clips, setClips, loading, refreshing, loadError, refresh, invalidate.
- [ ] Verify green. Keep errors generic and do not log values.

## 4. Feedback and keyboard list

- [ ] Add `ClipFeedback.test.tsx` for dismissal, four-second expiry, replacement,
  and timer cleanup. Observe red, implement ClipFeedback, verify green.
- [ ] Add `ClipList.test.tsx` for roving focus, Up/Down/Home/End bounds,
  composition/modifier guards, and presentation fallbacks. Observe red, update
  ClipList, verify green. Focus with preventScroll and adjust only list viewport.

## 5. App integration

- [ ] Extend App.test.tsx first for multi-term/type filtering, unfiltered counts,
  Refresh/Retry, preservation on failure, shortcuts and guards, feedback, and
  repeated-action protection. Run `pnpm test:desktop` and observe new failures.
- [ ] Update App.tsx, AppSidebar.tsx, ClipDetail.tsx and styles.css. Keep existing
  dialogs/forms and privileged calls intact. Refresh uses only client.list().
- [ ] Re-run desktop tests until green. Add regressions before fixing bugs.

## 6. Verification and handoff

- [ ] Update README with current retrieval behavior and app-scoped shortcuts.
- [ ] Run `pnpm format`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`,
  `pnpm test`, `pnpm build:desktop`, `pnpm build:extension`, `pnpm build:bridge`,
  `pnpm check:rust`, and `pnpm --filter @ai-clip-memory/desktop tauri:build`.
- [ ] Manually check both themes, 800x500/larger windows, keyboard find/copy,
  type filtering, fallback titles, feedback, long content, and error/retry with
  an injected test client. Verify real browser capture appears after Refresh.
- [ ] Audit protected paths and dependency lockfile for zero changes. Report
  limitations honestly; stop without committing or starting Milestone 7.
