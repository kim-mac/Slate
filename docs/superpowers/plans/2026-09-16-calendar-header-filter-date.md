# Calendar Header Filter and Date Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relocate the existing App-owned clip-type Filter into the Calendar header after Today and show the complete local date only for the current visible month.

**Architecture:** `App` remains the filter-state owner and passes its existing Select as a narrowly scoped `headerControl` React node to `MemoryCalendar`. `MemoryCalendar` owns only placement and local-date heading presentation; existing filtering, navigation, persistence, and focus flows stay unchanged.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, shadcn/Base UI Select and Separator, Intl.DateTimeFormat.

---

### Task 1: Specify Calendar heading and control placement

**Files:**
- Modify: `apps/desktop/src/components/calendar/MemoryCalendar.test.tsx`
- Modify: `apps/desktop/src/components/calendar/MemoryCalendar.tsx`

- [ ] **Step 1: Add controlled-date heading tests**

Update the current-month expectation in the existing month-shell test from `September 2026` to `11 September 2026`. Add a focused harness test that uses `today={new Date(2026, 8, 16, 12)}` and verifies:

```tsx
function CalendarHeadingHarness() {
  const [visibleMonth, setVisibleMonth] = useState({ year: 2026, month: 8 });

  return (
    <MemoryCalendar
      clips={[]}
      visibleMonth={visibleMonth}
      onVisibleMonthChange={setVisibleMonth}
      {...calendarActions()}
      today={new Date(2026, 8, 16, 12)}
    />
  );
}

test('shows the full local date for the current month and month-year elsewhere', () => {
  render(<CalendarHeadingHarness />);

  expect(
    screen.getByRole('heading', { name: '16 September 2026' }),
  ).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
  expect(screen.getByRole('heading', { name: 'October 2026' })).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Today' }));
  expect(
    screen.getByRole('heading', { name: '16 September 2026' }),
  ).toBeTruthy();
});
```

Import `useState` from React. The controlled noon date avoids midnight and UTC-boundary ambiguity.

- [ ] **Step 2: Add a header-control order test**

Render `MemoryCalendar` with `headerControl={<button aria-label="Filter clips">Filter</button>}`. Query `.memory-calendar-controls` and assert its direct interactive/structural order is Previous, Next, Today, separator, Filter:

```tsx
test('places the supplied Filter control after Today with a separator', () => {
  const { container } = render(
    <MemoryCalendar
      clips={[]}
      visibleMonth={{ year: 2026, month: 8 }}
      onVisibleMonthChange={vi.fn()}
      {...calendarActions()}
      today={new Date(2026, 8, 16, 12)}
      headerControl={<button aria-label="Filter clips">Filter</button>}
    />,
  );
  const controls = container.querySelector('.memory-calendar-controls')!;
  const today = within(controls).getByRole('button', { name: 'Today' });
  const separator = within(controls).getByRole('separator');
  const filter = within(controls).getByRole('button', { name: 'Filter clips' });

  expect(
    today.compareDocumentPosition(separator) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    separator.compareDocumentPosition(filter) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});
```

- [ ] **Step 3: Run the focused Calendar tests and verify RED**

Run from `apps/desktop`:

```powershell
pnpm test src/components/calendar/MemoryCalendar.test.tsx
```

Expected: failures because the current heading is month/year only and `MemoryCalendar` does not yet accept or render `headerControl`.

- [ ] **Step 4: Add the minimal Calendar presentation API**

In `MemoryCalendar.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Separator } from '../ui/separator';

interface MemoryCalendarProps extends CalendarClipActions {
  // existing props
  headerControl?: ReactNode;
}
```

Destructure `headerControl`. Derive the heading with local date parts:

```tsx
const currentMonth = calendarMonthFromDate(today);
const isCurrentMonth =
  visibleMonth.year === currentMonth.year &&
  visibleMonth.month === currentMonth.month;
const currentDateParts = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
}).formatToParts(today);
const currentDatePart = (type: Intl.DateTimeFormatPartTypes) =>
  currentDateParts.find((part) => part.type === type)?.value ?? '';
const monthLabel = isCurrentMonth
  ? `${currentDatePart('day')} ${currentDatePart('month')} ${currentDatePart('year')}`
  : new Intl.DateTimeFormat(undefined, {
      month: 'long',
      year: 'numeric',
    }).format(new Date(visibleMonth.year, visibleMonth.month, 1));
```

Place the control after Today only when provided:

```tsx
{headerControl && (
  <>
    <Separator
      orientation="vertical"
      className="data-vertical:h-4 data-vertical:self-auto"
    />
    {headerControl}
  </>
)}
```

Do not alter month navigation, grid generation, clip grouping, focus effects, or dialogs.

- [ ] **Step 5: Run focused Calendar tests and verify GREEN**

```powershell
pnpm test src/components/calendar/MemoryCalendar.test.tsx
```

Expected: all Calendar component tests pass.

### Task 2: Relocate the existing App-owned Filter

**Files:**
- Modify: `apps/desktop/src/App.test.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Test: `apps/desktop/src/components/calendar/MemoryCalendar.test.tsx`

- [ ] **Step 1: Update App test date helpers for the new current heading**

Replace the current-month test label with the same local-part ordering used by production:

```tsx
const currentDate = new Date();
const currentDateParts = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
}).formatToParts(currentDate);
const currentDatePart = (type: Intl.DateTimeFormatPartTypes) =>
  currentDateParts.find((part) => part.type === type)?.value ?? '';
const currentMonthLabel = `${currentDatePart('day')} ${currentDatePart('month')} ${currentDatePart('year')}`;
```

Continue constructing current-month clips with local `new Date(year, month, day, hour)` semantics.

- [ ] **Step 2: Add and update App tests for location and state preservation**

Update `uses the main toolbar for retrieval controls without redundant view copy` so the desktop toolbar explicitly has no Filter and retains Search → New Clip → Theme → Refresh order. Add assertions that the Calendar header contains the Filter after Today and a separator.

Update the existing `Back preserves the visible month, search, type filter, and sidebar scope` test so it selects **Code** while still in Calendar, opens the matching code clip, verifies `Filter clips: Code` is absent in Detail, then returns and verifies `Filter clips: Code` is restored unchanged.

Keep the existing content-type filter tests; they prove selecting each existing option still filters the shared clip set.

- [ ] **Step 3: Run the focused App tests and verify RED**

```powershell
pnpm test src/App.test.tsx
```

Expected: location/visibility assertions fail because the existing Filter is still in `.desktop-header` and remains visible in Detail.

- [ ] **Step 4: Move the existing Filter JSX without duplicating it**

In `App.tsx`:

1. Keep the desktop `SidebarTrigger` first.
2. Render the existing desktop separator only inside the Settings branch before `Privacy & About`.
3. Remove the Filter Select from the library portion of `.desktop-header`.
4. Leave Search/New Clip and Theme/Refresh in their existing toolbar groups.
5. Pass the exact existing Select markup to Calendar through `headerControl`:

```tsx
<MemoryCalendar
  // existing props
  headerControl={
    <Select value={contentType} onValueChange={existingHandler}>
      {/* existing Tooltip/SelectTrigger and SelectContent unchanged */}
    </Select>
  }
/>
```

Do not create new filter state, a second filter handler, or another reusable component. Because `MemoryCalendar` is not rendered in Detail, the control is naturally absent there while `contentType` remains owned by `App`.

- [ ] **Step 5: Run focused App and Calendar tests and verify GREEN**

```powershell
pnpm test src/App.test.tsx src/components/calendar/MemoryCalendar.test.tsx
```

Expected: both suites pass, including filter location, Detail absence, filter behavior/state preservation, and controlled-date heading tests.

### Task 3: Full verification and manual handoff

**Files:**
- Verify: `apps/desktop/src/App.tsx`
- Verify: `apps/desktop/src/App.test.tsx`
- Verify: `apps/desktop/src/components/calendar/MemoryCalendar.tsx`
- Verify: `apps/desktop/src/components/calendar/MemoryCalendar.test.tsx`
- Preserve: all existing uncommitted launcher, compact Back-control, and divider-removal changes

- [ ] **Step 1: Run the complete desktop React suite**

```powershell
pnpm test:desktop
```

Expected: every desktop test passes.

- [ ] **Step 2: Run static verification**

```powershell
pnpm typecheck
pnpm lint
pnpm format:check
```

Expected: TypeScript, ESLint, Prettier, and Rust formatting checks all exit successfully.

- [ ] **Step 3: Build the production desktop frontend**

```powershell
pnpm build:desktop
```

Expected: TypeScript and Vite production build succeed.

- [ ] **Step 4: Audit the final diff**

```powershell
git diff --check
git status --short
git diff -- apps/desktop/src/App.tsx apps/desktop/src/App.test.tsx apps/desktop/src/components/calendar/MemoryCalendar.tsx apps/desktop/src/components/calendar/MemoryCalendar.test.tsx
```

Expected: no whitespace errors. Calendar-header work is limited to the four listed files; prior approved uncommitted UI changes remain present and untouched.

- [ ] **Step 5: Stop for manual verification**

Report files changed, implementation details, tests, verification results, and current uncommitted status. Provide concise checks for control order, current/other-month headings, Detail visibility/state preservation, filtering, and both themes. Do not commit, push, update PR #16, or start another feature.
