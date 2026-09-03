# shadcn Desktop UI Refactor Design

## Scope

Refactor only the existing Tauri desktop presentation to use the current
official shadcn/ui Vite setup with Tailwind CSS v4 and the `base-nova` style.
The refactor preserves all Milestone 3 desktop behavior and the completed
Milestone 4 extension behavior. It does not introduce Milestone 5 bridge work.

The desktop remains a local-first clip library rather than a generic dashboard.
Its information hierarchy stays focused on navigation, search, the clip list,
the selected clip, and local-first privacy information.

## Architecture

The existing application boundary remains unchanged:

```text
React presentation
  -> typed ClipClient
  -> narrow Tauri commands
  -> ClipService
  -> SQLite repository
```

shadcn/ui components remain presentation code owned by the desktop package.
They do not access `ClipClient`, Tauri, SQLite, or extension APIs. `App.tsx`
continues to own the existing view, selection, search, form, and operation state.

## Official shadcn setup

Configure the existing Vite application using:

- Tailwind CSS v4 through `@tailwindcss/vite`;
- the official shadcn CLI;
- the `base-nova` style;
- CSS variables;
- the existing `@/*` source alias;
- Lucide icons where a small, familiar icon improves hierarchy.

Add only the requested UI components:

- Button
- Input
- Textarea
- Select
- Dialog
- AlertDialog
- Card
- Badge
- Separator
- Sidebar
- ScrollArea
- Tooltip

Do not add DropdownMenu because every current clip action remains directly
discoverable. Support files generated as direct requirements of the official
Sidebar are permitted but must not create additional product features.

## Layout and interaction design

Use a fixed, non-collapsible shadcn Sidebar for All Clips, Pinned, their real
counts, and Settings & About. Keep the compact application title and search/New
Clip toolbar above the library workspace.

The main content keeps the existing list-detail structure:

- the clip list occupies the bounded left pane;
- the selected clip detail occupies the bounded right pane;
- each pane owns its scrolling through ScrollArea;
- empty, loading, and no-match states remain centered in the content region;
- the document body and application shell never become page-level scroll
  containers at the 800x500 minimum window size.

Create and edit open in one controlled Dialog. The existing form fields,
required-content validation, exact content preservation, optional metadata
normalization, full-replacement update semantics, saving state, and cancel
behavior remain unchanged.

Delete uses a controlled AlertDialog. The destructive operation runs only after
explicit confirmation. Cancel closes the alert without calling `ClipClient`.

Copy, pin/unpin, edit, delete, and open-source actions stay directly visible.
Cards, badges, separators, tooltips, and consistent button variants improve
spacing and hierarchy without changing what any action does.

## Theme

Preserve system-adaptive theming. Light tokens are the default. A
`prefers-color-scheme: dark` media query applies the refined dark shadcn tokens;
the application does not force a theme class or add theme state.

Both themes use calm neutral surfaces with a restrained teal accent. The dark
theme receives additional attention to surface separation, readable muted text,
focus rings, destructive states, and selected navigation/list states while
remaining consistent with the existing visual direction.

## Behavior preservation

The refactor must preserve:

- All Clips as the fresh-launch default;
- Pinned filtering;
- case-insensitive substring search;
- complete-list counts for All Clips and Pinned;
- manual create and full-replacement edit;
- deletion confirmation;
- pin and unpin;
- copy through the stored clip ID;
- source opening through the stored clip ID;
- loading, empty, filtered-empty, and pinned-empty states;
- safe error and copy-status messaging;
- local-first privacy and no-account/no-cloud messaging.

No `ClipClient`, Tauri command, Rust, SQLite, shared contract, extension, or
permission behavior changes are part of this work.

## Testing

Application behavior changes are test-first. Add failing React tests that prove:

- New Clip opens an accessible create Dialog;
- Edit opens the same Dialog with the existing values;
- cancel closes the Dialog without a mutation;
- Delete opens an AlertDialog;
- cancel does not delete;
- confirm deletes through the existing client call.

Retain and adapt the existing tests for navigation, search, create, edit,
pin/unpin, copy, source opening, counts, empty states, and privacy text. Generated
shadcn source and pure configuration are scaffolding and do not require bespoke
unit tests.

## Verification

Run the complete workspace tests, formatting check, lint, TypeScript typecheck,
desktop frontend build, extension compatibility build, Cargo check, and Tauri
build. Launch the desktop application and verify the existing workflow and the
800x500 layout without page-level horizontal or vertical scrolling.

## Explicit exclusions

- Milestone 5 extension-to-desktop bridge
- Tauri command or capability changes
- SQLite schema, repository, or service changes
- Extension code or manifest changes
- Cloud, authentication, telemetry, networking, sync, AI, or embeddings
- New product actions, settings, navigation destinations, or dashboard widgets
- Forced dark mode or a new theme switcher
- Dropdown menus, animations, or additional shadcn components without a direct
  generated dependency requirement
