# Shared read-only candidate checks. No build, signing, staging or publication.
function Get-WindowsReleaseVersion {
    param([string]$RepositoryRoot, [string]$ReleaseVersion)

    $rootVersion = (Get-Content -Raw -LiteralPath (Join-Path $RepositoryRoot 'package.json') | ConvertFrom-Json).version
    if ([string]::IsNullOrWhiteSpace($ReleaseVersion)) { $ReleaseVersion = $rootVersion }
    if ($ReleaseVersion -cnotmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' -or
        @($ReleaseVersion.Split('.') | Where-Object { $_.Length -gt 5 -or [int]$_ -gt 65535 }).Count -ne 0) {
        throw 'ReleaseVersion must be canonical MAJOR.MINOR.PATCH with Windows version components at most 65535.'
    }
    $versions = @($rootVersion)
    foreach ($name in @('apps/desktop/package.json', 'apps/desktop/src-tauri/tauri.conf.json')) {
        $versions += (Get-Content -Raw -LiteralPath (Join-Path $RepositoryRoot $name) | ConvertFrom-Json).version
    }
    $cargo = Get-Content -Raw -LiteralPath (Join-Path $RepositoryRoot 'apps/desktop/src-tauri/Cargo.toml')
    $package = [regex]::Match($cargo, '(?ms)^\[package\]\s*(.*?)(?=^\[|\z)').Groups[1].Value
    $versions += [regex]::Match($package, '(?m)^version\s*=\s*"([^"]+)"\s*$').Groups[1].Value
    $lock = Get-Content -Raw -LiteralPath (Join-Path $RepositoryRoot 'apps/desktop/src-tauri/Cargo.lock')
    $versions += [regex]::Match($lock, '(?m)^name = "ai-clip-memory-desktop"\r?\nversion = "([^"]+)"').Groups[1].Value
    if (@($versions | Where-Object { $_ -cne $ReleaseVersion }).Count -ne 0) {
        throw 'ReleaseVersion must match root/Desktop package, Tauri, Cargo package and Cargo lock versions. Update reviewed candidate sources first; this script never rewrites versions.'
    }
    return $ReleaseVersion
}

function Assert-WindowsReleaseOutputPath {
    param([string]$Path)

    $absolute = [System.IO.Path]::GetFullPath($Path)
    if ($absolute -match '(?i)[\\/]dist[\\/]release[\\/]v0\.1\.0(?:[\\/]|$)') {
        throw 'Frozen dist/release/v0.1.0 must not be written by candidate tooling.'
    }
    $ancestor = $absolute
    while ($ancestor) {
        $item = $null
        try { $item = Get-Item -LiteralPath $ancestor -Force -ErrorAction Stop }
        catch [System.Management.Automation.ItemNotFoundException] { }
        catch { throw 'Unable to verify release output ancestry; no output is permitted.' }
        if ($null -ne $item -and ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
            throw 'Release output paths must not traverse links or junctions.'
        }
        $parent = [System.IO.Path]::GetDirectoryName($ancestor)
        if ($parent -eq $ancestor) { break }
        $ancestor = $parent
    }
}
