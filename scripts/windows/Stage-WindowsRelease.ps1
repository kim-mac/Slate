[CmdletBinding()]
param(
    [string]$X64InstallerPath,
    [string]$Arm64InstallerPath,
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$rootPackage = Get-Content -Raw -LiteralPath (Join-Path $repositoryRoot 'package.json') | ConvertFrom-Json
$releaseVersion = $rootPackage.version

function Get-Sha256 {
    param([string]$Path)

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        return [System.BitConverter]::ToString($sha256.ComputeHash($stream)).Replace('-', '')
    }
    finally {
        $stream.Dispose()
        $sha256.Dispose()
    }
}

if ($releaseVersion -cnotmatch '^\d+\.\d+\.\d+$') {
    throw 'The root package version is not a valid release version.'
}

if ([string]::IsNullOrWhiteSpace($X64InstallerPath)) {
    $X64InstallerPath = Join-Path $repositoryRoot "apps\desktop\src-tauri\target\x86_64-pc-windows-msvc\release\bundle\nsis\AI Clip Memory_${releaseVersion}_x64-setup.exe"
}
if ([string]::IsNullOrWhiteSpace($Arm64InstallerPath)) {
    $Arm64InstallerPath = Join-Path $repositoryRoot "apps\desktop\src-tauri\target\aarch64-pc-windows-msvc\release\bundle\nsis\AI Clip Memory_${releaseVersion}_arm64-setup.exe"
}
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $repositoryRoot "dist\release\v$releaseVersion"
}

$artifacts = @(
    [pscustomobject]@{
        Source = $X64InstallerPath
        Name   = "Slate-$releaseVersion-Windows-x64.exe"
    }
    [pscustomobject]@{
        Source = $Arm64InstallerPath
        Name   = "Slate-$releaseVersion-Windows-ARM64.exe"
    }
)

[System.IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null

foreach ($artifact in $artifacts) {
    if (-not (Test-Path -LiteralPath $artifact.Source -PathType Leaf)) {
        throw "Required installer not found: $($artifact.Source)"
    }

    $sourcePath = (Resolve-Path -LiteralPath $artifact.Source).Path
    $destinationPath = Join-Path $OutputDirectory $artifact.Name
    Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force

    $sourceHash = Get-Sha256 -Path $sourcePath
    $destinationHash = Get-Sha256 -Path $destinationPath
    if ($sourceHash -cne $destinationHash) {
        Remove-Item -LiteralPath $destinationPath -Force -ErrorAction SilentlyContinue
        throw "The staged installer is not byte-for-byte identical: $($artifact.Name)"
    }

    Write-Output $destinationPath
}

& (Join-Path $PSScriptRoot 'Write-ReleaseChecksums.ps1') -ReleaseDirectory $OutputDirectory
