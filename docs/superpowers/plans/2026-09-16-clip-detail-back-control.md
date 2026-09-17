# Compact Clip Detail Back Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the wide text Back control in clip detail with a compact, accessible arrow-only control while preserving navigation and focus restoration.

**Architecture:** Keep the change entirely inside the existing `ClipDetail` presentation boundary. Reuse the shared `Button` `icon-sm` size and existing Base UI tooltip primitives; do not alter App navigation state, refs, handlers, CSS layout, or persistence behavior.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, shadcn/Base UI components, lucide-react.

---

### Task 1: Specify the compact Back control behavior

**Files:**
- Create: `apps/desktop/src/components/ClipDetail.test.tsx`
- Reference: `apps/desktop/src/components/ClipDetail.tsx`
- Reference: `apps/desktop/src/components/ui/button.tsx`
- Reference: `apps/desktop/src/components/ui/tooltip.tsx`

- [ ] **Step 1: Add a focused component test with the existing providers**

Create `apps/desktop/src/components/ClipDetail.test.tsx` with a representative clip and render `ClipDetail` inside `TooltipProvider`:

```tsx
import type { Clip } from '@ai-clip-memory/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, test, vi } from 'vitest';

import { ClipDetail } from '@/components/ClipDetail';
import { TooltipProvider } from '@/components/ui/tooltip';

const clip: Clip = {
  id: 'clip-1',
  content: 'Compact back control test content',
  contentType: 'text',
  title: 'Compact control test',
  sourceApp: 'Other Web',
  sourceUrl: 'https://example.com/source',
  sourcePageTitle: 'Example source',
  isPinned: false,
  createdAt: '2026-09-16T12:00:00.000Z',
  updatedAt: '2026-09-16T12:00:00.000Z',
};

describe('ClipDetail', () => {
  test('renders a compact arrow-only Back control with an accessible tooltip', async () => {
    const onBack = vi.fn();

    render(
      <TooltipProvider>
        <ClipDetail
          clip={clip}
          disabled={false}
          backButtonRef={createRef<HTMLButtonElement>()}
          onBack={onBack}
          onCopy={vi.fn()}
          onDelete={vi.fn()}
          onEdit={vi.fn()}
          onOpenSource={vi.fn()}
          onSetPinned={vi.fn()}
        />
      </TooltipProvider>,
    );

    const back = screen.getByRole('button', { name: 'Back to calendar' });
    expect(back.className).toContain('size-7');
    expect(screen.queryByText('Back', { exact: true })).toBeNull();

    fireEvent.focus(back);
    expect(await screen.findByText('Back to calendar')).toBeTruthy();

    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
```

If the shared `Clip` contract has a different optional-field representation, match the exact currently exported type without adding fields or changing production contracts. Keep the assertions focused on accessible name, shared `icon-sm` sizing, absence of visible Back text, tooltip content, and callback behavior.

- [ ] **Step 2: Run the focused test and verify it fails for the current wide control**

Run:

```powershell
pnpm --filter @ai-clip-memory/desktop test -- src/components/ClipDetail.test.tsx
```

Expected: FAIL because the current button uses `size="sm"`, still renders visible `Back` text, and has no Back tooltip.

- [ ] **Step 3: Confirm the failure is behavioral rather than test setup**

Check that the failure output names one or more of these expected mismatches:

```text
expected className to contain size-7
expected visible Back text to be absent
unable to find tooltip text Back to calendar
```

Do not change global test setup or relax the assertions to make the existing implementation pass.

### Task 2: Implement the compact Back control

**Files:**
- Modify: `apps/desktop/src/components/ClipDetail.tsx`
- Test: `apps/desktop/src/components/ClipDetail.test.tsx`

- [ ] **Step 1: Replace only the existing Back button markup**

In `ClipDetail`, replace the current text button with the existing tooltip pattern and shared `icon-sm` size:

```tsx
<Tooltip>
  <TooltipTrigger
    render={
      <Button
        ref={backButtonRef}
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Back to calendar"
        onClick={onBack}
      />
    }
  >
    <ArrowLeft aria-hidden="true" />
  </TooltipTrigger>
  <TooltipContent>Back to calendar</TooltipContent>
</Tooltip>
```

Leave the control as the first child of `.clip-heading`, immediately above the existing content-type badge and title. Do not change `backButtonRef`, `onBack`, the accessible label, surrounding layout classes, action buttons, or navigation logic.

- [ ] **Step 2: Run the focused component test**

Run:

```powershell
pnpm --filter @ai-clip-memory/desktop test -- src/components/ClipDetail.test.tsx
```

Expected: PASS with 1 focused component test.

- [ ] **Step 3: Run the existing App navigation/focus tests**

Run:

```powershell
pnpm --filter @ai-clip-memory/desktop test -- src/App.test.tsx
```

Expected: PASS, including the existing `Back to calendar` role queries and calendar focus-restoration coverage.

- [ ] **Step 4: Review the scoped diff**

Run:

```powershell
git diff -- apps/desktop/src/components/ClipDetail.tsx apps/desktop/src/components/ClipDetail.test.tsx
```

Expected: only the new focused test and the compact Back-control markup are present. There must be no CSS, launcher, App state, Rust, dependency, or persistence changes from this task.

### Task 3: Run regression verification and manual handoff

**Files:**
- Verify: `apps/desktop/src/components/ClipDetail.tsx`
- Verify: `apps/desktop/src/components/ClipDetail.test.tsx`
- Preserve unchanged: existing uncommitted launcher files

- [ ] **Step 1: Run the full desktop React suite**

Run:

```powershell
pnpm test:desktop
```

Expected: all desktop tests pass, including the new `ClipDetail` test and all launcher, App, and calendar regressions.

- [ ] **Step 2: Run formatting, lint, and type checks**

Run:

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
```

Expected: all commands exit successfully without modifying files.

- [ ] **Step 3: Build the desktop frontend**

Run:

```powershell
pnpm build:desktop
```

Expected: TypeScript and the Vite production frontend build complete successfully.

- [ ] **Step 4: Check whitespace and final scope**

Run:

```powershell
git diff --check
git status --short
```

Expected: `git diff --check` produces no output. Status shows the previously approved launcher files plus `ClipDetail.tsx` and the new `ClipDetail.test.tsx`; no generated build outputs or unrelated files are tracked.

- [ ] **Step 5: Manually verify the detail control without changing product state**

Launch the desktop app using the existing development workflow, open a clip from the calendar or sidebar, and verify:

1. A single compact left-arrow button appears above the content-type badge and clip title.
2. No visible `Back` text remains.
3. Pointer hover and keyboard focus show `Back to calendar`.
4. The button focus ring is visible in both system light and dark themes.
5. Clicking the arrow returns to the same calendar context and restores focus as before.
6. The detail action buttons and clip content layout are unchanged.

- [ ] **Step 6: Stop for approval before committing implementation**

Report the exact changed files, test/build results, and manual verification steps. Do not push or merge PR #16. Do not commit the implementation until the user approves the result and requests the checkpoint.
