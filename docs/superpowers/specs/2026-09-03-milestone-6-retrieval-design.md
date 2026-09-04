# Milestone 6 retrieval design

Approved scope: frontend-only retrieval polish. Keep the existing ClipClient,
Tauri commands, SQLite schema/service, extension, and Native Messaging unchanged.
No dependencies, polling, FTS, deduplication, global shortcuts, or launcher.

Search preserves whole-query substring matches and also accepts every
whitespace-separated term matching any existing searchable field. Matching is
literal and case-insensitive. All/Pinned and an optional compact content-type
filter combine with search. Sidebar counts remain unfiltered. Order remains
created_at descending with id ascending for ties.

Display titles fall back from title to source page title to first nonblank
content line, then Untitled clip. Preview truncation and metadata improve scan
speed without changing stored content. Selection survives refresh/filtering
where possible and otherwise falls back to the first visible clip.

Ctrl/Cmd+F focuses search; Down from search enters results. Result rows support
Up/Down/Home/End. Ctrl/Cmd+Shift+C copies by stored ID only from the library,
never editable fields or open dialogs; repeat/composition are ignored. No global
shortcut registration or OS detection is introduced.

Manual Refresh reuses list(). Initial errors offer Retry instead of an empty
library. Refresh errors preserve existing data. A focused hook owns loading,
refresh, invalidation, and stale-request protection. Refresh and mutations are
serialized in the UI so an old list cannot overwrite a completed mutation.

Success feedback is one neutral dismissible status using existing primitives,
expires after four seconds, and contains no content. Errors persist with a
safe action hint. No notification dependency, automatic retries, or traffic logs.

Preserve controlled forms, full-replacement editing, exact content, delete
confirmation, privacy text, monochrome adaptive themes, and internal pane
scrolling. Omit the type filter if it harms the 800x500 layout.

Verification: test-first pure functions, hook races/errors, keyboard focus and
copy guards, feedback timers, and existing CRUD regression tests. Run workspace
tests, format, lint, typecheck, frontend/extension/host builds, Cargo check and
Tauri build. Manually inspect both themes and window sizes, keyboard retrieval,
and browser capture becoming visible with Refresh without restarting the GUI.
Do not commit until requested.
