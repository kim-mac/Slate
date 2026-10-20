# Checkpoint 8B-1.1: per-user Windows maintenance barrier

Every cooperating desktop and native host uses one authority:

`<permanent Windows profile>/.slate-coordination/com.aiclipmemory.desktop/maintenance-v2.lock`

The resolver opens the process token, reads its user SID, calls
`GetUserProfileDirectoryW`, and compares that directory with the SID's machine
`ProfileList` registration using physical file IDs and the unredirected path.
It does not derive authority from USERPROFILE, APPDATA, LOCALAPPDATA, the working
directory, executable directory, or frontend input. There is no legacy
installation-root gate or alternate-location fallback. Registry paths requiring
environment expansion are ambiguous and rejected.

Only established local profiles (`GetProfileType == 0`) on local NTFS drive-letter
paths are supported. Temporary, roaming, mandatory and unknown profile modes,
remote/device paths, unsupported filesystems and ambiguous identities fail closed.
Compatibility with ReFS, FAT, redirected/roaming profiles, service accounts and
other execution contexts is not established.

## Identity and security boundary

Original and canonical ancestors are opened before normalization, checked for
ordinary disk/directory identity and reparse attributes, and retained without
FILE_SHARE_DELETE. Final handle paths must match the unredirected expected
authority. Volume serial and file-index identity must be usable. Enclosing
Windows directories are physically bound and pinned; their owners/DACLs do not
receive the private namespace's restrictive whitelist. Ordinary ancestors can
allow creating unrelated children. Those grants are not treated as trusted
permissions on the profile or coordination objects.

The actual profile root requires current-user, SYSTEM or Administrators ownership.
Its effective allow ACEs cannot grant mutation/security-control rights to other
principals. Unexpected ACE forms and ambiguous security fail closed. Existing
profile and parent permissions are never changed.

Private directories are created atomically with current-user owner, protected
DACL, inheritable current-user Modify and SYSTEM FullControl. Existing objects
must satisfy that policy; unsafe objects are never repaired. The file accepts
equivalent safely inherited ACEs. Windows generic rights are normalized, including
Synchronize, and user rights cannot exceed Modify. Required effective user and
SYSTEM rights must exist. Unexpected principals, deny/unsupported ACEs, unsafe
ownership or directory inheritance fail closed.

The empty gate must be an ordinary writable disk file with one hard link. The
anchor and each independently opened operation handle omit delete sharing. Every
operation revalidates profile/private security and file identity against the
retained anchor. Readonly, reparse, nonordinary, substituted and hardlinked gates
are rejected. No gate is deleted or replaced for recovery.

## Admission, maintenance and unavailable authority

Byte 0 (A) is exclusive admission; byte 1 (B) is activity. An operation obtains A,
obtains shared B, releases A and retains B for the entire operation. Independent
operations overlap. A contention retries for at most 150 ms; continued contention
returns busy before SQLite opens. Maintenance obtains exclusive A before waiting
for exclusive B and retains both. Errors/deadlines release partial acquisition
with RAII. Process death releases kernel locks; no PID marker, initialization
header or repair state exists.

The desktop always installs a process gate, including when authority is
unavailable. Startup does not abort merely because the barrier cannot open.
The explicit `available` safety status reports successful protected admission.
Window handshakes and editor/confirmation leases remain operational while
unavailable. SQL bootstrap/mutation, capture, copy and autostart changes require
admission and fail closed. Internal preparation validates protected admission
before closing local policy. No production preparation/install IPC is exposed.

Retries use the same resolver until a profile is established, retain that
profile's physical pins even if its private namespace cannot open, and retain
the gate anchor once established. They never select another location, delete a
gate or alter permissions. External fixture permission repair demonstrates
recovery under the same identity. Recovery neither retires editor leases nor
bypasses participant readiness.

The coordinator counts local operations before process admission, then releases
the policy mutex before waiting. Failure rolls accounting back. Preparation
closes local admission, drains local operations/participants, and waits for global
maintenance outside the mutex. It rechecks lifecycle, generation and deadline
after waiting. Global permits drop before local admission reopens. Existing
generation, lease and cancellation policy remains in force.

The native entrypoint uses the same authority. `run_with_storage` owns admission
before StorageState construction, service bootstrap and SQL, through response
writing and final flush. Failure produces the existing framed
`storage_unavailable` response without opening SQLite. Flush completion is the
ownership boundary; browser receipt is not claimed.

This barrier coordinates upgraded same-user participants. It is not a security
boundary against another process acting as that user, privileged actors, legacy
binaries or a nonparticipating installer. Production installation remains disabled.

## Independent installer ownership (MVP)

The updater controller checks metadata in the background and downloads only on
the user's action. A successful SDK download retains immutable authenticated
bytes with the offered version. Restart is a separate, main-window-only command
with no path, URL, key, argument, or artifact input from the WebView. Production
construction still sets `installation_enabled: false`; there is no environment
variable or frontend override. The original isolated visual preview remains
installation-free.

The implemented restart path first rejects any open editor or destructive
confirmation in either window without discarding its lease. It closes local
admission, stages the exact authenticated bytes in a newly created private
directory, waits for generation-bound acknowledgements and existing operations,
and takes global maintenance outside the policy mutex. Staging rejects archives,
malformed PE headers/versions and reparse ancestry; it retains directory pins and
a read-only file handle without write/delete sharing. Bytes are compared against
the authenticated buffer before launching a fixed-argument NSIS process. Final
readiness is rechecked at process creation.

Only successful process creation requests Slate's normal Tauri quit. The
controller keeps its global guard and staging pins until exit; the child NSIS
cannot start application writes until it independently acquires maintenance and
observes Slate's process exit. Launch failure restores normal admission, retains
the verified download and reports a retryable error without closing Slate. The
SDK's Windows `install`/early-exit implementation is not called. After ownership
passes to NSIS, successful installation releases maintenance before `/R` restart;
an installer abort may require manually reopening Slate. No automatic rollback
or forced process termination is added.

This flow is currently exercised with dependency-injected process-creation/quit
boundaries and synthetic staging files, not an installed application. The next
execution gate requires explicit approval for signed test installers in a
disposable Windows profile/VM, including launch failure, interrupted installation,
restart, library retention, and browser capture on both architectures. Production
signing public key, stable endpoint, version bump and installation enablement
remain separate release prerequisites. Synthetic signing/transport verification
alone does not establish installed-update readiness.

The bundled native host has a separate `--export-maintenance-handle <pid>` mode,
dispatched before native framing, app-data resolution or SQLite. It opens the same
validated authority, verifies the receiving process has the same Windows token
user, and duplicates an independently opened **unlocked** gate file and every
retained profile/namespace directory pin into that process. Handles are
non-inheritable; the gate handle must fit 32 bits. Export failures close partial
remote duplicates. The only stdout payload on success is the decimal gate handle.
No paths, credentials, lock files or guardian process are added.

NSIS embeds its own correct-target bundled host in both installer and uninstaller,
extracts it into `$PLUGINSDIR`, and acquires exclusive A then B itself. It does not
inherit locks owned by the exporter. A and B share a 30-second deadline; only
Windows lock-contention errors are retried. The file and pins survive exporter
exit. Cancellation, failure and process death release the NSIS-owned locks through
kernel handle closure. Pins intentionally remain until the NSIS process exits.

The gate is acquired during `.onInit`/`un.onInit`, before hooks, previous-version
uninstallation or install sections. The interactive installer retains it across
the optional Finish-page shortcut action, releasing it immediately before app
restart; silent/passive success releases after all writes and hooks. No installer
invokes a nested previous-version uninstaller while holding this gate. In-place
updates remain supported; uninstall-before-reinstall and WiX migration choices
fail closed with a manual-procedure message.

The force-capable upstream process checks are replaced by read-only Restart
Manager queries for the exact installed desktop and native-host executable paths.
Checks poll for at most 30 seconds and abort for any API error, including session
creation, registration and shutdown of the query session. They never terminate,
close, or request shutdown of applications. A second check precedes install writes
after a possible interactive directory change. No installer has been executed as
part of this implementation's verification.

For a legacy v0.1 transition, the manual library procedure is:

1. Close Slate and all Chromium browsers and keep them closed throughout the
   transition, including any browser background processes/native hosts.
2. With those writers closed, preserve a separate backup of the entire existing
   `%APPDATA%\com.aiclipmemory.desktop` directory, including `clips.sqlite3` and any
   SQLite sidecar files. Do not delete, rename or replace the source library.
3. Use the explicit in-place installation choice. The new installer never runs an
   old uninstaller. If a WiX/uninstall-before-reinstall transition is required,
   stop: that transition requires a separate reviewed manual procedure and is
   unsupported by this MVP. Never select app-data deletion as a migration step.
4. Open the upgraded application after installation finishes and confirm the
   existing library is present before reopening browser capture.

Legacy binaries do not acquire the gate, so neither the barrier nor Restart
Manager establishes proof that a legacy process cannot restart during migration.
This procedure documents the required closed-process condition; it is not runtime
evidence of a tested legacy installation or installed-library migration.

## Disposable evidence and verification

The integration harness includes actual gate/coordinator sources and runs owned
child probes in the test executable. Synthetic root injection is cfg(test)-only
and bounded to the worktree's dist/test. Simulated profiles are created with
private security attributes from creation, not repaired after inheriting workspace
permissions. Enclosing ancestors retain production physical/reparse/pinning checks.
Fixtures and earlier evidence remain under unique
`dist/test/updater-maintenance-gate/<pid>-<timestamp>` directories; no cleanup
or replacement occurs.

Coverage includes shared/exclusive process locks, admission races, simultaneous
first creation and physical-ID convergence, retained handles/blocked replacement,
preexisting/late hardlinks, junctions, readonly/nonordinary files, actual ACL
denial and recovery without replacing the gate, unavailable-authority leases and
preparation rejection, native/desktop SQLite bootstrap rejection and recovery,
lifecycle/deadline checks, response flush barriers, storage/pipe errors and owned
synthetic process death.

The readonly-installation scenario copies an already manifested test harness into
a new fixture installation directory, actually denies file creation with its ACL,
then verifies external-gate identity, SQL success and flush ownership. This is a
disposable test executable, not an actual desktop/native-host launch.

A child environment/CWD test invokes the production token/profile resolver
read-only and compares actual profile IDs. It never invokes the production
gate-creation constructor. No test creates a real-profile coordination namespace.
Unsupported filesystem coverage checks validation logic; runtime evidence is NTFS.

On this host the installation_gate test filename triggers installer detection
without a manifest. Build that target with embedded asInvoker using target-only
link flags, without global RUSTFLAGS, binary patching/renaming, UAC elevation or
production build-script changes:

```powershell
cargo rustc --offline --locked --jobs 2 --manifest-path apps/desktop/src-tauri/Cargo.toml --test installation_gate -- -C link-arg=/MANIFEST:EMBED -C "link-arg=/MANIFESTUAC:level='asInvoker' uiAccess='false'"
# Run the exact executable produced by this build:
& apps/desktop/src-tauri/target/debug/deps/installation_gate-<hash>.exe --test-threads=1

cargo test --offline --locked --jobs 2 --manifest-path apps/desktop/src-tauri/Cargo.toml --lib unavailable_storage_tests -- --test-threads=1
```

ACL tests run in the ordinary signed-in user's filesystem context rather than a
restricted sandbox token; leaving that filesystem sandbox is not Windows UAC
elevation. Runtime evidence is native ARM64 Windows on this host. Cross-target
compilation does not establish x64 runtime, different profile configurations,
installed-application, browser, installer or SDK integration.
