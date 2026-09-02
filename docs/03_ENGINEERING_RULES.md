# Engineering Rules for Codex

These rules are mandatory.

## General

- Prefer simple implementations.
- Do not add dependencies without a clear need.
- Do not rewrite unrelated files.
- Preserve working behavior.
- Keep changes scoped to the current milestone.
- Prefer readable code over clever abstractions.
- Avoid premature microservices or backend infrastructure.

## Before coding

For every milestone:
1. Inspect the repo.
2. Read the project docs.
3. State assumptions.
4. List the files expected to change.
5. Then implement.

## After coding

Always:
- run formatter
- run lint
- run typecheck
- run tests if present
- run desktop build/check
- run extension build

Fix errors before declaring the milestone complete.

## TypeScript

- Use strict TypeScript.
- Avoid `any`.
- Prefer explicit interfaces/types for cross-boundary data.
- Validate data received from the extension/local bridge.

## React

- Keep components focused.
- Avoid huge all-in-one components.
- Keep business/database logic outside UI components.
- Prefer controlled, understandable state before introducing a global state library.

## Tauri

- Keep privileged operations in Rust/Tauri commands when appropriate.
- Do not allow arbitrary shell execution.
- Minimize permissions/capabilities.
- Treat browser-extension input as untrusted.

## SQLite

- Use migrations from the beginning.
- Never concatenate user input into SQL.
- Keep database access in a dedicated module/repository layer.

## Extension

- Manifest V3.
- Request the minimum permissions necessary.
- Do not request broad host permissions unless required.
- Do not scrape entire conversations in the MVP.
- Capture only what the user explicitly selects/saves.

## UI

- Optimize for speed.
- Keyboard interaction matters.
- Do not over-design.
- Do not introduce complex animations before the workflow works.

## Privacy

No network request should contain clip content in the MVP.

If any dependency or feature would cause captured content to leave the computer, stop and flag it rather than implementing it.

## Git

Make milestone-sized commits.

Suggested commit style:

```text
feat(desktop): initialize Tauri shell
feat(clips): add SQLite clip repository
feat(extension): capture selected text
feat(bridge): save extension clips locally
```

## Cross-platform rule

Do not place Windows-specific logic directly inside shared UI or business logic.

If functionality depends on the operating system, expose it through a small platform abstraction.

Windows is the only platform that needs to work during the MVP, but the codebase should not make future macOS support unnecessarily difficult.
