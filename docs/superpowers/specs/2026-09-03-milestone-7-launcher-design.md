# Milestone 7 launcher design

Approved: a separate 640x420 logical-pixel launcher, Ctrl+Shift+Space on Windows,
no tray/autostart/background service, no paste injection or action menu. Closing
main exits. The app must be running; minimized is sufficient.

Reuse existing ClipClient list/copy commands, ClipService, SQLite and M6 pure
retrieval helpers. Do not modify main library behavior, schema, repository,
bridge, extension or Milestone 8. Use existing monochrome system theme.

Rust creates one hidden undecorated launcher window, bounds it to monitor work
area, registers the official global-shortcut plugin and hides on blur/close.
Windows integration lives under platform/windows.rs; shared lifecycle policy
lives in launcher.rs. A readiness handshake preserves early activation.

The launcher-state event contains only {session, visible}. A new opening advances
the session, resets query and reloads clips; repeated activation focuses the
same session. Hide requests include the session token so delayed requests cannot
dismiss a newer opening. No content is transmitted in lifecycle events.

Frontend: focus search, Up/Down select while typing, Enter copies stored ID and
hides after success, Escape hides without copy. Ignore IME/repeated/modified
Enter and stale completion. Retryable generic errors do not echo input. Only
the result pane scrolls. No sidebar, editing, filters or added dependencies.

Only main may invoke the seven existing clip commands and get_launcher_status.
Launcher may invoke list_clips, copy_clip_content, launcher_ready, hide_launcher,
and event listen/unlisten. Explicit command ACLs, exact window labels, no plugin
clipboard/window/filesystem/opener/global-shortcut permissions in JavaScript.
No new JS plugin. No macOS implementation. Main displays a safe notice only if
Windows shortcut registration fails; main itself remains functional.

Verification: test-first frontend behaviors/races, native policy/bounds/errors,
capability separation, existing workspace regressions, all builds/checks and
real Windows launch/copy/dismiss/conflict/exit checks. Do not commit.
