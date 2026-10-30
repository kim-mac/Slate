# Windows release rehearsal: local preparation

> **Current status — Checkpoint 7C-B (2026-10-20):** This document preserves the
> historical TEST rehearsal procedure and its checkpoint boundaries. Normal source
> is now v0.3.0 with production public trust, the permanent HTTPS endpoint and
> explicitly user-confirmed installation enabled for configured Windows builds.
> Statements below that normal installation remains disabled describe earlier
> checkpoints, not current policy. Do not apply historical TEST configuration to
> normal source. See `DESKTOP_UPDATE_RELEASE_CONTRACT.md` for current policy.

**Checkpoint 6E boundary:** normal source now contains the independently verified
production public key and permanent endpoint, with installation still disabled.
The historical TEST tools below deliberately reject that configured source rather
than overwrite production trust. Existing ignored 0.2.2/0.2.3 candidates and
artifacts remain unchanged; regression tests use explicit historical fixtures.
A production-signed private rehearsal needs separately approved isolated wiring,
not a relaxed TEST pin. See `DESKTOP_UPDATE_RELEASE_CONTRACT.md`.

Checkpoints 1 and 2B prepare **0.2.2 → 0.2.3**. The tooling does not build, sign, install, upload,
deploy, enable installation, or select a distribution provider. First reconfirm
both installed versions are below 0.2.2. Never uninstall or bypass downgrade checks.

## Explicit candidate versions

`Build-WindowsInstaller.ps1` and `Stage-WindowsRelease.ps1` accept `-ReleaseVersion`.
The supplied version must match the root package, desktop package, Tauri config,
Cargo package and desktop Cargo.lock entry. Without the option they derive the
same checked version from the root package; no version is rewritten. Extension
versions are deliberately independent. Windows components must be at most 65535.

Normal-source metadata is now **0.3.0** (Checkpoint 6C); historical 0.2.2/0.2.3
candidate copies and artifacts are unchanged. Read-only normal-source checks:

```powershell
& ./scripts/windows/Build-WindowsInstaller.ps1 -Architecture x64 -ReleaseVersion 0.3.0 -ValidateOnly
& ./scripts/windows/Build-WindowsInstaller.ps1 -Architecture arm64 -ReleaseVersion 0.3.0 -ValidateOnly
```

Each prints the version, target and `Profile: release`, without generating even
the Native Messaging manifest. A 0.2.2 request must fail until a separately
reviewed candidate snapshot has consistent 0.2.2 metadata. The normal build command
still uses Tauri's optimized release profile, with no `--debug` switch. The existing
`main.rs` release-only Windows GUI subsystem directive is unchanged. Actual payload
PE subsystem, architecture, version and manifest still need inspection after builds.

Staging preflights both version/architecture filenames and existence before any
copy. It rejects linked output ancestors, frozen `dist/release/v0.1.0` destinations,
and nonempty output directories. It never overwrites artifacts. Source filenames
are labels, **not proof of payload architecture**. This staging step neither signs
nor authenticates installers; it cannot produce an approved update by itself.

## Inactive rehearsal configuration

`scripts/windows/release-rehearsal.mjs` exports two pure, offline functions:

- `rehearsalArtifacts(version)`: approved version, architecture, filename and sidecar
  mappings. It does not invent asset URLs.
- `rehearsalConfiguration(source, options)`: returns a candidate config in memory.
  Explicit inputs are `version`, `endpoint`, `testPublicKey` (public envelope only)
  and `expectedTestPublicKeySha256` (SHA-256 of the outer-base64-decoded public-key
  envelope bytes). Both the supplied fingerprint and key must match the approved
  constant `9868697D6D22F6667160A764C94933FD9C754951E7840FEE51B0A7A93C7ED36D`.

Only 0.2.2/0.2.3 and an HTTPS endpoint ending in `/updates/windows/rehearsal.json`
are accepted. Stable/latest, loopback, credentials in URL authority, fragments and
normalized path aliases are rejected. Temporary query-bearing access URLs are
supported without generating or retrieving them. Treat those URLs as bearer
credentials: never commit, print, log or include them in public test evidence.

Identity, windows, frontend build commands, NSIS hooks/template/current-user mode,
and downgrade protection are preserved. WebView2 provisioning is skipped. Signed
versions, certificate-chain validation and hostname validation remain required.
`createUpdaterArtifacts` is false because the separately approved ceremony signs
the final raw NSIS bytes interactively; this is **not** permission to ship unsigned
updates. Both `.exe.sig` files and authenticated versions remain mandatory.

This configuration module has no CLI, writes, networking, signing or publishing.
The separate preparation CLI below writes only new ignored candidate copies.
The normal Rust controller remains installation-disabled. No TLS patches, private
CA, test networking code or alternate updater driver are introduced.

## Isolated candidate preparation (Checkpoint 2B)

`scripts/windows/updater-rehearsal/prepare.mjs` has only `prepare` and `plan`
commands. Neither executes a build. Real R2 access and real candidate builds still
require approval; unit tests use synthetic URLs and non-executable frontend fixtures.

After separately approving a fresh normal production frontend build, supply a
local ignored JSON input file with exactly these fields:

- `version`: `0.2.2` (later `0.2.3`).
- `frontendDist`: absolute path to that worktree's normal `apps/desktop/dist`.
- `publicKeyPath`: absolute path to the existing disposable **public** `.pub` file.
- `policy`: exactly `accountId`, `bucket`, `prefix`. The account is 32 lowercase
  hex digits; the bucket is an explicit DNS-safe name; the object namespace is
  `slate-rehearsal/<reviewed-session-name>`. There are no implicit host defaults.
- `endpoint`: fresh path-style presigned HTTPS GET URL to
  `/<bucket>/<prefix>/updates/windows/rehearsal.json` on
  `<accountId>.r2.cloudflarestorage.com`. Never use a production endpoint.

Keep this input and every generated config private and ignored: query URLs are
bearer capabilities. Do not share or commit candidate directories. No R2 API
secret, signing private key or passphrase belongs in the input.

Preparation-only commands (input/configuration approval required first):

```powershell
node scripts/windows/updater-rehearsal/prepare.mjs prepare <ignored-input.json>
node scripts/windows/updater-rehearsal/prepare.mjs plan <returned-candidate-directory> arm64
node scripts/windows/updater-rehearsal/prepare.mjs plan <returned-candidate-directory> x64
```

Preparation refuses overrides and unsafe inputs before creating a fresh
`dist/test/updater-release-rehearsal/run-*/<version>/` directory. It writes a
source/staged SHA-256 inventory and exclusively creates files (no overwrites).
Within that copy only:

1. Root/Desktop package JSON, Tauri version, Cargo package and its Cargo.lock entry
   become the supplied version. Other package versions, extension version and
   dependency locks are not rewritten.
2. Exactly one reviewed updater constructor anchor changes `installation_enabled`
   from false to true. All admission, consent and handoff checks remain intact.
3. The normal HTTPS driver, entry point, storage/migrations, NSIS template/hooks,
   maintenance gate and handoff are copied byte-for-byte. The approved public key
   and isolated endpoint are configured, with signed-version/TLS/downgrade checks.
4. The prebuilt frontend is frozen into `apps/desktop/dist`; `frontendDist` stays
   the safe relative path `../dist`. Build/dev hooks are disabled **only in the
   copy**, since the normal optimized frontend has already been built and copied.
   There is no Vite dev server, visual harness or dependency installation.
5. Native Messaging JSON is derived from the unchanged public extension identities.
   Existing staging/checksum scripts are copied unchanged to operate on the
   candidate metadata, not on the normal source tree's version metadata.

`plan` rechecks the source/staged inventory, TEST identity and endpoint expiry.
It returns argv arrays, working directories, explicit environment and expected
bundle paths; it does **not** run them. Apply each command's environment when
eventually authorized. Plans use pinned CLI 2.12.2 from existing dependencies,
`cargo build --release --offline --locked` for the native host, then normal
`tauri build --no-sign --bundles nsis --target ... -- --offline --locked`.
No `--debug` is permitted. Existing architecture-specific target caches are reused;
`RUST_LOG=off` avoids the SDK's full-URL/manifest debug output. Signing/configuration
and Rust profile overrides are rejected. No dependency links/copies are created.

After both approved builds, use the candidate's copied `Stage-WindowsRelease.ps1`
with explicit `-ReleaseVersion`, both exact reported bundle paths, and a fresh
candidate-local output directory. Preserve 0.2.2 before building 0.2.3. Manual
signing, actual PE GUI/architecture inspection and Gate A1 remain required gates.

## Private R2 validation

`validateRehearsalUrl` accepts only the explicit account/bucket/session, exact
manifest/installer object names, HTTPS, and an unexpired SigV4 GET URL shape.
Required query fields are Algorithm, Credential, Date, Expires, SignedHeaders and
Signature using their `X-Amz-` names. Region is `auto`, service is `s3`, and signed
headers must be `host`. Duplicate/unknown parameters, pinned `versionId`, custom
domains, HTTP, redirects-as-input, wrong architectures, mixed versions and expired
URLs fail closed. Optional SDK GET parameters are narrowly allowlisted. This is
structural validation, not proof that R2 accepts the URL; later network checks
must test real authorization and response headers. No R2 signing is implemented.

`validateRehearsalManifestJson` checks those URLs, then substitutes only their
canonical raw JSON string tokens for the production validator's expected GitHub
URLs. This reuses all strict schema, decoded duplicate-key, signature-envelope,
signed-version and architecture-name checks **without changing production code**.
Escaped/repeated URL literals are rejected. The returned contract retains actual
R2 URLs. No endpoint contents or bearer URLs enter error messages.

`verifyRehearsalRelease` additionally pins the TEST public key and delegates to the
unchanged `verifyReleaseArtifacts`/Gate A1 engine. It requires an existing local
verifier, never compiles one, and rejects unauthenticated synthetic signatures.
No genuine 0.2.2 installer/signature exists yet, so their positive cryptographic
verification remains a later signed-artifact gate.

## Approved distribution direction (not provisioned)

Existing infrastructure consists of public GitHub Releases, the static Pages
site, and localhost HTTPS E2E kits. Repository inspection found no provisioned
private artifact-distribution configuration. The read-only default-jurisdiction
R2 bucket list returned zero buckets during Checkpoint 2A. Localhost kits are not remote hosting and their custom CA patches
are not suitable for this normal-driver rehearsal.

- Private GitHub assets require authentication. The normal driver deliberately has
  no embedded GitHub token or custom authentication headers. Browser login cannot
  authenticate its background requests. Public prereleases are not private.
- Cloudflare Access service authentication requires credentials/headers. Existing
  Pages alone does not establish private access for a headless updater. Do not
  embed account credentials in the app or introduce an authentication proxy here.
- **Approved direction:** private
  object storage with short-lived HTTPS GET URLs for the manifest and both signed
  artifacts. R2 presigned URLs are one option in the existing Cloudflare ecosystem;
  they work without client authentication headers but are bearer credentials and
  expire (R2 allows up to seven days). A bucket/credentials/expiry policy is not
  confirmed or configured. No new server or updater architecture is needed.

The current production manifest validator intentionally requires exact GitHub
URLs without queries. It remains unchanged. The **rehearsal-only URL policy** above
wraps the same schema, architecture, signature/version checks and Gate A1 verifier.
Never broaden the stable contract to make private fixtures pass. Manifest refresh/URL expiry and client clock behavior
must be tested once the provider is chosen. R2 presigned URLs use its S3 endpoint,
not a custom tryslate.tech domain.

References:
[GitHub asset access](https://docs.github.com/en/rest/releases/assets),
[Cloudflare service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/),
[R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

## Verification

```powershell
node --test scripts/windows/release-rehearsal.test.mjs scripts/windows/updater-rehearsal/rehearsal.test.mjs scripts/windows/validate-desktop-update-release.test.mjs
node --test scripts/windows/validate-desktop-update-release.test.mjs scripts/windows/verify-desktop-update-signatures.test.mjs scripts/windows/disposable-test-signing.test.mjs scripts/windows/test-updater-sdk-transport.test.mjs scripts/windows/updater-e2e/updater-e2e.test.mjs
corepack pnpm --filter @ai-clip-memory/desktop test
corepack pnpm --filter @ai-clip-memory/extension test
cargo test --offline --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --test release_packaging --test updater_security --test installation_safety_contract
git diff --check
```

New script tests use small synthetic non-executable fixtures beneath ignored
`dist/test/updater-release-rehearsal/`. They do not delete existing evidence.
Signing-tool tests use existing public synthetic fixtures, never private keys.

## Decisions/gates before a baseline build

1. Confirm both actual installed versions are below 0.2.2.
2. Separately approve R2 resource provisioning/presigning, the concrete private
   account/bucket/session/manifest URL, and expiration schedule. Use a mutable
   manifest object, `application/json`, `Cache-Control: no-store`, and versioned
   installer objects. Keep the same embedded manifest URL while replacing its
   contents after all newer signed architecture assets pass verification.
3. Reconfirm the existing TEST public identity; no production key changes.
4. Approve the normal production frontend build, actual candidate preparation and
   subsequent installer builds. Unit fixtures are not real build candidates.
   Default production stays disabled; only the copy enables installation.
5. Revalidate the candidate build plan, authenticate all
   final bytes with Gate A1, inspect both payload architectures/GUI subsystems,
   and verify uploaded bytes before manifest publication (all later approvals).
6. Verify cold backups before each separately approved in-place installation.

Frozen V1 artifacts, historical E2E fixtures, the extension archive, production
configuration, installed Slate and all libraries remain outside this checkpoint.
