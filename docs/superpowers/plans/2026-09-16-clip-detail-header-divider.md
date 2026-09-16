# Clip Detail Header Divider Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the horizontal divider above the clip-content box while retaining the box's own border and all existing Detail behavior.

**Architecture:** Treat this as a stylesheet-only presentation correction. Extend the focused `ClipDetail` test to inspect the packaged stylesheet, then remove only the `.clip-detail-header` bottom-border declaration; do not change React markup, component state, layout spacing, or shared UI primitives.

**Tech Stack:** CSS, React 19, TypeScript, Vitest, Node filesystem APIs.

---

### Task 1: Add a failing stylesheet regression test

**Files:**
- Modify: `apps/desktop/src/components/ClipDetail.test.tsx`
- Reference: `apps/desktop/src/styles.css`

- [ ] **Step 1: Add Node stylesheet imports to the focused component test**

Add the Node type reference and imports without changing the existing Back-control test:

```tsx
/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
```

- [ ] **Step 2: Add a focused test for the divider and content-box border**

Append this test inside the existing `describe('ClipDetail', ...)` block:

```tsx
test('omits the header divider while retaining the clip-content border', () => {
  const stylesheet = readFileSync(
    resolve(process.cwd(), 'src/styles.css'),
    'utf8',
  );
  const headerRule = stylesheet.match(/\.clip-detail-header\s*\{([^}]*)\}/)?.[1];
  const contentRule = stylesheet.match(/\.clip-content\s*\{([^}]*)\}/)?.[1];

  expect(headerRule).toBeDefined();
  expect(headerRule).not.toContain('border-bottom:');
  expect(contentRule).toContain('border: 1px solid var(--border);');
});
```

This checks the exact approved boundary: the header divider is absent and the clip-content box remains bounded.

- [ ] **Step 3: Run the focused test and verify the expected failure**

Run from `apps/desktop`:

```powershell
pnpm test src/components/ClipDetail.test.tsx
```

Expected: the Back-control test passes, and the new stylesheet test fails because `.clip-detail-header` still contains `border-bottom: 1px solid var(--border);`.

### Task 2: Remove only the header divider

**Files:**
- Modify: `apps/desktop/src/styles.css`
- Test: `apps/desktop/src/components/ClipDetail.test.tsx`

- [ ] **Step 1: Delete the bottom-border declaration**

Change the rule from:

```css
.clip-detail-header {
  border-bottom: 1px solid var(--border);
  display: flex;
```

to:

```css
.clip-detail-header {
  display: flex;
```

Do not change `.clip-content`, padding, gaps, colors, radii, or any other selector.

- [ ] **Step 2: Run the focused test again**

Run from `apps/desktop`:

```powershell
pnpm test src/components/ClipDetail.test.tsx
```

Expected: both focused `ClipDetail` tests pass.

- [ ] **Step 3: Inspect the scoped implementation diff**

Run:

```powershell
git diff -- apps/desktop/src/components/ClipDetail.test.tsx apps/desktop/src/styles.css
```

Expected: the new stylesheet assertion and one deleted CSS declaration are the only divider-removal changes. Existing uncommitted Back-control and launcher changes remain otherwise untouched.

### Task 3: Verify and hand off for visual approval

**Files:**
- Verify: `apps/desktop/src/components/ClipDetail.test.tsx`
- Verify: `apps/desktop/src/styles.css`
- Preserve unchanged: `apps/desktop/src/launcher/*`

- [ ] **Step 1: Run the full desktop suite**

```powershell
pnpm test:desktop
```

Expected: all desktop React tests pass.

- [ ] **Step 2: Run static checks and the desktop build**

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build:desktop
```

Expected: every command exits successfully without changing source files.

- [ ] **Step 3: Verify whitespace and working-tree scope**

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors, no generated outputs, and no newly modified files outside `ClipDetail.test.tsx` and `styles.css` for this task.

- [ ] **Step 4: Manually verify the visual result**

Open a clip and confirm in both light and dark themes:

1. The horizontal divider between the detail header/actions and content is gone.
2. The clip-content box still has its own border on all four sides.
3. Header padding, action layout, metadata, and the compact Back control are unchanged.

- [ ] **Step 5: Stop before committing**

Report the exact changes and verification results, then wait for user approval. Do not commit the implementation, push, update PR #16, or start another task.
