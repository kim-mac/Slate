[CmdletBinding()]
param(
    [string]$X64InstallerPath,
    [string]$Arm64InstallerPath,
    [string]$OutputDirectory,
    [string]$ReleaseVersion
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $PSScriptRoot 'Windows-ReleaseContract.ps1')
$releaseVersion = Get-WindowsReleaseVersion -RepositoryRoot $repositoryRoot -ReleaseVersion $ReleaseVersion

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

Assert-WindowsReleaseOutputPath -Path $OutputDirectory
if (Test-Path -LiteralPath $OutputDirectory) {
    if (-not (Test-Path -LiteralPath $OutputDirectory -PathType Container) -or
        @(Get-ChildItem -LiteralPath $OutputDirectory -Force).Count -ne 0) {
        throw 'Release output must be a new or empty directory; existing artifacts are never overwritten.'
    }
}

foreach ($artifact in $artifacts) {
    if (-not (Test-Path -LiteralPath $artifact.Source -PathType Leaf)) {
        throw "Required installer not found: $($artifact.Source)"
    }
    $suffix = if ($artifact.Name.EndsWith('-x64.exe')) { 'x64' } else { 'arm64' }
    if ([System.IO.Path]::GetFileName($artifact.Source) -cne "AI Clip Memory_${releaseVersion}_${suffix}-setup.exe") {
        throw 'Source installer filename must match the candidate version and architecture.'
    }
}

[System.IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
foreach ($artifact in $artifacts) {

    $sourcePath = (Resolve-Path -LiteralPath $artifact.Source).Path
    $destinationPath = Join-Path $OutputDirectory $artifact.Name
    [System.IO.File]::Copy($sourcePath, $destinationPath, $false)

    $sourceHash = Get-Sha256 -Path $sourcePath
    $destinationHash = Get-Sha256 -Path $destinationPath
    if ($sourceHash -cne $destinationHash) {
        throw "The staged installer is not byte-for-byte identical: $($artifact.Name)"
    }

    Write-Output $destinationPath
}

& (Join-Path $PSScriptRoot 'Write-ReleaseChecksums.ps1') -ReleaseDirectory $OutputDirectory
