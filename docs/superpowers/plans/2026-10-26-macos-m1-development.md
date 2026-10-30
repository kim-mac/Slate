# macOS M1 Isolated Development Implementation Plan

> P1 correction addendum (2026-10-26): the packaging issue below is corrected locally by restoring the exact shipped host target. Mac development may bundle that host only with a compile-time, standard-library-only unavailable entry point. Actual Tauri-rendered Windows NSIS inputs and direct invocation tests cover this boundary. The earlier review remains historical; no publication or CI execution is authorized by these local results.

> Review addendum (2026-10-26): the initial local validation did not cover Tauri's Windows binary-selection semantics. The new host feature gate requires correction before commit/push/CI. Workflow commands, source pinning, evidence-only retention and CI limits are prepared for review in `docs/MACOS-M1-DEVELOPMENT.md`; these are proposals, not executed CI results. Historical completion marks below record the initial implementation work, not approval to publish it.

> Execute the approved M1 scope using test-driven development and focused review. User restrictions override commit/push steps: leave all work uncommitted; do not launch apps, trigger CI, publish, sign production artifacts, or modify other worktrees.

**Goal:** Prepare a fail-closed macOS 14+ debug application and a locally reviewable two-architecture CI workflow, preserving the shipped Windows source.

**Architecture:** Start at desktop commit `abd997637dedf0955afa15fe68114eba8154ea56`, tree `8f1e9ce3e3ff930da9eef1bc30765d7cbcb77e33`. Add an explicit debug-only `macos-dev` feature and an automatically merged macOS overlay. Validate the complete effective configuration before any window, storage, or plugin startup. Share the already-inert UX updater module; leave Windows production and UX behavior intact. Keep Native Messaging inactive in the Mac feature and report Quick Search/autostart unavailable.

**Tech stack:** Existing Tauri 2.12.3 / CLI 2.12.2, Rust 1.98.0, React/Vite, Node 22.16.0, pnpm 11.19.0. Reuse the already-locked libc package directly for macOS account/filesystem checks; no new dependency packages.

## Contracts

- Product: `Slate macOS Development`; identifier: `com.aiclipmemory.desktop.macos-dev`.
- Main window: `main`, title clearly marked development, initially `create: false` and hidden until runtime guard passes.
- Stable isolated WKWebView store: `[83,108,97,116,101,77,49,68,101,118,83,116,111,114,101,49]` shared only within this development profile.
- Data: the exact OS application-data path for the development identifier; reject aliases, wrong ownership, unsafe permissions and symlink ancestry. Database remains `clips.sqlite3`; migrations 0001–0003 remain unchanged.
- macOS minimum deployment target 14.0; `.app` target only; ad-hoc identity `-`; no production signing or notarization credentials.
- Empty updater public key/endpoints; inert native updater selected at compile time. No autostart or browser host registration. The shipped host target is unconditional; its entire entry point is compiled as exit-code-78-only under `macos-dev`, with no production imports or I/O.
- Missing feature on macOS, feature on Windows/release, mixed UX features, bad identity/configuration or unsafe profile must fail before initialization.

## Tasks and evidence

- [x] Establish clean source/tree and disk baseline, install scoped locked dependencies without scripts, run desktop/extension baseline tests.
- [x] Add failing Node configuration/security tests and standalone standard-library Rust policy tests before implementation. Cover wrong identifiers, updater leakage, unsafe store/window settings, source isolation and unsupported operations.
- [x] Add `tauri.macos.conf.json`, a PNG frame from the existing Slate icon for Tauri's ICNS conversion, `src/macos_dev/{mod,policy,config}.rs`, and narrow feature routing in Cargo/lib/native-host/build safeguards. Preserve the Windows base config and existing Windows platform modules byte-for-byte.
- [x] Implement a strict configuration/profile guard and runtime receipt in the development directory. Keep storage and WKWebView identity separate; use no production SQLite or registry paths. Share the existing inert updater implementation without changing its Windows semantics.
- [x] Prepare `scripts/macos/m1.mjs`, focused Node tests, `.github/workflows/macos-m1.yml`, and `docs/MACOS-M1-DEVELOPMENT.md`. Workflow is manual dispatch only, runs `macos-15` / `macos-15-intel`, uses pinned tooling and dependency-only caches, no secrets/releases/website deployment. Artifact inspection must allow only the explicitly identified ad-hoc debug bundle and public receipt.
- [x] Validate on Windows: Node security/configuration tests, desktop and extension tests, TypeScript, ESLint, Prettier, Rust formatting, frontend build and a single disk-bounded Windows Rust validation target. Do not write caches to existing worktrees or delete any caches.
- [x] Review Windows updater/native messaging/NSIS/migrations/protocol preservation, full diff and other-worktree source fingerprints. Report exact counts, paths, disk delta, and all Mac CI/runtime limitations.

## Commands

From this worktree, use `corepack pnpm install --frozen-lockfile --filter @ai-clip-memory/desktop --filter @ai-clip-memory/extension --filter ai-clip-memory --ignore-scripts`, then the existing filtered test/typecheck/build commands. New checks are `node --test scripts/macos/*.test.mjs`, `node scripts/macos/m1.mjs validate`, and `node scripts/macos/m1.mjs rust-policy-tests`.

For Windows Rust validation, explicitly use this worktree's `dist/test/macos-m1/windows-cargo`, `CARGO_INCREMENTAL=0`, and test/dev debug symbols disabled only in that command environment. Reuse global downloaded dependencies, never a release/rehearsal target directory. Run no production build or installer command.

macOS CI must run locked debug Cargo tests and `tauri build --debug --features macos-dev --target <native-apple-target> --bundles app -- --no-default-features --locked`. It must inspect version, deployment target, identity, main executable architecture and ad-hoc signing. A build is not a successful launch: WKWebView, UI focus, clipboard, persistence and Dock behavior remain physical-Mac gates.

## Stop boundary

No commits, pushes, CI dispatch, production credentials, app launch or data access. Preserve the new worktree for review and distinguish local PASS results from pending macOS CI and physical hardware validation.
