# Slate v0.3.1 publication and activation checklist

**Preparation only — uncommitted and not deployed.** Every remote write and production activation below needs separate explicit authorization. Keep both real machines on v0.3.0 until activation is approved.

## Recorded identities

- Current production main: `888f29a2a4cf1f0f7ad30a9d4ccb2d4609dc83a7`.
- Cloudflare Pages project `slate`, production branch `main`, GitHub repository `kim-mac/Slate`.
- Current successful production deployment: `062ada7b-d604-4855-8c5e-d5b4aec83a93`, https://062ada7b.slate-42x.pages.dev, completed 2026-10-25T21:33:05.898412Z.
- Production domains: https://tryslate.tech and https://www.tryslate.tech (canonical redirect to apex).
- Frozen desktop commit/tree: `abd997637dedf0955afa15fe68114eba8154ea56` / `8f1e9ce3e3ff930da9eef1bc30765d7cbcb77e33`.
- Production public-key fingerprint: `2641A4781B6B0004D449EE4DE626E8378A87AC89C3800A405972F0ACAA59AFC9`.
- Proposed manifest: `apps/site/public/updates/windows/latest.json`, 1,235 bytes, SHA256 `61E89026D261AAB5EF2E88C0C9384BE860A64F4863F0FAF0E1EE5CD7BDB5D44B`.
- Prior manifest: [recovery/latest-0.3.0.json](recovery/latest-0.3.0.json), SHA256 `C12D5475652AFE4269A9A826B26705A4D936EFA2A6DC893DD1EB5F7190ED0B05`. Recovery file is not under site/public and must not be deployed as another update channel.

Frozen assets, in the existing production-integration worktree's `dist/release/v0.3.1/public-build-abd9976-15d23b/artifacts`:

| Filename                          |   Bytes | SHA256                                                           |
| --------------------------------- | ------: | ---------------------------------------------------------------- |
| Slate-0.3.1-Windows-ARM64.exe     | 5061666 | 16630847830DC275B07751197CEC10B63E0356D5ED6E18820EE045367B59E6B8 |
| Slate-0.3.1-Windows-x64.exe       | 5960178 | 98726C7C7549B6112DB84657E8AE8F8D54DFD22909C85EB854E021884176DAE8 |
| Slate-0.3.1-Windows-ARM64.exe.sig |     440 | 0FC40C1CB2713C420588B226E288462AFD2B02FDF101B014D749DCBAECBD4044 |
| Slate-0.3.1-Windows-x64.exe.sig   |     436 | 7E2D569407D9C03E63EE9AAC176F49C65CF40607395CA80FD21A35391861CAF9 |
| SHA256SUMS.txt                    |     190 | 44DF89584DF82CEB7FAD8A8F899BB6FA5BFAAB2092413BA000365574908B06E9 |

## Gate A — review local preparation

- [ ] Review release notes at `docs/RELEASE_NOTES_0.3.1.md`, including pending public-update verification and Unknown Publisher wording.
- [ ] Review the complete activation diff. Only site release metadata/manifest, active release assertions, README and release preparation/recovery documents may change.
- [ ] Recheck exact source/built manifest bytes, both platform mappings, detached signatures and production fingerprint with Gate A1.
- [ ] Run all website checks; do not weaken integrity pins to make tests pass.
- [ ] Ensure recovery manifest stays outside public/build output and no installers, signing material, databases or private endpoints are included.
- [ ] Obtain separate approval before making any activation-source commit. Record its exact commit/tree before asking to deploy.
- [ ] Do not push this activation branch or main yet: Pages previews are enabled for every branch, and the prepared 0.3.1 download links must not be exposed before the release assets are public.

## Gate B — frozen source and DRAFT GitHub release

Prerequisite: explicit source-ref/tag/draft/upload approval. Stop on any conflicting remote ref or existing release; never force or move tags. The source branch below is separate from production main.

```powershell
# From the frozen production-integration worktree, after rechecking hashes/clean source:
git -c push.followTags=false push origin abd997637dedf0955afa15fe68114eba8154ea56:refs/heads/codex/v031-production-integration
git -c push.followTags=false push origin abd997637dedf0955afa15fe68114eba8154ea56:refs/tags/v0.3.1
```

The branch push automatically triggers a Cloudflare **preview** build of that older site tree. Authorization must include this side effect; production remains on main. Do not merge that desktop integration into main or use its website files for activation.

Once GitHub resolves the commit/tag, in the activation worktree:

```powershell
$notes = Join-Path (Get-Location).Path 'docs/RELEASE_NOTES_0.3.1.md'
$artifacts = 'C:\Users\kim16\Documents\ChatGPT\Tin\.worktrees\codex-v031-production-integration\dist\release\v0.3.1\public-build-abd9976-15d23b\artifacts'
gh release create v0.3.1 --repo kim-mac/Slate --verify-tag --target abd997637dedf0955afa15fe68114eba8154ea56 --draft --title 'Slate v0.3.1' --notes-file $notes
gh release upload v0.3.1 --repo kim-mac/Slate `
  (Join-Path $artifacts 'Slate-0.3.1-Windows-x64.exe') `
  (Join-Path $artifacts 'Slate-0.3.1-Windows-x64.exe.sig') `
  (Join-Path $artifacts 'Slate-0.3.1-Windows-ARM64.exe') `
  (Join-Path $artifacts 'Slate-0.3.1-Windows-ARM64.exe.sig') `
  (Join-Path $artifacts 'SHA256SUMS.txt')
```

- [ ] Verify repository immutability is enabled with read-only `gh api repos/kim-mac/Slate/immutable-releases`; do not change settings silently.
- [ ] Verify tag resolves to the exact frozen commit, release remains DRAFT, and exactly five expected assets exist.
- [ ] Download draft assets through authenticated access into a fresh empty verification directory; compare all five hashes and authenticate both installers.
- [ ] Do not use `--clobber`, restage, regenerate checksums or re-sign. The retained SHA256SUMS.txt intentionally contains the two installer hashes.
- [ ] Partial uploads remain an unpublished draft. Stop, inventory the draft and request a reviewed continuation for missing assets; never publish an incomplete release or replace unexpected files.

## Gate C — publish immutable GitHub assets

Requires separate publication approval after Gate B.

```powershell
gh release edit v0.3.1 --repo kim-mac/Slate --draft=false --prerelease=false --latest
```

- [ ] Verify public release, `immutable: true`, tag target and five assets.
- [ ] Independently retrieve public assets and verify hashes/signatures/version/architecture. HEAD/API digest checks alone do not replace this one release-verification download.
- [ ] Confirm v0.3.0 immutable assets and live production manifest remain unchanged.
- [ ] GitHub publication alone does not activate Slate's updater, which uses tryslate.tech/latest.json. Users can nevertheless manually install the newly public GitHub release.

## Gate D — cold backups and production activation

- [ ] Before activation, use [MIGRATION-BACKUP.md](MIGRATION-BACKUP.md) on both real machines. Do not execute backups automatically.
- [ ] Preserve ARM64 schema-2 baseline: 7 clips, 2 groups, 2 standalone clips, 2 pinned items. Preserve x64 baseline: 6 clips, 2 groups, 2 pinned items, including one Chrome capture.
- [ ] Obtain explicit approval for the reviewed activation commit and production push. Recheck latest remote main, ancestry, exact commit/tree, clean index, manifest hash and unchanged headers immediately before pushing.
- [ ] A push to production main **automatically deploys Pages and activates global update discovery**. There is no per-device rollout switch; other v0.3.0 users may discover it. No automatic download/installation is added.
- [ ] Verify successful canonical production deployment of the exact activation commit, both domains, current download links, JSON/no-store headers, exact manifest bytes/signatures and both public installer hashes.
- [ ] On each test PC, use the normal updater without deleting data. Verify download, user-confirmed installation, relaunch, schema-2 → schema-3 migration and all recorded data/settings. Retest captures, Native Messaging, groups, Quick Search, clipboard, editing, persistence and restart.
- [ ] Do not announce completion until both observed real updater tests pass. Do not infer migration success from the clean-installer tests.

## Rollback, cached offers and forward recovery

- The preserved 0.3.0 manifest can stop **new discovery** of 0.3.1 after a separately approved rollback deployment. It does not downgrade installed applications.
- Existing running clients retain offers and verified payloads. Their manual Check for updates may restore the retained offer instead of fetching new metadata. Reverting the server manifest cannot revoke those offers; a complete quit/restart discards the in-memory offer, but must not interrupt an installation already handed to NSIS.
- For urgent containment, request approval to restore the recorded good Pages deployment above. It preserves the present website and 0.3.0 manifest. Do not silently roll back to an older deployment lacking the manifest.
- Dashboard rollback changes serving state, not Git main. Reconcile source with a separately reviewed revert or version rollback; do not force-reset main or leave future builds able to re-enable the faulty manifest accidentally.
- Reverting only the manifest while leaving site download metadata on 0.3.1 still permits manual installs. A containment change must review both, preserving unrelated website work.
- Never edit immutable installers/tags/signatures. A corrected desktop release needs a new version, normally 0.3.2.
- Schema 3 has no reverse migration. v0.3.0 rejects schema 3. Preserve the post-upgrade data before any separately approved recovery; prefer a forward fix.
- Returning to v0.3.0 requires the official verified installer and a compatible cold schema-2 backup; do not point it at schema 3. Restoring a backup loses changes made after that backup.
- NSIS updates are not transactional filesystem rollback. After an installer failure the app may need manual reopening/repair. Do not automatically uninstall, delete data or rerun installers.
- For an architecture-specific defect, stop the campaign and investigate. Do not silently remove a platform from the strict two-architecture contract.

## Remaining evidence limits

Clean-installer/manual functionality passed on both architectures, but the first public 0.3.0 → 0.3.1 updater/migration run is still pending. That update exercises **0.3.0's outgoing handoff**, not the corrected outgoing authorization compiled into 0.3.1. The latter has production-delegation regression coverage with an OS-exit seam, not a real 0.3.1 → higher-version Windows update result. Do not fabricate that result or publish a higher test version without separate approval.

Historical TEST/R2 branch guards and expired TEST TLS are not production dependencies and must not be repurposed or weakened for this release. No production private key or signing passphrase is needed for any verification/publication step above.
