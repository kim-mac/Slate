# Slate — Read Me First

This folder contains current guidance alongside the original MVP design history.
Use the repository source/tests and the relevant release tag for implemented
behavior; `02_ARCHITECTURE.md` also contains original design history.
[DEVELOPMENT.md](DEVELOPMENT.md) explains current setup
and source/release boundaries. `RELEASE_CHECKLIST.md` and the original 0.1.0 notes
are first-release history, not current publication instructions. A draft release
note is not proof that its version is available.

The following original MVP documents remain useful background, not a statement
that every proposal or milestone is still current:

1. `01_PRODUCT_SPEC.md`
2. `02_ARCHITECTURE.md`
3. `03_ENGINEERING_RULES.md`
4. `04_BUILD_PLAN.md`
5. `05_CODEX_WORKFLOW.md`

## Current implemented architecture

Browser captures pass through the extension background/service worker and Chrome
Native Messaging to the installed native host. That host writes directly through
the shared Rust persistence implementation to local SQLite; it does not relay
writes through the desktop GUI. The desktop reads the same local library.

Persistent Merge uses `clip_groups` and `clip_group_members` alongside original
`clips` rows, introduced by the additive transactional V1 → V2 migration.
Public Desktop 0.3.1 also includes automatic source grouping with schema 3.
Current public versions are Desktop `0.3.1` and extension `0.1.1`; verify the
[latest official release](https://github.com/kim-mac/Slate/releases/latest).
Production website main and frozen desktop release source are separate lines.
Local branch metadata and unreleased plans must not be presented as public releases.
Historical localhost transport, original single-table designs, and future
cloud/semantic-search proposals below or in linked plans are not current V1
features.

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

## Historical MVP development workflow

Do not try to build the whole product in one pass.

`04_BUILD_PLAN.md` records the original milestone plan. For new work, use the
approved task scope and current source rather than treating completed milestones
as an active implementation queue.

At the start of each milestone:

1. Inspect the existing repo.
2. Explain the exact files you plan to add/change.
3. Implement only that milestone.
4. Run tests/build/lint.
5. Fix errors.
6. Summarize what changed and what remains.
