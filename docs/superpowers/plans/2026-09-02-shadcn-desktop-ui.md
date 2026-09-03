# shadcn Desktop UI Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the existing Tauri desktop clip-library presentation to the official shadcn/ui `base-nova` component set without changing application behavior or privileged/data boundaries.

**Architecture:** Keep `App.tsx` as the owner of existing library and operation state, keep all persistence calls behind the unchanged `ClipClient`, and place generated shadcn presentation primitives under `apps/desktop/src/components/ui`. Add focused composition components for the fixed navigation sidebar and controlled form dialog while keeping delete-alert state at the application boundary.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Tailwind CSS v4, official shadcn CLI 4.19.1 with Base UI `base-nova`, Vitest, Testing Library, Tauri 2.

---

### Task 1: Lock behavior expectations for dialogs

**Files:**
- Modify: `apps/desktop/src/App.test.tsx`

- [ ] **Step 1: Write failing create/edit Dialog tests**

Update the existing create and edit tests to require `role="dialog"`, query the form controls within that dialog, and add a test that Cancel closes the dialog without calling `create` or `update`.

```tsx
fireEvent.click(screen.getByRole('button', { name: 'New clip' }));
const dialog = screen.getByRole('dialog', { name: 'Create clip' });
expect(within(dialog).getByLabelText('Content')).toBeTruthy();
fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
expect(screen.queryByRole('dialog')).toBeNull();
expect(fake.create).not.toHaveBeenCalled();
```

- [ ] **Step 2: Write failing AlertDialog tests**

Replace the `window.confirm` test setup with an assertion that Delete opens `role="alertdialog"`. Add cancel and confirm assertions.

```tsx
fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
const alert = screen.getByRole('alertdialog', { name: 'Delete clip?' });
fireEvent.click(within(alert).getByRole('button', { name: 'Cancel' }));
expect(fake.delete).not.toHaveBeenCalled();
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```powershell
pnpm --filter @ai-clip-memory/desktop test -- src/App.test.tsx
```

Expected: create/edit dialog tests fail because forms render inline; delete tests fail because the browser confirmation API is still used.

### Task 2: Initialize the official shadcn foundation

**Files:**
- Create: `apps/desktop/components.json`
- Create: `apps/desktop/src/lib/utils.ts`
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/tsconfig.json`
- Modify: `apps/desktop/tsconfig.app.json`
- Modify: `apps/desktop/vite.config.ts`
- Modify: `apps/desktop/src/styles.css`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Run the official CLI from the desktop package**

The documented pnpm runner produces a broken transient dependency junction on this Windows host. Invoke the same official CLI package through npm's isolated runner:

```powershell
npx --yes shadcn@latest init --template vite --base base --preset base-nova --no-monorepo --yes
```

Expected: shadcn creates `components.json`, the `@/*` alias, Tailwind v4 Vite integration, theme tokens, and `src/lib/utils.ts`, while pnpm remains the detected project package manager.

- [ ] **Step 2: Review generated configuration before continuing**

Verify `components.json` has `style: "base-nova"`, `rsc: false`, `tsx: true`, CSS variables enabled, `src/styles.css`, and aliases rooted at `@/`. Verify Tailwind is integrated through `@tailwindcss/vite` and no Next.js, server, analytics, or network runtime is added.

- [ ] **Step 3: Restore system-adaptive theme tokens**

Keep light tokens in `:root` and move the CLI's dark token values into:

```css
@media (prefers-color-scheme: dark) {
  :root {
    /* generated dark shadcn variables, refined for the existing neutral/teal direction */
  }
}
```

Do not add theme state, a forced `.dark` class, or a theme switcher. Retain the global `box-sizing`, zero body margin, and bounded `html`, `body`, and `#root` dimensions needed for an overflow-free Tauri window.

### Task 3: Add only approved shadcn components

**Files:**
- Create: `apps/desktop/src/components/ui/button.tsx`
- Create: `apps/desktop/src/components/ui/input.tsx`
- Create: `apps/desktop/src/components/ui/textarea.tsx`
- Create: `apps/desktop/src/components/ui/select.tsx`
- Create: `apps/desktop/src/components/ui/dialog.tsx`
- Create: `apps/desktop/src/components/ui/alert-dialog.tsx`
- Create: `apps/desktop/src/components/ui/card.tsx`
- Create: `apps/desktop/src/components/ui/badge.tsx`
- Create: `apps/desktop/src/components/ui/separator.tsx`
- Create: `apps/desktop/src/components/ui/sidebar.tsx`
- Create: `apps/desktop/src/components/ui/scroll-area.tsx`
- Create: `apps/desktop/src/components/ui/tooltip.tsx`
- Create only if generated for Sidebar: `apps/desktop/src/components/ui/sheet.tsx`, `apps/desktop/src/components/ui/skeleton.tsx`, `apps/desktop/src/hooks/use-mobile.ts`
- Modify: `apps/desktop/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Generate the approved registry components**

Run:

```powershell
npx --yes shadcn@latest add button input textarea select dialog alert-dialog card badge separator sidebar scroll-area tooltip --yes
```

- [ ] **Step 2: Audit generated scope**

Keep only the requested components and unavoidable Sidebar dependencies. Confirm no DropdownMenu, toast, table, command palette, dashboard block, data client, or network SDK was generated.

- [ ] **Step 3: Run typecheck**

Run `pnpm typecheck`. Expected: generated components compile before application composition changes.

### Task 4: Compose the fixed navigation and list/detail panes

**Files:**
- Create: `apps/desktop/src/components/AppSidebar.tsx`
- Modify: `apps/desktop/src/components/ClipList.tsx`
- Modify: `apps/desktop/src/components/ClipDetail.tsx`

- [ ] **Step 1: Implement a fixed non-collapsible AppSidebar**

Compose `Sidebar`, `SidebarContent`, `SidebarFooter`, `SidebarGroup`, `SidebarMenu`, `SidebarMenuButton`, and `SidebarMenuBadge`. Accept the existing active view, counts, and callbacks as props. Use `collapsible="none"`; do not expose a trigger or keyboard collapse behavior.

- [ ] **Step 2: Refactor ClipList with shadcn primitives**

Keep the same `clips`, `selectedId`, and `onSelect` props. Use shadcn Buttons for selectable rows, Badges for content type and pinned state, and a ScrollArea owned by the list pane. Preserve accessible button names and `aria-pressed` so the existing behavior tests remain meaningful.

- [ ] **Step 3: Refactor ClipDetail with shadcn primitives**

Keep the same callbacks. Use Card, Badge, Separator, ScrollArea, Button, and Tooltip while leaving clip content rendered as plain text in a `<pre>`; never render captured HTML. Keep all actions directly visible and keep Open source conditional on `sourceUrl`.

- [ ] **Step 4: Run desktop tests**

Expected: existing list, pin, copy, source, count, and search behavior tests remain green; dialog-specific tests remain red until Task 5.

### Task 5: Implement the controlled form Dialog test-first

**Files:**
- Modify: `apps/desktop/src/components/ClipForm.tsx`
- Create: `apps/desktop/src/components/ClipFormDialog.tsx`
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Refactor form controls without changing submission semantics**

Use Input, Textarea, Select, and Button. Preserve controlled field state, exact nonblank content, `content.trim()` blank validation, optional metadata normalization, full-replacement update input, saving state, labels, and button names.

- [ ] **Step 2: Add the controlled Dialog wrapper**

`ClipFormDialog` receives `mode`, `open`, `isSaving`, `onOpenChange`, and `onSubmit`. Render DialogTitle as `Create clip` or `Edit clip`, keep a concise description, and close only through the existing cancel or successful-save flow controlled by `App`.

- [ ] **Step 3: Integrate Dialog into App**

Render the library continuously behind the dialog. Opening New Clip sets create mode and All Clips; Edit sets edit mode. Cancel clears `formMode`. Saving calls the unchanged `saveClip` and clears `formMode` only after success as it does now.

- [ ] **Step 4: Run focused tests and verify create/edit GREEN**

Run the App tests. Expected: create, edit, and cancel dialog tests pass with the existing `ClipClient` argument assertions unchanged.

### Task 6: Implement AlertDialog deletion and complete the shell

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/styles.css`

- [ ] **Step 1: Add explicit delete-target state**

Replace `window.confirm` with `deleteTarget: Clip | null`. The detail Delete action sets the target. AlertDialog cancel clears it. Confirm calls the existing delete handler with the stored target, updates the same clip/selection state, and closes the alert after success.

- [ ] **Step 2: Compose the shell with bounded overflow**

Use SidebarProvider with a fixed Sidebar and bounded SidebarInset. Keep title/search/New Clip, current headings, descriptions, empty states, error/status messages, settings privacy card, and about metadata. Apply `min-width: 0`, `min-height: 0`, and `overflow: hidden` at shell/grid boundaries; scrolling belongs only to list/detail/form contents.

- [ ] **Step 3: Run focused tests and verify AlertDialog GREEN**

Expected: cancel never calls delete; confirmation calls `client.delete(id)` once and updates the empty state.

- [ ] **Step 4: Run all desktop tests**

Run `pnpm test:desktop`. Expected: every desktop test passes.

### Task 7: Verify scope, behavior, builds, and layout

**Files:**
- Modify only files already listed if a directly related fix is required

- [ ] **Step 1: Format and run automated verification**

Run:

```powershell
pnpm format
pnpm format:check
pnpm test
pnpm lint
pnpm typecheck
pnpm build:desktop
pnpm build:extension
pnpm check:rust
pnpm --filter @ai-clip-memory/desktop tauri:build
git diff --check
```

Expected: all commands exit zero. The existing harmless Cargo canonicalization warning may remain.

- [ ] **Step 2: Audit milestone boundaries**

Confirm no changes under `apps/desktop/src-tauri`, `apps/extension`, or `packages/shared`; no Tauri capabilities, SQLite schema, commands, bridge, cloud, auth, telemetry, network, AI, sync, or embedding dependencies; and no DropdownMenu or unrequested product components.

- [ ] **Step 3: Launch and manually verify the Tauri app**

Run `pnpm dev:desktop`. At the 800x500 minimum and default window sizes verify All Clips default, internal list/detail scrolling, no body horizontal/vertical scrollbar, search, create/edit Dialog, delete AlertDialog cancel/confirm, pin/unpin, copy, source open, counts, empty states, and privacy text. Resize between sizes and confirm no page-level scrolling.

- [ ] **Step 4: Stop before Milestone 5**

Report the final file list, generated components/support files, automated results, manual layout results, encountered layout fixes, behavior differences, known limitations, and recommended commit message `refactor(desktop): adopt shadcn UI components`.
