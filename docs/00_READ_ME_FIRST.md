# AI Clip Memory — Read Me First

This folder is the source of truth for the project.

Before making changes, Codex should read these files in order:

1. `01_PRODUCT_SPEC.md`
2. `02_ARCHITECTURE.md`
3. `03_ENGINEERING_RULES.md`
4. `04_BUILD_PLAN.md`
5. `05_CODEX_WORKFLOW.md`

## Core product idea

Build a local-first Windows application plus a Chrome/Edge browser extension that lets a user save useful pieces of AI conversations and retrieve/reuse them later.

The product should feel like a fast personal memory layer for AI, not like a traditional notes app.

Core loop:

**SEE → SAVE → FIND → REUSE**

## Non-negotiable principles

- Local-first.
- No account required.
- No cloud required.
- User data stays on the user's machine by default.
- Cloud sync, if added later, must be optional.
- Browser extension and Windows app should communicate locally.
- Saving a clip must feel instant.
- The MVP should stay small.
- Do not add AI features, accounts, billing, collaboration, or cloud sync until the local MVP is complete.

## Development rule

Do not try to build the whole product in one pass.

Work milestone-by-milestone from `04_BUILD_PLAN.md`.

At the start of each milestone:
1. Inspect the existing repo.
2. Explain the exact files you plan to add/change.
3. Implement only that milestone.
4. Run tests/build/lint.
5. Fix errors.
6. Summarize what changed and what remains.
