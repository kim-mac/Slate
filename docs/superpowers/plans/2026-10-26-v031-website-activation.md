# Slate v0.3.1 Website Activation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for this approved inline preparation. Do not commit, push, publish, deploy, sign, build installers, or access production private keys in this checkpoint.

**Goal:** Prepare a reviewable v0.3.1 website/updater activation from production main without changing frozen desktop artifacts or either real-machine baseline.

**Architecture:** Keep release destinations centralized in the existing site data module; copy the already verified manifest byte-for-byte. Preserve the prior production manifest as a nonpublic recovery resource. Publication and activation are separate approval gates.
**Tech Stack:** Static Astro, TypeScript, Node tests, pinned pnpm, existing offline Gate A1 verifier.

## Approved inputs and production snapshot

- Base/remote main: `888f29a2a4cf1f0f7ad30a9d4ccb2d4609dc83a7`.
- New local branch: `codex/site-v031-activation`.
- Frozen desktop commit/tree: `abd997637dedf0955afa15fe68114eba8154ea56` / `8f1e9ce3e3ff930da9eef1bc30765d7cbcb77e33`.
- Frozen artifacts: `dist/release/v0.3.1/public-build-abd9976-15d23b/artifacts` in the separate production-integration worktree.
- Existing manifest draft: `independent-gate-a1-031-WBRAWh/validation-only-manifest.json` in that build run; 1,235 bytes; SHA256 `61E89026D261AAB5EF2E88C0C9384BE860A64F4863F0FAF0E1EE5CD7BDB5D44B`.
- Current live production: Cloudflare Pages project `slate`, deployment `062ada7b-d604-4855-8c5e-d5b4aec83a93`, https://062ada7b.slate-42x.pages.dev, successful deployment of base commit above, completed 2026-10-25T21:33:05.898412Z.
- Live manifest remains 0.3.0, SHA256 `C12D5475652AFE4269A9A826B26705A4D936EFA2A6DC893DD1EB5F7190ED0B05`; apex HTTP 200, JSON/no-store; www redirects to apex.
- Production main pushes automatically deploy. Other branch pushes automatically create previews. No push occurs during preparation.

## Preparation tasks

- [x] Verify ignored worktree location, absent branch/path, exact remote main, then create the new worktree from the approved base.
- [x] Install scoped dependencies with `corepack pnpm install --frozen-lockfile --filter @slate/site --filter ai-clip-memory --ignore-scripts`.
- [x] Build and run the unchanged 90-test website baseline.
- [x] Pin the v0.3.1 filenames, installer hashes, platform URLs, version and manifest hash in existing release/download/readiness/update tests; add preserved-v0.3.0 recovery-contract coverage. Observe expected failures against baseline metadata.
- [x] Update only active site release metadata; preserve extension 0.1.1, disabled macOS, Chrome listing, updater headers and all page interactions.
- [x] Copy the old manifest to `docs/releases/v0.3.1/recovery/latest-0.3.0.json`, verifying its original hash. Copy the verified v0.3.1 draft to `apps/site/public/updates/windows/latest.json` without JSON reserialization.
- [x] Draft `docs/RELEASE_NOTES_0.3.1.md`; update site README's current-version/deployment statements, preserving historical recovery facts.
- [x] Prepare the separate publication, backup and recovery instructions referenced below.
- [x] Run site check, lint, formatting, build, tests and whitespace checks. Authenticate source and built manifests using the pinned production public key and exact frozen installers. Recheck frozen and live hashes, unchanged source worktrees and complete diff.
- [x] Stop with all changes uncommitted and index empty.

## Required validation commands

Run from this activation worktree with Node 22.16.0, pnpm 11.19.0:

```powershell
$env:ASTRO_TELEMETRY_DISABLED = '1'
corepack pnpm --filter @slate/site check
corepack pnpm --filter @slate/site lint
corepack pnpm --filter @slate/site format:check
corepack pnpm --filter @slate/site build
corepack pnpm --filter @slate/site test
git diff --check
```

The source/built manifest Gate A1 check must use version 0.3.1, the retained approved artifacts, the public-key snapshot and the existing trusted verifier. It does not use private keys or access installed databases.

## Approval and publication boundary

This file is an implementation/preparation record, not authorization to execute publication. See `docs/releases/v0.3.1/ACTIVATION-CHECKLIST.md` for the staged publication sequence and `MIGRATION-BACKUP.md` alongside it for future manual cold backups. Never replace current production main with the older website tree in the frozen desktop integration.
