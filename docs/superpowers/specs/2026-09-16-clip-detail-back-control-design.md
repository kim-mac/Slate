# Clip Detail Back Control Design

## Goal

Reduce the visual width of the clip-detail Back control while keeping navigation and focus behavior unchanged.

## Approved Design

- Keep the Back control as the first item in the existing detail heading, above the content-type badge and clip title.
- Use the existing ghost Button with the shared `icon-sm` size.
- Display only the existing left-arrow icon; remove the visible **Back** text.
- Preserve `backButtonRef`, `onBack`, and `aria-label="Back to calendar"`.
- Use the existing Tooltip components to show **Back to calendar** on pointer hover and keyboard focus.

## Scope Boundaries

This is a presentation-only change in `ClipDetail`. It does not alter detail navigation, calendar state, focus restoration, clip metadata, actions, persistence, Rust/Tauri code, launcher behavior, or dependencies.

## Verification

- Add a focused component test that verifies the icon-only accessible control, tooltip, callback, and absence of visible **Back** text.
- Run the complete desktop React suite, Prettier, ESLint, workspace TypeScript typecheck, desktop production build, and `git diff --check`.
- Manually verify placement, compact sizing, tooltip behavior, keyboard focus, Back navigation, and both light/dark themes.
