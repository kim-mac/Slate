# Isolated updater visual review

This debug-only Cargo example renders the actual Slate `App`, sidebar,
updater notice, and Settings components with a deterministic updater client.
It is not an installer and is not imported by production frontend entry points.

## Run in the updater worktree only

Start Vite using installed dependencies:

```powershell
pnpm --filter @ai-clip-memory/desktop exec vite --port 1421
```

In a separate terminal, build/run the example using the existing target cache:

```powershell
cargo run --offline --manifest-path apps/desktop/src-tauri/Cargo.toml --example updater_visual
```

The example refuses release builds and a checkout not named
`codex-desktop-updater`. Each launch creates a fresh, non-reused profile under
`dist/test/updater-visual-review/profile-<PID>` containing only synthetic data.
SQLite reads are read-only. WebView storage (including theme preferences) uses
that profile's `webview` directory. Reparse/symlink paths are rejected.

Only synthetic `list_clips`, disabled launcher status, and application version
IPC are allowed. There are no production plugins, updater transports,
installation commands, autostart, tray, global shortcuts, or registry hooks.
Library mutations, clipboard access, opening sources, and startup changes are
disabled. Update Now changes mock state only. Restart to update stays disabled.

Use the bottom-right scenario selector for available, 60% progress, failure,
and verified states; use real Slate Settings, theme and sidebar controls.
Screenshots are saved alongside these profiles. Close the preview normally
after review; never use it for production data or signed-update testing.

## Verification plan

1. Run preview/component regressions and native example tests.
2. Check types, lint, formatting, production frontend exclusion, and link guards.
3. Review isolation before launching the unique preview window.
4. Review all mock states in both themes; test collapsed sidebar and keyboard.
5. Compare pending implementation/protected asset hashes and disk usage afterward.

This harness tests rendering and interaction only, not download/signature or
installation behavior. Those require the later separately approved checkpoint.
