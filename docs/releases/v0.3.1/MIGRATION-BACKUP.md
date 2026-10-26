# Cold backup before the real v0.3.0 → v0.3.1 update

**Instructions only. This procedure has not been run on either real baseline during release preparation.** Do not delete data, uninstall Slate, start migrations or copy a live SQLite database.

## Record each baseline

Use each machine's own account and user profile:

- ARM64 laptop: KIMS\kim16; schema 2; 7 clips, 2 groups, 2 standalone clips, 2 pinned items.
- x64 PC: Heatherway; record the actual signed-in account; schema 2; 6 clips, 2 groups, 2 pinned items, including one Chrome capture.

Before quitting, record representative clip/group titles, group member order, edited content, pinned items, theme and relevant settings. These are the observations to compare after the real update, not proof that migration already passed.

## Make a cold copy — future manual execution only

1. Finish and save edits. Close Chrome and Edge, then Quit production Slate using its tray menu. Do not terminate processes automatically or launch another Slate version.
2. Use a normal PowerShell terminal on the machine being backed up. The block below checks restored version 0.3.0, refuses remaining same-session browser/Slate processes and production or unidentified WebView2 processes, and refuses links/junctions.
3. It creates a unique protected folder under `%LOCALAPPDATA%\SlateMigrationBackups`, outside Slate's production application-data directories. Verify the underlying storage is encrypted; retain the backup outside Git and synchronized folders. Never upload private library backups as release assets.
4. It copies all regular files from both `%APPDATA%\com.aiclipmemory.desktop` and `%LOCALAPPDATA%\com.aiclipmemory.desktop`, including any SQLite WAL/SHM files, preferences and WebView2 data. Missing Local data is allowed; the Roaming database is mandatory. Source-directory existence is recorded in the protected inventory.
5. Every copied file is hash-checked, then the source inventory is checked again. A failure is not PASS; leave partial backups intact and investigate. Nothing is silently deleted or overwritten.
6. Record the returned backup path separately for ARM64 and x64, and retain the protected inventory. A second copy on separately protected encrypted storage is recommended for independent recovery.

The block is intended for Windows PowerShell 5.1 or PowerShell 7; its syntax is checked during preparation. Actual OS/ACL/copy execution on each real profile still requires the future manual backup step. If an isolated development instance is reported, stop and identify it rather than automatically closing it.

```powershell
& {
    $ErrorActionPreference = 'Stop'
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'STOP: use a normal, non-administrator terminal.'
    }
    $sid = $identity.User
    $session = (Get-Process -Id $PID).SessionId
    $installedRoot = Join-Path $env:LOCALAPPDATA 'AI Clip Memory'
    $exe = Join-Path $installedRoot 'ai-clip-memory-desktop.exe'
    if ((Get-Item -LiteralPath $exe).VersionInfo.ProductVersion -cne '0.3.0') {
        throw 'STOP: expected the restored official v0.3.0 installation.'
    }
    function Assert-Cold {
        $names = @('chrome','msedge','ai-clip-memory-desktop','ai-clip-memory-native-host','slate-maintenance-host')
        $running = @(Get-Process -Name $names -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq $session })
        if ($running.Count) {
            throw 'STOP: browsers or Slate-related processes remain. Do not kill an isolated development instance; investigate its path.'
        }
        $webviews = @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.SessionId -eq $session })
        foreach ($view in $webviews) {
            if (-not $view.CommandLine -or $view.CommandLine.Contains('com.aiclipmemory.desktop')) {
                throw 'STOP: production or unidentified WebView2 process remains.'
            }
        }
    }
    function Assert-Ancestry([string]$path) {
        $walk = [IO.Path]::GetFullPath($path)
        while ($walk) {
            $item = Get-Item -LiteralPath $walk -Force
            if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                throw 'STOP: unsafe directory ancestry.'
            }
            if (Test-Path -LiteralPath (Join-Path $walk '.git')) {
                throw 'STOP: backup/data location is inside Git ancestry.'
            }
            $parent = [IO.Directory]::GetParent($walk)
            if ($null -eq $parent) { break }
            $walk = $parent.FullName
        }
    }
    $sources = [ordered]@{
        Roaming = Join-Path $env:APPDATA 'com.aiclipmemory.desktop'
        Local = Join-Path $env:LOCALAPPDATA 'com.aiclipmemory.desktop'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $sources.Roaming 'clips.sqlite3') -PathType Leaf)) {
        throw 'STOP: expected production database was not found.'
    }
    function Get-ColdInventory {
        $list = [Collections.Generic.List[object]]::new()
        foreach ($kind in $sources.Keys) {
            $root = $sources[$kind]
            if (-not (Test-Path -LiteralPath $root)) { continue }
            Assert-Ancestry $root
            $stack = [Collections.Generic.Stack[string]]::new()
            $stack.Push($root)
            while ($stack.Count) {
                $directory = $stack.Pop()
                foreach ($item in Get-ChildItem -LiteralPath $directory -Force) {
                    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                        throw 'STOP: a source entry is a link or junction.'
                    }
                    if ($item.PSIsContainer) { $stack.Push($item.FullName); continue }
                    $relative = $item.FullName.Substring($root.TrimEnd('\').Length + 1)
                    $list.Add([pscustomobject]@{
                        Kind = $kind; Relative = $relative; FullName = $item.FullName
                        Bytes = $item.Length
                        SHA256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash
                    })
                }
            }
        }
        return $list.ToArray()
    }
    Assert-Cold
    $before = @(Get-ColdInventory | Sort-Object Kind,Relative)
    $backupParent = Join-Path $env:LOCALAPPDATA 'SlateMigrationBackups'
    if (-not (Test-Path -LiteralPath $backupParent)) {
        [void][IO.Directory]::CreateDirectory($backupParent)
    }
    Assert-Ancestry $backupParent
    foreach ($syncRoot in @($env:OneDrive,$env:OneDriveCommercial,$env:OneDriveConsumer)) {
        if ($syncRoot -and $backupParent.StartsWith($syncRoot.TrimEnd('\') + '\',[StringComparison]::OrdinalIgnoreCase)) {
            throw 'STOP: backup location is synchronized.'
        }
    }
    $drive = Get-PSDrive -Name ([IO.Path]::GetPathRoot($backupParent).Substring(0,1))
    $required = [long](($before | Measure-Object Bytes -Sum).Sum * 2 + 104857600)
    if ($drive.Free -lt $required) { throw 'STOP: insufficient backup disk space.' }
    $backup = Join-Path $backupParent ('pre-v031-' + [guid]::NewGuid().ToString('N'))
    if (Test-Path -LiteralPath $backup) { throw 'STOP: backup destination already exists.' }
    [void][IO.Directory]::CreateDirectory($backup)
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetOwner($sid)
    $acl.SetAccessRuleProtection($true,$false)
    $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
    $propagation = [Security.AccessControl.PropagationFlags]::None
    $allow = [Security.AccessControl.AccessControlType]::Allow
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,[Security.AccessControl.FileSystemRights]::Modify,$inherit,$propagation,$allow))
    $system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($system,[Security.AccessControl.FileSystemRights]::FullControl,$inherit,$propagation,$allow))
    Set-Acl -LiteralPath $backup -AclObject $acl
    $actual = Get-Acl -LiteralPath $backup
    if (-not $actual.AreAccessRulesProtected -or $actual.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $sid.Value) {
        throw 'STOP: backup ACL/ownership verification failed; do not copy data.'
    }
    $rules = @($actual.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
    if ($rules.Count -ne 2 -or @($rules | Where-Object { $_.AccessControlType -ne $allow -or $_.IdentityReference.Value -notin @($sid.Value,'S-1-5-18') }).Count) {
        throw 'STOP: unexpected backup access entries.'
    }
    foreach ($file in $before) {
        $destination = [IO.Path]::GetFullPath((Join-Path (Join-Path $backup $file.Kind) $file.Relative))
        if (-not $destination.StartsWith($backup + '\',[StringComparison]::OrdinalIgnoreCase)) {
            throw 'STOP: unexpected copy destination.'
        }
        [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination))
        [IO.File]::Copy($file.FullName,$destination,$false)
        if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -cne $file.SHA256) {
            throw 'STOP: backup file hash mismatch. Preserve the partial backup.'
        }
    }
    Assert-Cold
    $after = @(Get-ColdInventory | Sort-Object Kind,Relative)
    if (($before | ConvertTo-Json -Depth 4 -Compress) -cne ($after | ConvertTo-Json -Depth 4 -Compress)) {
        throw 'STOP: source files changed during backup. Preserve this backup and investigate.'
    }
    $record = [ordered]@{
        Version = '0.3.0'; Machine = $env:COMPUTERNAME; Account = $identity.Name
        CompletedUtc = [DateTime]::UtcNow.ToString('o'); SourceDirectories = $sources
        SourceDirectoryExists = [ordered]@{
            Roaming = (Test-Path -LiteralPath $sources.Roaming -PathType Container)
            Local = (Test-Path -LiteralPath $sources.Local -PathType Container)
        }
        Files = @($before | Select-Object Kind,Relative,Bytes,SHA256)
    }
    $json = $record | ConvertTo-Json -Depth 6
    [IO.File]::WriteAllText((Join-Path $backup 'BACKUP-INVENTORY.json'),$json,[Text.UTF8Encoding]::new($false))
    Write-Host 'COLD BACKUP VERIFIED. Production source files were not changed.'
    Write-Host $backup
}
```

## Before approving activation

- Confirm a complete verified cold backup exists on each PC.
- Confirm the recorded representative data is intact after reopening **v0.3.0**, then quit it again as needed for the controlled update.
- Keep the original backup immutable; normal v0.3.0 reopening can change the live database/WebView profile, so do not confuse the backup with the live folders.
- If any clips, groups, pins or settings change after the backup, make a fresh verified cold backup before upgrading.
- Keep the official v0.3.0 rollback installer/signature separately verified. Do not remove or modify the frozen v0.3.1 artifacts.
- Do not open the backup with a read/write SQLite client or use it as the running app's database.

## Recovery boundary

No automated restore is supplied because it could overwrite real user data. Request separate approval for a specific recovery after identifying installed version, schema and completed installer state.

If a post-update failure occurs, save the error and preserve a cold copy of the **post-upgrade** data as well. Prefer a forward fix. Do not delete data to make an update test pass, run 0.3.0 against schema 3, or restore only one SQLite file while other live state/WAL files remain.

A separately approved downgrade recovery must verify the official v0.3.0 installer, establish that every relevant process has exited, preserve the failed installation/data, and restore the complete compatible schema-2 snapshot into the correct account's directories while cold. The exact directory swap and installer sequence must be reviewed for that failure; it is deliberately not executed here. Restoring the old snapshot loses later changes, and schema 3 has no reverse migration.

Manifest rollback affects discovery only; it does not undo installs, reverse database migrations or revoke cached offers. See [ACTIVATION-CHECKLIST.md](ACTIVATION-CHECKLIST.md).
