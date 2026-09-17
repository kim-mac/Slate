# Calendar Header Filter and Date Design

## Goal

Move the existing clip-type Filter control into the Calendar header and make the current-month heading show the user's complete local date.

## Calendar Header Controls

The Calendar header control order is:

1. Previous month
2. Next month
3. Today
4. Vertical separator
5. Filter

The existing Filter control moves out of the general desktop toolbar together with its adjacent vertical separator. Search, New Clip, theme, and Refresh remain in the desktop toolbar.

The Settings view retains its own separator between the sidebar trigger and **Privacy & About**. That separator is independent of the Calendar Filter separator.

## Filter Ownership and Behavior

- `App` remains the single owner of `contentType` filter state and filter-change behavior.
- `App` passes the existing Filter control to `MemoryCalendar` for placement in the Calendar header. No second filter implementation or filter state is introduced.
- The Filter retains its existing icon size, tooltip, accessible name, dropdown width and options, active styling, and selection behavior.
- The Filter is rendered only while the Calendar is rendered. It is absent in Detail and Settings views.
- Opening Detail does not clear or alter the filter. Returning to Calendar restores the same active filter and filtered clip set.
- Sidebar filtering, sidebar counts, search composition, and Calendar/day-dialog filtering remain unchanged.

## Calendar Heading

The heading uses existing local-date semantics:

- If `visibleMonth` equals the local calendar month derived from `today`, display the full local date in day–month–year order, for example `16 September 2026`.
- If `visibleMonth` is not the current local month, display only the full month name and year, for example `October 2026`.
- The example date is not hardcoded. The heading is derived from the controlled or real local `today` value.
- Pressing **Today** restores the current local month and therefore restores the full-date heading.
- No UTC string slicing or UTC-based month comparison is introduced.

The same heading text remains the Calendar section heading and grid accessible label, preserving the existing focus target and accessible relationship.

## Component Boundary

- `App.tsx` continues to own filter state and constructs the existing Filter control.
- `MemoryCalendar.tsx` accepts one narrowly named header-control prop and places it after a vertical separator immediately following **Today**.
- `MemoryCalendar` continues to own visible-month presentation and derives the heading from `visibleMonth` and `today`.
- No routing, persistence, calendar grouping, selection, Detail navigation, focus-restoration, theme, launcher, Rust/Tauri, or backend boundary changes are required.

## Accessibility

- The Filter retains its current accessible label: `Filter clips` or `Filter clips: <Type>`.
- The Filter tooltip remains **Filter clips**.
- The separator is decorative and retains the existing shadcn separator semantics used by the toolbar.
- Keyboard access and Select focus behavior remain unchanged.
- Calendar month-heading focus restoration continues to target `calendar-month-heading`.

## Tests

Use controlled local dates. Coverage must verify:

1. Filter appears after Today in the Calendar header.
2. The vertical separator appears between Today and Filter.
3. Filter is absent from the general desktop toolbar.
4. Filter is absent in Detail.
5. Filter selection still filters Calendar clips.
6. Filter state survives Calendar → Detail → Calendar.
7. Current month displays day + full month + year.
8. Another month displays only month + year.
9. Today restores the current month and full-date heading.

Run focused Calendar/App tests, the complete desktop React suite, TypeScript typecheck, ESLint, Prettier and Rust formatting checks, desktop production build, and `git diff --check`.

## Scope Boundaries

Do not change Calendar navigation, grid construction, clip grouping, day overflow, selected clip behavior, Detail navigation/focus restoration, compact Back control, clip-detail divider removal, launcher UX, theme behavior, persistence, backend/Rust, dependencies, or permissions.
