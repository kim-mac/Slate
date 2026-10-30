# Slate Desktop Windows update release contract

> **Current status — Checkpoint 7C-B (2026-10-20):** Normal source is v0.3.0,
> production public trust and the permanent HTTPS endpoint are configured, and
> configured Windows builds enable explicitly user-confirmed installation. The
> Checkpoint 7B policy below is authoritative. Older checkpoint statements about
> disabled installation, ungenerated keys or unconfigured trust are historical,
> not current prerequisites. Public builds, signing and publication still require
> separate approval; historical observations and test evidence are retained.

Nothing in this document or its validator publishes a manifest. Checkpoint 6C
aligns normal-source metadata to 0.3.0; Checkpoint 6E configures production trust.
Checkpoint 7B enables user-confirmed installation in configured Windows builds.
There is still no public manifest, signed public package, or publication approval.

Checkpoint 6F.1 adds a separate offline private-copy preparation helper, documented
in `PRIVATE_PRODUCTION_UPDATER_REHEARSAL.md`. The helper cannot
build/sign/publish/install, and private copies retain independent
build/launch opt-ins. It does not relax this public release contract or TEST tooling.

## Checkpoint 7B: current production installation policy

The constructor now sets `installation_enabled: cfg!(windows) && driver.configured()`.
Unconfigured or non-Windows builds remain disabled. This is a Rust-owned capability,
not consent: startup only checks metadata; download and Restart to update remain
separate main-window user actions. Restart still requires a retained offer and
authenticated bytes for the same version, no overlapping updater operation, and
successful cross-window editor/confirmation, participant-generation/acknowledgement,
operation-drain and authoritative maintenance-barrier checks. Failed preparation or
process creation restores normal admission without scheduling a deferred install.

The production public key, permanent HTTPS endpoint, signed-version policy,
newer-version comparison, TLS verification and finite timeouts are unchanged.
No TEST trust, private URL, launch opt-in, polling or unattended installation is
added to normal source. Historical TEST tools still require explicitly unconfigured,
installation-disabled source fixtures. The private production-copy helper accepts
only the reviewed old disabled or new configured-Windows anchor, then replaces it
with its original independent build/launch opt-ins.

The maintainer reports **0.2.9 → 0.3.0** production-signed private updates passed
on both real ARM64/x64 machines, including restart, clips, search and Chrome
capture. These are user-verified rehearsal results, not validation of future
public installer bytes. Existing ignored copies/evidence must not be rewritten.

Before source freeze: reconcile the newer remote-main README commits, review all
pending source/tests, and run the full relevant validation. Build fresh normal-source
public installers only after separate approval; never rename rehearsal packages.
Production signing, GitHub assets/tag/publication, website manifest/download changes,
deployment and final installed-app smoke tests each retain their approval gates.
Keep `latest.json` absent until complete final GitHub assets and signatures pass.
An existing 0.3.0 rehearsal installation needs a manual same-version public reinstall;
do not weaken equal-version/downgrade protection to transition it.

## Checkpoint 6A: production source versus rehearsal

The maintainer reports successful optimized **0.2.2 → 0.2.3** updates on both real
Windows ARM64 and x64 machines, including restart, retained clips, search, Quick
Search, browser capture and the dark-mode Delete fix. Automatic startup discovery
was explicitly confirmed on x64. These are user-reported installed-app results,
not an independent inspection of either machine. The earlier debug E2E evidence
remains historical in `WINDOWS_X64_UPDATER_E2E_VALIDATION.md`.

Normal source already contains the pinned Tauri 2.12.3/updater 2.13.3 driver,
asynchronous startup metadata check, sidebar notice, manual About check, explicit
download and Restart to update actions, signature/version verification, cross-window
editor guards, per-user maintenance barrier and current-user NSIS handoff. There is
no periodic polling or unattended download/installation. The frontend reads the
Rust-owned state instead of issuing a duplicate startup check. Hidden startup does
not show/focus a window. The constructor was disabled at Checkpoint 6A; the current
configured-Windows policy is documented above. Production public trust comes from
normal `tauri.conf.json`.

At Checkpoint 6A, only ignored rehearsal copies staged 0.2.2/0.2.3 versions, the
disposable TEST public key, private presigned R2 endpoint, skipped WebView2 provisioning
and enabled installation. They use the same runtime driver, identity, SQLite paths/migrations,
Native Messaging registration and installer safeguards. They are not production
release inputs. Checkpoint 6A carries the exact rehearsed Delete CSS into normal
source: enabled destructive menu items use `--popover-foreground` in explicit and
system dark mode; `[data-disabled]` items are excluded. Light-mode tokens and
confirmation/disabled behavior remain unchanged.

### Inputs and gates required for the production channel

1. **Repository:** the configured Git remote and existing strict asset contract both
   identify `https://github.com/kim-mac/Slate`. GitHub Releases hosts the final raw
   NSIS installers and matching `.exe.sig` sidecars. Preserve version-specific
   `/releases/download/v<VERSION>/Slate-<VERSION>-Windows-{x64,ARM64}.exe`
   destinations; the version/tag/assets must be approved and actually published,
   not inferred from this naming contract. Verify remote bytes and asset
   immutability before promoting a manifest.
2. **Version:** approved production version **0.3.0** is aligned across root/Desktop
   package JSON, Tauri, Cargo package and the desktop Cargo.lock entry. It is newer
   than the private baseline 0.2.9, but equal to the completed rehearsal candidate.
   Extension and shared-library versions stay
   independent. No dependency versions change. Do not reset versions or bypass
   downgrade protection.
3. **Trust:** Checkpoint 6E embeds the actual separate production public-key envelope.
   Its independently verified SHA-256 (decoded outer-base64 envelope) is
   `2641A4781B6B0004D449EE4DE626E8378A87AC89C3800A405972F0ACAA59AFC9`.
   Private-key custody, passphrase and recoverable backups
   are maintainer-controlled prerequisites; no private material belongs here or in
   build inputs/logs. Do not reuse the disposable TEST key or known-answer fixture
   identities. Only the `.pub` file was read for configuration; no private key or
   passphrase is read, copied or included in the application.
4. **Manifest endpoint:** the permanent production contract is
   `https://tryslate.tech/updates/windows/latest.json`, with installers on GitHub.
   This is an approved destination, not an assertion that its manifest is live.
   Do not invent signing values, reuse R2 URLs, or use GitHub-wide `latest` routing: an
   extension-only release must not redirect desktop discovery. The baseline must
   retain one endpoint that can later advertise newer complete releases.
5. **Bundled public config, Checkpoint 6E:** `plugins.updater.pubkey` and
   `plugins.updater.endpoints` contain the approved real values, with
   `requireSignedVersion: true`, `allowDowngrades: false`, and all three
   `dangerous*` transport/certificate/hostname options false. Keep native TLS,
   HTTPS-only requests and finite timeouts; do not broaden frontend network or
   plugin permissions. Preserve the existing normal WebView2 policy unless
   separately approved. Checkpoint 7B approves the configured-Windows constructor
   policy; distribution remains blocked until final artifact/delivery gates pass.
6. **Artifacts and manifest:** require both `windows-x86_64` (x64/Intel/AMD) and
   `windows-aarch64` (ARM64) entries. Each signature is the exact matching detached
   signature text, not a signature URL. Authenticate final installer bytes and
   signed application version with Gate A1 and the independently supplied production
   public key. Inspect actual payload architecture, GUI subsystem and version.
   Publish the complete assets before the manifest; never promote a partial pair.
7. **Production exclusion check:** inspect staged config, frontend output, desktop
   payloads and installer contents for TEST trust, R2/bearer URLs, loopback test
   endpoints, preview identity and credentials. Test-only tooling and synthetic
   fixtures in the repository are not runtime configuration and must not be copied
   into production packages. Source tests alone do not prove built-artifact safety.

Production signing, builds and publication remain separate approval gates; source
installation enablement is approved at Checkpoint 7B. The configured public key and
permanent endpoint are not proof of
live endpoint delivery or production-signed installer validation. Approved asset
names are `Slate-0.3.0-Windows-x64.exe`
and `Slate-0.3.0-Windows-ARM64.exe`, each with its own `.exe.sig`, under GitHub Release
tag `v0.3.0`. Approval of these names does not publish or verify those future assets.

### Checkpoint 6C: static manifest delivery preparation

`apps/site/public/updates/windows/.gitkeep` preserves the static directory in Git.
There is deliberately **no `latest.json`** until a complete real production manifest
is approved. The static website builds without it; no placeholders or TEST values
are shipped. `apps/site/public/_headers` scopes `application/json; charset=utf-8`
and `Cache-Control: no-store` to the exact `/updates/windows/latest.json` path.
There is no new auth service, Function, redirect or updater transport.

Final insertion requires separate approval:

1. Finish production-key custody and verification, then build and sign the final
   0.3.0 x64/ARM64 installers. Verify actual payload architecture/version, final
   hashes, signed version 0.3.0 and the independent production-key fingerprint.
2. Publish the complete approved GitHub asset set and independently verify both
   version-specific download URLs, exact downloaded bytes and signatures. Generate
   a manifest with both platform entries and the exact matching signature contents.
3. Run the existing combined contract/Gate A1 validator with `--version 0.3.0`,
   the actual local manifest/artifact directory, explicitly supplied production
   public-key path and reviewed verifier. Structural checks alone are insufficient.
4. Review and insert those exact verified manifest bytes as
   `apps/site/public/updates/windows/latest.json`. Never copy a rehearsal manifest,
   bearer URL, key or installer into the site. Preserve this source file in every
   later site deployment; future desktop manifest changes require the same gates.
5. Build/test the site and compare output manifest bytes with the approved source.
   After separately approved deployment, verify the exact permanent HTTPS URL
   returns HTTP 200 JSON, `no-store`, the approved hash and both platform entries,
   with no unexpected redirect, authentication or browser challenge. Dashboard
   security/cache rules cannot be guaranteed by repository headers; verify them live.

Until insertion/deployment, a missing manifest is expected to fail closed (404),
not pretend that a production update exists. Source preparation does not change
installed applications. The installation policy is now approved in normal source;
distribution and manifest promotion remain blocked until final verification passes.

### Historical Checkpoint 6E: trust-only validation and next private rehearsal

The normal Rust driver reads only bundled updater configuration; missing or unsafe
configuration remains unconfigured, without environment, TEST-key or endpoint
fallbacks. It enforces signed versions, newer-version comparison, native TLS,
HTTPS-only requests/redirects and a 30-second timeout for checks and downloads.
The SDK plugin is initialized without exposing its JavaScript installation commands.
At Checkpoint 6E the main-window `restart_to_update` command rejected the then-disabled
constructor before preparation or handoff. Checkpoint 7B changes only that initial
configured-Windows capability; the frontend hook and notice still refuse Restart
when `installationEnabled` is false. No polling or unattended installation is added.

Focused offline configuration checks (run from the updater worktree):

```powershell
node --test scripts/windows/production-updater.test.mjs
cargo test --offline --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --lib updater::tests
cargo test --offline --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --test updater_security
node --test apps/site/tests/updates.test.mjs
```

The production manifest validator still requires complete version-specific GitHub
assets for both architectures and cryptographic authentication through Gate A1.
It is not relaxed to accept private R2 assets. Historical TEST preparation tools
also still refuse configured production trust and retain their original TEST pin;
their positive tests use explicit historical unconfigured copies.

**Historical proposed rehearsal (subsequently performed privately):**

1. Approve a separate, fail-closed isolated candidate procedure for **0.2.9 → 0.3.0**.
   Pin the production public-key fingerprint explicitly, reject the TEST/fixture
   identities, require both architecture artifacts, and prohibit stable-manifest
   promotion/publication. Do not repurpose the existing TEST preparation tools.
2. A private-only 0.2.9 baseline can use a temporary private HTTPS manifest with
   production-signed 0.3.0 installer downloads. The destination 0.3.0 candidate
   retains the exact permanent `https://tryslate.tech/updates/windows/latest.json`
   endpoint. No public release, higher public version or downgrade bypass is needed.
3. Installation was then hard-disabled: no actual rehearsal could work until
   separately approved enablement in the isolated build copies. Enablement must be
   explicit and validated before signing; a differently configured disabled build
   is not byte-identical to the enabled final candidate. Build/sign/install approvals
   and backup gates remain separate.
4. This exercises private discovery on the baseline and installation **into** the
   final permanent-endpoint candidate, not live production discovery **from** it.
   Keep the permanent manifest unpublished until separately approved. A constant
   unauthenticated public endpoint cannot secretly deliver a private manifest under
   the current driver. Publishing presigned bearer URLs in a public manifest would
   expose those capabilities, not provide access-controlled delivery. Do not add
   TLS interception, DNS overrides, an auth proxy, or a runtime endpoint override.
   If testing the final candidate's own permanent-endpoint discovery before public
   launch is mandatory, a separately approved delivery decision is still required.

No production endpoint request, live manifest, installer build/signing, installed-app
change or rehearsal implementation is part of Checkpoint 6E. Source/header checks
cannot establish live Cloudflare redirect/challenge/cache behavior; verify after an
approved deployment, including `Content-Type`, `no-store` and exact manifest bytes.

## Historical Step 1 format and verification reference

The original 0.2.0 examples below describe the contract, not a currently approved
release version. Historical statements about tests and key generation are scoped
to Step 1/Gate A1; disposable rehearsal signing and real-machine tests happened later.

## Format and pinned compatibility

The future stable manifest location is
`https://tryslate.tech/updates/windows/latest.json`. It is independent of GitHub's
`latest` release, so an extension-only release cannot change the desktop endpoint.
There is no manifest file at that endpoint added by this step.

The format follows the static response consumed by `RemoteRelease` in the pinned
`tauri-plugin-updater = 2.13.3`. The pinned CLI is 2.12.2. Compatibility was inspected
in the locally installed crate source, without network requests. Upstream reference:
[Tauri v2 updater static JSON](https://v2.tauri.app/plugin/updater/#static-json-file).

This illustration is **not a deployable manifest**: signature placeholders must be
replaced with the actual single-line contents of the matching Tauri `.exe.sig` files.
Placeholders fail validation. Do not put a signature file's URL into `signature`.

```json
{
  "version": "0.2.0",
  "notes": "Slate Desktop release notes.",
  "pub_date": "2026-10-14T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "url": "https://github.com/kim-mac/Slate/releases/download/v0.2.0/Slate-0.2.0-Windows-x64.exe",
      "signature": "REPLACE_WITH_X64_EXE_SIG_CONTENTS"
    },
    "windows-aarch64": {
      "url": "https://github.com/kim-mac/Slate/releases/download/v0.2.0/Slate-0.2.0-Windows-ARM64.exe",
      "signature": "REPLACE_WITH_ARM64_EXE_SIG_CONTENTS"
    }
  }
}
```

Slate deliberately uses a stricter subset of the SDK's accepted formats:

- Required root fields: `version`, `platforms`. Optional: `notes`, `pub_date`.
  No additional fields, `name` version alias, dynamic top-level URL/signature,
  arrays, null substitutes, or duplicate JSON keys (including escaped duplicates).
- `version` must equal the independently supplied expected desktop release version.
  Both must be canonical `MAJOR.MINOR.PATCH`, at least `0.2.0`, with safe-integer
  components. No `v` prefix, leading zeroes, prerelease, or build suffix. Test-channel
  version policies are separate future work, not an exception in this stable contract.
- Manifest bytes must be valid UTF-8, without a BOM. `notes`, if present, is a
  well-formed Unicode string (no lone UTF-16 surrogates). `pub_date`, if present, is a valid UTC RFC3339
  timestamp with whole seconds (`YYYY-MM-DDTHH:mm:ssZ`). The SDK accepts broader
  RFC3339 forms; UTC/whole seconds is Slate's canonical release-tooling policy.
- Exactly the two platform entries above are required. The SDK tries a bundle-specific
  key first, then the generic OS/architecture key. Slate uses only the generic keys;
  extra `-nsis` entries are rejected to prevent an alternate asset taking precedence.
  Architecture refers to the compiled application target, not necessarily host CPU.
- Each platform contains exactly `url` and `signature`. URLs must literally match
  the version-specific repository/tag/filename shown above, substituting the expected
  release version. No alternate origin/repository, `latest`, credentials, ports,
  encoding, path normalization, query, fragment, redirects-as-input, or ZIP assets.
- Signatures must contain the canonical outer base64-encoded Tauri/minisign envelope,
  valid-shaped signature packets and exactly one `version:<expected>` trusted-comment
  field. This rejects absent, empty, malformed, legacy unversioned and mixed-version
  signatures. It does **not** authenticate the comment or signature.

## Local artifact contract

| Tauri platform    | Rust build target         | Installer                           | Signature sidecar                       |
| ----------------- | ------------------------- | ----------------------------------- | --------------------------------------- |
| `windows-x86_64`  | `x86_64-pc-windows-msvc`  | `Slate-<version>-Windows-x64.exe`   | `Slate-<version>-Windows-x64.exe.sig`   |
| `windows-aarch64` | `aarch64-pc-windows-msvc` | `Slate-<version>-Windows-ARM64.exe` | `Slate-<version>-Windows-ARM64.exe.sig` |

The validator reads the four corresponding local files. Each must be a nonempty
regular file; each signature sidecar must match the manifest's signature exactly
(one terminal LF/CRLF is tolerated in the sidecar). It reports deterministic byte
sizes and SHA-256 values in fixed x64/ARM64 order. Unrelated files in a staging
directory do not satisfy or replace any of these four required files. An extension
ZIP is never a desktop update. No file is written or fetched by the validator.

Raw NSIS installers and their signatures are used, not legacy `.nsis.zip` bundles.
Installer renaming must not change the signed bytes. The trusted comment may retain
the original bundler filename; do not rewrite it when applying public asset names.

## Verification commands

From the updater worktree root, using existing Node dependencies:

```powershell
node --test scripts/windows/validate-desktop-update-release.test.mjs
& .\node_modules\.bin\tsc.cmd --ignoreConfig --allowJs --checkJs --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --types node --typeRoots apps/desktop/node_modules/@types --skipLibCheck scripts/windows/validate-desktop-update-release.mjs
& .\node_modules\.bin\eslint.cmd scripts/windows/validate-desktop-update-release.mjs scripts/windows/validate-desktop-update-release.test.mjs scripts/windows/verify-desktop-update-signatures.test.mjs
& .\node_modules\.bin\prettier.cmd --check scripts/windows/validate-desktop-update-release.mjs scripts/windows/validate-desktop-update-release.test.mjs scripts/windows/verify-desktop-update-signatures.test.mjs scripts/windows/update-signature-verifier/fixtures/signatures.json
git diff --check
```

For a **future, separately approved, already-signed** candidate (not the frozen V1
bundle), point the read-only CLI at local paths. Do not use URLs as file arguments:

```powershell
node scripts/windows/validate-desktop-update-release.mjs --version 0.2.0 --manifest .\dist\test\updater-contract\stable.json --artifacts .\dist\test\updater-contract
```

Missing/duplicate/unknown CLI arguments or any failed validation return a nonzero
exit code. This structural-only invocation prints a JSON contract report including
four local artifact hashes, with `cryptographicallyVerified`,
`payloadArchitectureVerified` and `remoteImmutabilityVerified` explicitly **false**.
It is not a cryptographic release gate. Its original structural tests remain intact.

## Gate A1: offline cryptographic verification

The standalone tool under `scripts/windows/update-signature-verifier/` pins
`minisign-verify = 0.3.0`, the same implementation resolved for updater 2.13.3.
It uses `PublicKey::verify(bytes, signature, true)`, authenticating the artifact
and the global signature over the trusted comment before extracting `version:`.
Version comparison follows the pinned updater's SemVer behavior, including signed
`v` prefixes. The explicitly supplied expected version must be canonical SemVer;
the combined stable-release contract continues enforcing its stricter stable policy.

The tool has no network client, private-key input, signing capability, installation
path, environment-credential lookup, or dependency on the desktop application. It
does not load Slate, open SQLite, register anything, or change updater configuration.
Failures print only static error codes, never file contents or SDK error payloads.
Success reports the verified version, byte count, SHA-256 of those exact verified
artifact bytes, the detached signature file hash, and a public-key fingerprint.
The fingerprint hashes the decoded outer-base64 public-key text, excluding a
terminal line ending on the outer encoding. It is not a private-key fingerprint.

Build/test the small tool, not Slate or an installer, from the worktree root:

```powershell
cargo build --offline --locked --manifest-path scripts/windows/update-signature-verifier/Cargo.toml
cargo test --offline --locked --manifest-path scripts/windows/update-signature-verifier/Cargo.toml
cargo check --offline --locked --all-targets --manifest-path scripts/windows/update-signature-verifier/Cargo.toml
cargo fmt --manifest-path scripts/windows/update-signature-verifier/Cargo.toml -- --check
node --test scripts/windows/validate-desktop-update-release.test.mjs scripts/windows/verify-desktop-update-signatures.test.mjs
```

For a future approved x64 installer, supply **all four inputs explicitly**:

```powershell
& .\scripts\windows\update-signature-verifier\target\debug\slate-update-signature-verifier.exe --public-key 'C:\approved-public-key.pub' --artifact .\dist\test\updater-contract\Slate-0.2.0-Windows-x64.exe --signature .\dist\test\updater-contract\Slate-0.2.0-Windows-x64.exe.sig --expected-version 0.2.0
```

Repeat with `Windows-ARM64.exe` and its matching `.exe.sig`, or use the combined gate
below, which requires and verifies both architecture pairs in fixed order:

```powershell
node scripts/windows/validate-desktop-update-release.mjs --version 0.2.0 --manifest .\dist\test\updater-contract\stable.json --artifacts .\dist\test\updater-contract --public-key 'C:\approved-public-key.pub' --verifier .\scripts\windows\update-signature-verifier\target\debug\slate-update-signature-verifier.exe
```

Those example candidate/key files are not created by this checkpoint. The maintainer
must select the trusted public key independently of the manifest and use the verifier
built from reviewed source; an arbitrary replacement executable could lie about its
results. `--public-key` and `--verifier` must be supplied together. The child executes
without a shell; credential-named environment variables are filtered, while required
Windows host launch context is retained. The verifier itself reads no environment
credentials. There is no private-key or password option and no implicit key discovery.

Only after both real cryptographic checks succeed does the combined command report
`cryptographicallyVerified: true`. Each returned artifact hash/size and sidecar hash
must match the Step 1 snapshot, and both public-key fingerprints must match the
explicit key snapshot. Any disagreement or child failure aborts without a success
report. Neither mode claims payload architecture or remote immutability verification.

All combined-gate paths are preflighted before filesystem access or execution.
Inputs must be existing regular, nonempty local files, not HTTP(S) URLs or explicit
UNC/device paths or alternate data streams. Public-key/signature files are limited to 16 KiB; artifacts to
512 MiB. Use ordinary offline local storage, not mapped network drives, cloud-only
placeholders or redirected paths. The tool makes no HTTP requests, but OS filesystem
providers can perform I/O outside a tool's control. Verification applies to the bytes
read, not future writes: do not modify/patch/re-sign an installer after verification;
recheck hashes at transfer/upload. Any future Authenticode signing must precede the
Tauri updater signature over the final installer bytes.

### Public, disposable known-answer tests

`fixtures/signatures.json` contains only public-key text, synthetic NON-INSTALLER
content and detached signatures. Its identity is the already-published
[RFC 8032 section 7.1 TEST 1](https://www.rfc-editor.org/rfc/rfc8032#section-7.1)
known-answer identity. One-time fixture preparation imported that existing identity
and used OpenSSL Ed25519 signing for synthetic messages; it generated no keys and
retained no private key, passphrase, or generator in the repository. No real release
was signed. Tests are fully offline and perform no signing or key generation.

This publicly known identity is **never safe for Slate test-update or production
trust configuration**. Genuine Slate test and production keys remain ungenerated.
Fixtures cover prehashed and SDK-compatible legacy signatures, authenticated signed
versions, `v` prefixes, prereleases, missing/mismatched versions, wrong keys, tampered
bytes/comments/signatures, invalid arguments/files and both architecture contracts.

## Still required before publishing or enabling installation

Passing this validator is necessary, **not sufficient**, for release approval:

1. Verify both installers and all embedded executables come from the same approved
   source revision, carry the expected version, and bundle the intended architecture.
   Public filenames/manifest keys do not prove payload architecture. NSIS outer PE
   stub architecture alone is not proof of the inner application architecture.
2. Cryptographically verify each final installer's exact bytes against the release
   public key and its sidecar, including the authenticated version-bound comment.
   Keep runtime `requireSignedVersion: true`; signature verification is mandatory.
   Gate A1 provides this offline check with an explicitly supplied public key. The
   structural-only mode cannot authenticate anything; matching sidecar text alone
   is not proof that it signs the installer. No production key exists/configured yet.
3. Enforce GitHub immutable release assets (or equivalent approved protection) and
   verify uploaded bytes. Version-specific URLs avoid mutable `latest` routing but
   **do not by themselves prove server-side immutability**. Offline validation does
   not check asset existence, redirects, release state, or GitHub settings.
4. Publish/promote the stable manifest only after the complete four-asset release
   passes those gates and both architecture tests. Configure cache/revalidation and
   the production endpoint only in a later approved step. No extension release may
   overwrite the desktop manifest. Do not silently accept partial architecture sets.
5. Wire this contract check into approved release tooling/automation in a later step;
   existing build/staging scripts and runtime behavior are intentionally unchanged.

No signing-key, installation, endpoint-configuration or deployment decision is
implemented here. Signing custody, private signed-update testing and promotion
controls remain prerequisites for later checkpoints.
