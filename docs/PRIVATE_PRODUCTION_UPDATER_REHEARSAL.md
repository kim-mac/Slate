# Private production-signed updater rehearsal: 0.2.9 → 0.3.0

Checkpoint 6F.1 prepares tooling only. No real candidate, frontend build, installer,
signature, key, URL, uploaded object, or live manifest is generated in this checkpoint.
Automated fixtures contain copied source, synthetic frontend text and unsigned
structural signature examples. They are not release artifacts or signing credentials.

Checkpoint 7B update: the maintainer reports the real production-signed rehearsal
passed on ARM64 and x64. Normal Windows source now enables user-confirmed installation
when the existing driver is configured; this does not approve public builds or delivery.
Previously generated copies/evidence remain unchanged. The helper accepts only the
reviewed historical disabled or current configured-Windows constructor anchor and
replaces it with the same two private opt-ins. No TEST helper or trust pin changes.

## Isolation contract

- Normal source stays version **0.3.0**, with the permanent production public key,
  `https://tryslate.tech/updates/windows/latest.json` and
  `installation_enabled: cfg!(windows) && driver.configured()`. No new feature,
  command, runtime environment
  handling, build feature or installation permission is added to normal Slate.
- Only fresh ignored copies under `dist/test/updater-production-rehearsal/run-*/`
  are modified. The baseline is **0.2.9**, with a private R2 HTTPS manifest endpoint;
  the **0.3.0** candidate keeps the permanent endpoint. Both pin production envelope
  SHA-256 `2641A4781B6B0004D449EE4DE626E8378A87AC89C3800A405972F0ACAA59AFC9`.
  The actual public envelope comes from independently checked normal configuration.
  Only a public `.pub` file is included for later offline verification/transfer.
- Historical TEST preparation and the TEST/fixture identities are not changed or
  accepted by this helper. The private R2 namespace must be explicitly supplied as
  `slate-rehearsal/production-v029-v030-<session>`, in the existing private
  `slate-updater-rehearsal` bucket. This does not provision or upload anything.
- The candidate retains the current app identity, current-user NSIS configuration,
  WebView2 policy, shortcuts, SQLite paths/migrations, Native Messaging identity,
  maintenance gate, safe handoff and actual SDK driver. Only staged version fields,
  frozen frontend build hooks and the installation opt-in wiring differ.
- Root/Desktop JSON, Tauri, Cargo package and Cargo.lock package versions are
  staged consistently. Both x64/`windows-x86_64` and ARM64/`windows-aarch64` use
  optimized release-mode plans and the existing Windows GUI subsystem directive.
- Source/frontend and staged file hashes are inventoried and rechecked by each
  plan. Path helpers reject linked/reparse/hardlinked inputs and overwrites. No
  dependency installation, automatic signing, build or upload is performed.

## Explicit installation opt-ins — ignored copies only

Preparation input and plan requests must acknowledge this exact nonsecret intent:

```text
private-production-0.2.9-to-0.3.0-no-public-release
```

The copied build script additionally requires `SLATE_PRIVATE_REHEARSAL_BUILD` to
equal that string. It fails the build when absent/different, and tells Cargo to
rerun when this value changes. Returned command plans include this build-only
opt-in; they do not execute it or set a launch opt-in.

The copied controller enables installation only when all three conditions hold:

1. That exact build opt-in was embedded through `option_env!`.
2. `SLATE_PRIVATE_REHEARSAL_RUN` has the exact same value in the app's launch
   environment. Missing/different values leave installation disabled.
3. Compiled version is exactly 0.2.9 or 0.3.0.

The existing frontend still follows Rust's `installationEnabled`; editor/capture
guards, signature/version checks and explicit Restart action remain authoritative.
There is no new install command, runtime URL/key override or automatic installation.
Normal source does not reference either opt-in, so these variables cannot change its
configured-Windows installation policy.

Future execution must fully quit any existing Slate instance, then explicitly
launch the baseline with the process-local launch opt-in. No persistent user/system
environment change is required or approved. The NSIS RunAsUser restart may not
inherit it; that safely disables further installations, not normal app startup.
Do not change NSIS or persist the variable to work around this.

Private staged installer names are deliberately incompatible with the public
release contract:

```text
Slate-PRIVATE-REHEARSAL-0.2.9-Windows-x64.exe
Slate-PRIVATE-REHEARSAL-0.2.9-Windows-ARM64.exe
Slate-PRIVATE-REHEARSAL-0.3.0-Windows-x64.exe
Slate-PRIVATE-REHEARSAL-0.3.0-Windows-ARM64.exe
```

Each gets a matching `.exe.sig` only after separate signing approval. All inventories
and plans mark `privateOnly: true`, `publicationAllowed: false`. The unchanged public
validator rejects private names/URLs. The helper has no publication command.
These copies are **not public release inputs**: their bounded opt-in wiring differs
from normal production source. Do not relabel them for public
release. Repository tooling cannot stop a maintainer deliberately uploading/renaming
arbitrary files outside the workflow; final artifact inspection remains mandatory.

## Private delivery and verification

Use the existing private R2 bucket and masked, interactive Botocore workflow only
after approval. Neither credentials nor bearer URLs belong in command arguments,
Git, logs or chat. The input JSON must be ignored and worktree-local, under
`dist/test/updater-production-rehearsal/`. Its exact fields are:

- `acknowledgement`: the nonsecret intent string above.
- `frontendDist`: an existing fresh normal frontend directory, or synthetic test
  fixture under `dist/test/`. The helper does not build it.
- `baselineEndpoint`: the approved session's presigned HTTPS GET for
  `updates/windows/rehearsal.json`.
- `policy`: explicit `accountId`, `bucket`, `prefix` for that private session.

Private presigned installer URLs and signatures live in the private R2 manifest,
not the 0.3.0 candidate. The baseline alone embeds the temporary manifest URL.
The helper rejects R2 URL/bearer material in the frozen frontend and target copy.
The baseline's discovery URL must stay valid for the complete two-machine test;
later manifest replacement keeps that same URL/key. Bound all URLs by actual token
expiry, a 24-hour safety margin and the planned test window; use at most six days.
Expired/unavailable credentials require renewing preparation, never a transport bypass.

`validatePrivateManifest(text, version, policy, now)` checks both architecture-specific
private object mappings, canonical HTTPS SigV4 URL shape/expiry, exact version,
signature envelope/version and strict schema/duplicate-key rules. It reuses the
unchanged public validator through a local URL-token adapter; it does not change
public URL policy, signature bytes, or any network request. Structural URL/envelope
validation is **not cryptographic authentication**.

`verifyPrivateRelease({text, version, policy, publicKeyPath, directory, verifierPath})`
first pins the explicitly supplied `.pub` to production, then invokes the existing
Gate A1 on exact installer and detached-signature bytes. It never builds a verifier,
reads a private key, signs, installs or executes a downloaded artifact. TEST/fixture
public keys are rejected before artifact/verifier access. A real production-signed
positive verification is deferred until signing is separately approved.

## Proposed 6F.2 execution gates — not executed here

### Secure private R2 input preparation (6F.2A.4)

The historical TEST `Prepare-022-Input.ps1` is **not** compatible with this input.
The separate `scripts/windows/updater-rehearsal/prepare_private_r2.py` uses the
existing Botocore installation and existing strict production-rehearsal validator.
It does not build, sign, upload, install, access signing keys, change bucket access
or prepare candidate copies. Run it only after separate approval for real credentials.

In a normal local PowerShell terminal, with transcription, terminal recording and
debug logging disabled, run this exact command (no credentials in the command):

```powershell
& 'C:\Users\kim16\anaconda3\python.exe' -I -B 'C:\Users\kim16\Documents\ChatGPT\Tin\.worktrees\codex-desktop-updater\scripts\windows\updater-rehearsal\prepare_private_r2.py'
if ($LASTEXITCODE -ne 0) { throw 'STOP: private input preparation failed; preserve any partial files.' }
```

Do not redirect output, pipe input, run a transcript, set credential environment
variables or paste credentials into chat. Extra command arguments, redirected I/O,
credential/configuration overrides and non-Windows execution are refused. The two
credential prompts use `getpass`; visible-input fallback is treated as an error.
Credentials are used only in process memory by the explicitly configured Botocore
client, with TLS verification, path-style SigV4 and bounded timeouts. Python cannot
guarantee erasure of credentials from memory; no secure-zeroization claim is made.

Before entering credentials:

1. Confirm locally in Cloudflare that **slate-production-rehearsal** has Object Read
   & Write on **only slate-updater-rehearsal**, and public bucket access is disabled.
   Type `CONFIRM` only when all statements are true.
2. Enter the dashboard-confirmed token expiration. A date-only value is interpreted
   conservatively as **00:00:00 UTC**; an exact ISO timestamp must include a timezone.
   Do not infer an expiration solely from “Active” or the token name.
3. Enter `2026-10-22T23:59:00-05:00` for the planned completion deadline, or a later
   deadline. An earlier deadline is rejected. The token must cover the full window
   plus 24 hours, and the URL also keeps a one-hour testing buffer. For this deadline,
   token expiry must be later than **2026-10-24T05:59:00Z**. A one-week token is
   required; the URL is capped at six days and bounded by token expiry minus 24 hours.

The only R2 request is a read-only listing of at most one object in the intended
bucket. A successful listing proves authentication/read access, **not** write
permission, exclusive scope, actual token expiry or disabled public access. Those
properties require the local dashboard confirmation above. No write probe or query
of unrelated buckets is attempted. Presigning a GET is local, not an object upload.

The fixed new session is `slate-rehearsal/production-v029-v030-r1`; its manifest key
is `slate-rehearsal/production-v029-v030-r1/updates/windows/rehearsal.json`.
The output is exclusively:

```text
dist/test/updater-production-rehearsal/private-input.json
```

It contains exactly `acknowledgement`, `baselineEndpoint`, `frontendDist`, and
`policy`. No standalone credentials or private signing material are written.
**The bearer URL necessarily contains the S3 Access Key ID and a signature**; keep
the entire ignored input private. Never print, attach or commit it. The Secret
Access Key is not written or sent to the Node validator. The URL-bearing JSON is
passed to that validator over stdin, never in child arguments or environment.

Before output, the validator checks the current branch, Git-ignore protection,
ordinary paths, both platform mappings, exact schema/session, actual production
public-key fingerprint and permanent candidate endpoint, source version 0.3.0,
signed-version/TLS/downgrade policies, and the reviewed normal constructor policy.
Historical TEST identities and versions are rejected. The existing frontend must
exist; freshness and future builds are separate approved gates.

Publication is a flushed/fsynced same-directory temporary file followed by a
Windows no-overwrite atomic rename. Existing output, linked paths and orphan
`.private-input-*.tmp` files cause refusal. Interrupted files are retained, not
automatically deleted or repaired. On failure, stop and request review; do not
display the private file or blindly retry. This protects against accidental
partial writes/overwrites, not another malicious process running as the same user.

Successful output is a small redacted JSON report with `inputPrepared: true`,
`urlValidated: true`, both architectures supported, the expiry timestamp,
`apiSecretPersisted: false` and `objectsModified: false`. It does not include a URL.
The helper does not run candidate preparation or any build afterward.

Offline regression command (synthetic credentials and mocked R2 only):

```powershell
Set-Location 'C:\Users\kim16\Documents\ChatGPT\Tin\.worktrees\codex-desktop-updater'
& 'C:\Users\kim16\anaconda3\python.exe' -I -B -m unittest discover -s scripts/windows/updater-rehearsal -p test_prepare_private_r2.py -v
```

Synthetic fixture directories are fresh ignored `dist/test/r2-preparer-unit-*`
evidence. They contain no real credentials or usable signatures/URLs and are not
automatically removed. This checkpoint does not run the interactive helper.

### Subsequent gates

1. Reconfirm installed versions on both PCs are below 0.2.9 and agree on a test
   window. Back up clips/settings before any later installer execution. These
   installations are **not side-by-side**; the shared identity/storage is deliberate.
2. After build/preparation approval, produce a fresh normal frontend:
   `pnpm --filter @ai-clip-memory/desktop build:frontend`. Keep source versions,
   normal configured-Windows installation policy, signing identity and endpoint unchanged.
3. Approve the private session prefix and obtain fresh bounded R2 GET URLs using
   local masked credentials. Save only the private preparation input in the ignored
   input location. Do not reuse expired historical R2 links or TEST signing keys.
4. Prepare the pair and inspect all four plans from the worktree root:

   ```powershell
   node scripts/windows/updater-rehearsal/production-rehearsal.mjs prepare dist/test/updater-production-rehearsal/private-input.json
   ```

   Capture the successful JSON result as `$pair`. Then obtain all four plans:

   ```powershell
   foreach ($directory in @($pair.baseline, $pair.candidate)) {
       foreach ($architecture in @('arm64', 'x64')) {
           node scripts/windows/updater-rehearsal/production-rehearsal.mjs plan $directory $architecture 'private-production-0.2.9-to-0.3.0-no-public-release'
           if ($LASTEXITCODE -ne 0) { throw 'STOP: private build plan rejected.' }
       }
   }
   ```

   This only returns argv/environment plans; it does not execute builds. Review
   hash snapshots, trust, endpoint separation and plans before build approval.

5. Separately approve/execute the four existing native-host/Tauri optimized build
   plans. Inspect actual payload machine, GUI subsystem, version, NSIS current-user
   identity and safety invariants. Inspect payload/config for TEST/R2 material in
   0.3.0 and record installer hashes. Do not run an installer.
6. Separately approve interactive production signing of the exact installer bytes;
   verify both architectures, signed versions, tampering/wrong-key/wrong-version
   rejection through Gate A1. No passphrases, private keys or signing env variables
   enter this helper or build plans.
7. Separately approve private upload/read-back verification. Upload complete
   version-specific artifacts without overwriting historical objects. Validate and
   authenticate the private manifest, then activate it last at the baseline's
   fixed private session key. Publish nothing on GitHub or tryslate.tech.
8. Request explicit approval before running any installer, including baseline.
   On each PC: install/launch 0.2.9 with the temporary launch opt-in; exercise startup
   discovery → explicit Update → download/verification → Restart to update; check
   0.3.0 relaunch, clips/search, Quick Search and browser capture/live refresh after
   full quit/relaunch. Check Later, guarded restart and safe failures using existing
   tests; do not bypass downgrade or wrong-key rejection.

The target's permanent endpoint is deliberately unchanged and unpublished. This
tests private discovery on 0.2.9 and signed installation **into** 0.3.0, not live
discovery **from** the final permanent endpoint. A check failure/404 there is expected
until separately approved launch delivery, not evidence of an installation failure.
Do not add TLS interception, endpoint overrides, auth proxies or public bearer links.

## Verification for this preparation checkpoint

- [x] Test-first configuration, isolation, version and fail-closed regression tests.
- [x] Source-only opt-in inspection; no normal Rust/controller/NSIS changes.
- [x] Focused/historical Node regressions and frontend updater tests run; strict
      helper typechecking, lint, formatting and `git diff --check` checked. See the
      checkpoint report for final counts and results.
- [ ] Generated Rust opt-in compilation, real signing and both-architecture runtime
      checks remain future build/execution gates under the no-build restriction.

No new production-ready installer or live endpoint is asserted by these tests.
