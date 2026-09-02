# Step-by-Step Build Plan

Build in this order.

Do not skip ahead unless an earlier milestone is complete.

---

# Milestone 0 — Repository foundation

Goal:
Create a clean monorepo that can host both applications.

Deliverables:
- pnpm workspace
- `apps/desktop`
- `apps/extension`
- `packages/shared`
- formatting/linting/typechecking
- root README
- basic scripts

Success criteria:
- dependencies install cleanly
- desktop dev app launches
- extension builds
- shared package can be imported

Do not implement product features yet.

---

# Milestone 1 — Desktop shell

Goal:
Create the basic Windows desktop UI.

Deliverables:
- Tauri + React application
- main window
- minimal navigation
- search input
- empty-state clip list
- privacy text in settings/about area

Suggested layout:

```text
┌────────────────────────────────────────────────────┐
│ Search clips...                                    │
├─────────────┬──────────────────────────────────────┤
│ All Clips   │                                      │
│ Pinned      │     No clips yet                     │
│             │                                      │
│             │     Save something from your         │
│             │     browser to see it here.          │
└─────────────┴──────────────────────────────────────┘
```

Success criteria:
- app launches reliably
- UI works on Windows
- no database yet required

---

# Milestone 2 — Local SQLite storage

Goal:
Make clips persistent locally.

Deliverables:
- SQLite setup
- migration system
- `clips` table
- repository/service layer
- create/read/update/delete operations
- seed/dev helper only if useful

Success criteria:
- adding a test clip persists across app restart
- edit/delete/pin work at data layer
- no network required

---

# Milestone 3 — Desktop clip library

Goal:
Connect UI to SQLite.

Deliverables:
- clip list
- clip detail/preview
- create local clip manually
- edit
- delete
- pin/unpin
- copy to clipboard
- open source URL
- search

Success criteria:
A user can manage a useful clip library entirely inside the desktop application.

---

# Milestone 4 — Browser extension capture

Goal:
Capture selected browser text.

Start with the simplest reliable UX:
- highlight text
- right click
- `Save to <app>`

Deliverables:
- Manifest V3 extension
- context menu
- selected-text capture
- page URL capture
- page title capture
- source detection:
  - ChatGPT
  - Claude
  - Gemini
  - Other Web

At this stage it may log/show the captured payload locally in the extension for development.

Success criteria:
The extension correctly creates a structured clip payload from a browser selection.

---

# Milestone 5 — Local extension ↔ desktop bridge

Goal:
Save extension captures into the desktop SQLite database.

Preferred:
- Native Messaging

Fallback for MVP:
- secured localhost bridge

Deliverables:
- local communication channel
- payload validation
- desktop save handler
- extension success/error feedback

Success criteria:
1. Highlight text in ChatGPT.
2. Choose `Save to <app>`.
3. Open desktop app.
4. The clip is there.
5. Disconnect internet and repeat successfully.

This is the first real MVP-complete moment.

---

# Milestone 6 — Retrieval polish

Goal:
Make the product something you can genuinely use daily.

Deliverables:
- better search
- keyboard navigation
- copy shortcut
- pinned clips
- recent ordering
- empty/loading/error states
- duplicate-save handling if needed
- lightweight notifications/toasts

Optional:
- SQLite FTS5

Success criteria:
Finding and copying a clip should take only a few seconds.

---

# Milestone 7 — Quick launcher

Goal:
Add the Copper/Raycast-style experience.

Deliverables:
- global keyboard shortcut
- compact quick-search window
- type to filter
- arrow-key navigation
- Enter to copy
- optional action menu

Do not attempt direct injection/paste into arbitrary apps yet unless stable.

Success criteria:
From anywhere in Windows:
1. invoke shortcut
2. search
3. select
4. copy

---

# Milestone 8 — Floating browser save UI

Goal:
Improve saving UX beyond context menu.

Deliverables:
- selection detection
- subtle floating Save button
- no interference with site UI
- support at minimum ChatGPT/Claude/Gemini

Keep context-menu capture as a fallback.

---

# Post-MVP backlog

Only consider these after actual daily usage:

- tags
- collections
- prompt type
- code-specific rendering
- direct paste into active app
- Context Packs
- local semantic search
- AI categorization
- optional encrypted account sync
- user-managed OneDrive/Dropbox folder sync
- import/export
- mobile companion

Do not implement them prematurely.
