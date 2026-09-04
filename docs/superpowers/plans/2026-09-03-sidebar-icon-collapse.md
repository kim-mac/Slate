# Sidebar icon-collapse implementation plan

User approved adapting the official Base UI Sidebar demo to the existing clip
library, including icon collapse. This supersedes the earlier fixed-sidebar
constraint only. Do not commit or implement Milestone 7.

**Goal:** Match the demo's sidebar composition, spacing, rail and header toggle
without its sample accounts, nested destinations or dashboard widgets.

**Architecture:** Reuse existing shadcn Sidebar primitives. App controls expanded
state so Ctrl/Cmd+F can reveal search. ClipClient and all persistence stay intact.

**Tech stack:** Existing React, Base UI, Tailwind, Vitest and Tauri. No dependencies.

## Files and steps

1. Extend `apps/desktop/src/App.test.tsx` test-first: toggle/rail collapse,
   expanded fresh launch, collapsed navigation and New clip, preserved search
   and selection, search-button/Ctrl+F expansion, guarded Ctrl+B, no cookies.
   Run `pnpm test:desktop` and observe new failures.
2. Update `apps/desktop/src/App.tsx`: controlled SidebarProvider, search focus
   after revealing the input, demo-style header toggle and vertical Separator.
3. Update `apps/desktop/src/components/AppSidebar.tsx`: `collapsible="icon"`,
   SidebarRail, standard header/group/footer spacing, compact Search/New clip
   controls, accessible names, counts in collapsed navigation tooltips and
   compact local-only privacy icon. Keep existing callbacks unchanged.
4. Update `apps/desktop/src/components/ui/sidebar.tsx`: remove unused generated
   cookie persistence; guard Ctrl/Cmd+B during editing/dialogs, repeat,
   composition and modified key combinations. Keep official layout primitives.
5. Update `apps/desktop/src/styles.css`: remove fixed-width overrides that fight
   the official icon layout; bound header/sidebar/content at 800x500. Do not
   add animations or alter theme tokens.
6. Update README with sidebar toggle/search behavior. Run tests to green, then
   format/check, lint, typecheck, workspace tests, desktop/extension builds,
   Cargo check and Tauri build. Verify expanded/collapsed layouts at 800x500
   and larger, both themes, keyboard and dialog guards. Remove any disposable
   browser-review files and stop without committing.
