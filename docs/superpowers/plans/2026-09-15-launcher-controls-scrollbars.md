# Launcher Controls and Scrollbars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a visible launcher drag affordance, a close button, a simpler footer, and modern vertical-only scrollbars without changing launcher lifecycle or copy behavior.

**Architecture:** Keep all behavior in the existing `LauncherSession` and reuse its `hide()` path for the new close button. Replace launcher-native overflow containers with the existing shared shadcn/Base UI `ScrollArea`, relying on the packaged `.base-ui-disable-scrollbar` rules to suppress native Chromium scrollbars.

**Tech Stack:** React, TypeScript, lucide-react, shadcn/Base UI ScrollArea, Vitest, Testing Library, CSS.

---

### Task 1: Lock the approved launcher behavior with failing tests

**Files:**
- Modify: `apps/desktop/src/launcher/Launcher.test.tsx`
- Modify: `apps/desktop/src/launcher/launcherCss.test.ts`

- [ ] **Step 1: Add failing interaction and structure tests**

Add tests that express the approved behavior before changing production code:

```tsx
test('shows a drag affordance and closes through the existing hide path', async () => {
  const { host, client } = setup();
  await screen.findByRole('option', { name: /Recent note/ });

  const handle = document.querySelector('.launcher-drag-handle');
  expect(handle).not.toBeNull();
  expect(handle?.getAttribute('aria-hidden')).toBe('true');
  expect(handle?.hasAttribute('data-tauri-drag-region')).toBe(true);

  fireEvent.click(screen.getByRole('button', { name: 'Close Quick Search' }));

  await waitFor(() => expect(host.hide).toHaveBeenCalledWith(1));
  expect(client.copyContent).not.toHaveBeenCalled();
});

test('removes the Local only footer copy and uses shared scroll areas', async () => {
  setup();
  await screen.findByRole('option', { name: /Recent note/ });

  expect(screen.queryByText(/Local only/)).toBeNull();
  expect(
    document.querySelectorAll('[data-slot="scroll-area"]').length,
  ).toBeGreaterThanOrEqual(2);
  expect(
    document.querySelectorAll('[data-slot="scroll-area-viewport"]').length,
  ).toBeGreaterThanOrEqual(2);
});
```

Extend the stylesheet regression test so launcher-specific containers cannot silently return to native scrolling:

```ts
test('delegates launcher scrolling to the shared custom ScrollArea', () => {
  expect(stylesheet).not.toMatch(
    /\.launcher-results\s*\{[^}]*overflow:\s*auto/s,
  );
  expect(stylesheet).toMatch(
    /\.launcher-results-content\s*\{[^}]*padding-right:\s*12px/s,
  );
  expect(stylesheet).toMatch(
    /\.launcher-preview-scroll\s*\{[^}]*height:\s*5\.25em/s,
  );
});

test('uses a background-only hover state for unselected pointer results', () => {
  expect(stylesheet).toMatch(
    /@media\s*\(hover:\s*hover\)[^{]*\{[\s\S]*\.launcher-result:not\(\[aria-selected='true'\]\):hover\s*\{[^}]*background:/,
  );
});
```

- [ ] **Step 2: Run focused tests and verify the new assertions fail**

Run:

```powershell
pnpm --filter @ai-clip-memory/desktop test -- --run src/launcher/Launcher.test.tsx src/launcher/launcherCss.test.ts
```

Expected: FAIL because the drag handle, close button, custom scroll-area roots, and revised footer/CSS do not exist yet.

### Task 2: Implement the drag handle, close control, footer cleanup, and custom scrolling

**Files:**
- Modify: `apps/desktop/src/launcher/Launcher.tsx`
- Modify: `apps/desktop/src/launcher/launcher.css`
- Test: `apps/desktop/src/launcher/Launcher.test.tsx`
- Test: `apps/desktop/src/launcher/launcherCss.test.ts`

- [ ] **Step 1: Add the existing ScrollArea and approved icons**

Update imports in `Launcher.tsx`:

```tsx
import { AppWindow, GripVertical, X } from 'lucide-react';
import { ScrollArea } from '../components/ui/scroll-area';
```

- [ ] **Step 2: Render a visible drag affordance and accessible close button**

Replace the header contents with the existing drag region plus the approved controls:

```tsx
<header className="launcher-header" data-tauri-drag-region>
  <span className="launcher-heading" data-tauri-drag-region>
    <GripVertical
      className="launcher-drag-handle"
      aria-hidden="true"
      data-tauri-drag-region
    />
    <span data-tauri-drag-region>Quick Search</span>
  </span>
  <div className="launcher-header-actions">
    <Button
      variant="outline"
      size="icon-sm"
      aria-label="Open Tin"
      title="Open Tin"
      disabled={busy}
      onClick={() => void openTin()}
    >
      <AppWindow aria-hidden="true" />
    </Button>
    <Button
      variant="outline"
      size="icon-sm"
      aria-label="Close Quick Search"
      title="Close Quick Search"
      onClick={() => void hide()}
    >
      <X aria-hidden="true" />
    </Button>
  </div>
</header>
```

Do not disable the close button while copying or opening Tin: Escape already uses `hide()` in those states, so the button must preserve identical behavior.

- [ ] **Step 3: Replace native results scrolling with the shared ScrollArea**

Change the results wrapper from a plain `div` to:

```tsx
<ScrollArea
  className="launcher-results"
  id="launcher-results"
  role="listbox"
  aria-label="Clips"
  aria-busy={loading || busy}
>
  {/* existing loading, error, empty, and result rendering */}
</ScrollArea>
```

Keep all existing state branches and result semantics unchanged.

- [ ] **Step 4: Use a compact custom ScrollArea for the selected preview**

Render the selected result's complete content through the shared component while leaving unselected previews compact:

```tsx
{clip.id === selected?.id ? (
  <ScrollArea className="launcher-preview launcher-preview-scroll">
    <span className="launcher-preview-content">{clip.content}</span>
  </ScrollArea>
) : (
  <div className="launcher-preview">{clipPreview(clip.content)}</div>
)}
```

The content remains ordinary selectable text; no clipboard or pointer handler is added.

- [ ] **Step 5: Remove only the Local only footer wording**

Update the idle footer status expression to:

```tsx
`${results.length} ${results.length === 1 ? 'clip' : 'clips'}`
```

Preserve `Copying…`, `Copied`, and all keyboard hints.

- [ ] **Step 6: Align CSS with the shared scrollbar and header controls**

Update `launcher.css` with focused rules:

```css
.launcher-heading {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.launcher-drag-handle {
  width: 14px;
  height: 14px;
  flex: none;
  pointer-events: none;
  cursor: grab;
}
.launcher-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.launcher-results {
  flex: 1;
  min-height: 0;
  overscroll-behavior: contain;
}
.launcher-results-content {
  padding-right: 12px;
}
.launcher-preview-scroll {
  height: 5.25em;
}
.launcher-preview-content {
  display: block;
  padding-right: 10px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
@media (hover: hover) {
  .launcher-result:not([aria-selected='true']):hover {
    background: color-mix(in srgb, var(--accent) 60%, transparent);
  }
}
```

Remove `overflow: auto` from `.launcher-results` and the selected-preview native overflow rule. Keep `user-select: text` and `cursor: text` on preview content. Do not alter the shared `ScrollArea` primitive or global scrollbar suppression.

- [ ] **Step 7: Run focused tests and verify they pass**

Run:

```powershell
pnpm --filter @ai-clip-memory/desktop test -- --run src/launcher/Launcher.test.tsx src/launcher/launcherCss.test.ts
```

Expected: all focused launcher tests PASS.

### Task 3: Require explicit launcher selection

**Files:**
- Modify: `apps/desktop/src/launcher/Launcher.test.tsx`
- Modify: `apps/desktop/src/launcher/Launcher.tsx`

- [ ] **Step 1: Add failing explicit-selection coverage**

Add a test that proves the launcher has no initial active option, Enter is inert, and first/last keyboard entry works:

```tsx
test('starts unselected and enters results explicitly from either direction', async () => {
  const { client } = setup();
  const search = await screen.findByRole('searchbox');
  const options = await screen.findAllByRole('option');

  expect(options.every((option) => option.getAttribute('aria-selected') === 'false')).toBe(true);
  expect(search.getAttribute('aria-activedescendant')).toBeNull();
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(client.copyContent).not.toHaveBeenCalled();

  fireEvent.keyDown(search, { key: 'ArrowDown' });
  expect(options[0]?.getAttribute('aria-selected')).toBe('true');

  fireEvent.change(search, { target: { value: ' ' } });
  fireEvent.keyDown(search, { key: 'ArrowUp' });
  expect(options.at(-1)?.getAttribute('aria-selected')).toBe('true');
});
```

Update existing copy, retry, IME, and navigation tests so they explicitly select a result before expecting Enter to copy. After a query change, assert Enter remains inert until Down selects the filtered result.

- [ ] **Step 2: Run the launcher tests and verify the new behavior fails**

```powershell
pnpm --filter @ai-clip-memory/desktop test -- --run src/launcher/Launcher.test.tsx
```

Expected: FAIL because the first result is still implicitly selected.

- [ ] **Step 3: Remove the implicit selection fallback**

Change the selected result calculation to:

```tsx
const selected = selectedId
  ? results.find((clip) => clip.id === selectedId)
  : undefined;
```

For arrow navigation, use explicit entry behavior when the current index is `-1`:

```tsx
const index = results.findIndex((clip) => clip.id === selected?.id);
const next =
  index === -1
    ? event.key === 'ArrowDown'
      ? 0
      : results.length - 1
    : Math.max(
        0,
        Math.min(
          results.length - 1,
          index + (event.key === 'ArrowDown' ? 1 : -1),
        ),
      );
setSelectedId(results[next]?.id ?? null);
```

Keep the existing Enter guard on `selected`, so Enter naturally does nothing before explicit selection.

- [ ] **Step 4: Run launcher tests and verify they pass**

```powershell
pnpm --filter @ai-clip-memory/desktop test -- --run src/launcher/Launcher.test.tsx
```

Expected: all launcher and desktop tests PASS.

### Task 4: Run launcher regression and repository gates

**Files:**
- Verify only; no expected source changes.

- [ ] **Step 1: Run the complete desktop React suite**

```powershell
pnpm --filter @ai-clip-memory/desktop test -- --run
```

Expected: all desktop test files and tests PASS.

- [ ] **Step 2: Run formatting, lint, and typechecking**

```powershell
pnpm exec prettier --check .
pnpm lint
pnpm typecheck
```

Expected: all commands exit 0.

- [ ] **Step 3: Build the production desktop frontend**

```powershell
pnpm --filter @ai-clip-memory/desktop build
```

Expected: TypeScript and Vite production build exit 0 and emit both main and launcher bundles.

- [ ] **Step 4: Verify the untouched native boundary still compiles**

```powershell
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --all -- --check
```

Expected: both commands exit 0 with no source changes.

- [ ] **Step 5: Verify diff hygiene and scope**

```powershell
git diff --check
git status --short
git diff --name-status
```

Expected: only launcher React/CSS/tests and the approved planning documents are changed; no Rust, capability, dependency, lockfile, persistence, extension, or generated build artifact changes.

### Task 5: Manual launcher verification and checkpoint

**Files:**
- Verify only; no expected source changes.

- [ ] **Step 1: Manually verify the approved launcher behavior on Windows**

Confirm:

- the six-dot handle clearly identifies the draggable region;
- dragging from the handle/title/empty header moves the launcher;
- Open Tin and Close Quick Search do not initiate dragging;
- X and Escape both hide the launcher without quitting Tin or changing the clipboard;
- the footer no longer says **Local only**;
- the results list shows only the shadcn scrollbar;
- the expanded preview shows only the shadcn scrollbar;
- the results scrollbar sits in a right gutter instead of overlapping selected cards;
- unselected clips gain a subtle background on pointer hover without gaining the selected border;
- the launcher opens with no selected or expanded clip;
- Enter does nothing before selection, Down selects the first result, and Up selects the last result;
- both scroll areas are vertical-only and mouse wheel/trackpad scrolling remains usable;
- clip text remains selectable and Ctrl+C copies only the selection;
- Enter still copies the whole selected clip and keeps the launcher open;
- light and dark appearance remain consistent.

- [ ] **Step 2: Create one implementation commit after approval**

```powershell
git add -- apps/desktop/src/launcher/Launcher.tsx apps/desktop/src/launcher/launcher.css apps/desktop/src/launcher/Launcher.test.tsx apps/desktop/src/launcher/launcherCss.test.ts
git commit -m "feat(launcher): refine controls and scrolling"
```

Expected: one scoped implementation commit; do not push or merge without explicit user instruction.
