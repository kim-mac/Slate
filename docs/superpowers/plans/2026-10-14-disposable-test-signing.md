# Disposable TEST signing preparation plan

**Goal:** Prepare a manual, encrypted, worktree-local signing ceremony; stop before generating any key.

**Architecture:** Offline Node preparation/verification tooling, explicit pinned Tauri CLI manual commands, existing Gate A1 public-only verifier. No application, installer, endpoint, secret or production configuration changes.

**Scope:** Two new tooling/test files, a ceremony document and this plan. Existing pending updater work remains intact. No commits or delegation.

- [x] Inspect pinned CLI help/source and existing Gate A1 entry points.
- [x] Snapshot existing pending source, main state and protected artifact hashes.
- [x] Write tests first; confirm the missing-tool assertion fails.
- [x] Implement synthetic-only preparation and ten-check Gate A1 matrix.
- [x] Test exclusive creation, environment isolation, links, baseline failures and production exclusion.
- [x] Document manual directory ACL review, masked generation, empty-password rejection plus positive probe, version-bound signing and safe disposal limitations.
- [x] Run combined offline tests, checked-JavaScript typecheck, ESLint, formatting and diff checks.
- [x] Compare all snapshot hashes, inspect scope and report; do not generate keys or sign.
