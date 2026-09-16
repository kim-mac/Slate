# Clip Detail Header Divider Design

## Goal

Remove the horizontal divider that appears immediately above the clip-content box in the Detail workspace.

## Approved Design

- Remove `border-bottom: 1px solid var(--border)` from `.clip-detail-header`.
- Keep the existing border around `.clip-content` unchanged.
- Keep the current header padding, action layout, content spacing, metadata, navigation, and focus behavior unchanged.
- Do not add a replacement divider, transparent border, or compensating spacing.

## Scope Boundaries

This is a CSS-only presentation change in `apps/desktop/src/styles.css`, plus a focused stylesheet regression assertion in `apps/desktop/src/components/ClipDetail.test.tsx`. It does not change React behavior, launcher behavior, calendar state, selected clips, persistence, Rust/Tauri code, dependencies, or application architecture.

## Verification

- Add a CSS regression assertion that `.clip-detail-header` no longer declares a bottom border.
- Preserve the existing assertion or stylesheet rule proving `.clip-content` retains its own border.
- Run the focused styles test, complete desktop React suite, Prettier, ESLint, workspace TypeScript typecheck, desktop frontend production build, and `git diff --check`.
- Manually verify that the divider is gone while the clip-content box remains visually bounded in light and dark themes.
