# Launcher Controls and Scrollbars Design

## Goal

Make the Quick Search launcher easier to understand and close, while aligning its scroll behavior with the existing desktop UI.

## Approved Changes

- Add a small six-dot grip beside the **Quick Search** label so the draggable header region is visually obvious.
- Keep the grip, label, and unused header space draggable. Keep interactive header buttons outside the drag region.
- Add an icon-only **Close Quick Search** button immediately to the right of **Open Tin**.
- Make the close button use the existing launcher hide path, matching Escape. It must not quit Tin or modify the clipboard.
- Remove only the **Local only** footer text. Preserve result counts, copying state, copied feedback, and keyboard hints.
- Replace native launcher scrolling with the existing shadcn/Base UI `ScrollArea` for:
  - the main results list;
  - the expanded selected-clip preview.
- Keep both scroll areas vertical-only and rely on the existing packaged native-scrollbar suppression.
- Give unselected clip results a subtle background-only hover state on pointer-capable devices. Keep the selected result visually stronger through its existing background and border.

## Accessibility and Interaction

- The drag grip is decorative and hidden from assistive technology.
- Open Tin and Close Quick Search remain separate, keyboard-focusable icon buttons with accessible labels and titles.
- Escape continues to hide the launcher.
- Search focus, arrow navigation, Enter whole-clip copy, normal Ctrl+C selection copy, retry states, and repeated-copy behavior remain unchanged.
- Scrollbar changes must not prevent selecting clip text.
- Hover styling must not alter layout, selection state, or touch behavior.

## Scope Boundaries

This is a launcher-only UI refinement. It does not change Rust commands, Tauri permissions, window lifecycle, shortcuts, clipboard behavior, persistence, Native Messaging, the browser extension, dependencies, or architecture.

## Verification

- Tests cover the drag affordance, close action, footer text removal, custom scrollbar structure, and vertical-only viewport behavior.
- Existing launcher interaction tests remain green.
- Run desktop tests, formatting, lint, workspace typecheck, desktop production build, Cargo check if no native files change, and `git diff --check`.
- Manually verify light/dark appearance, drag behavior, both scrollbars, Open Tin, Close, Escape, text selection, Enter copying, and keyboard navigation.
