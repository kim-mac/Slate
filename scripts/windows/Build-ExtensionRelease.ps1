[CmdletBinding()]
param(
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$extensionDirectory = Join-Path $repositoryRoot 'apps\extension'
$extensionOutputDirectory = Join-Path $extensionDirectory 'dist'
$sourceManifestPath = Join-Path $extensionDirectory 'public\manifest.json'
$rootPackage = Get-Content -Raw -LiteralPath (Join-Path $repositoryRoot 'package.json') | ConvertFrom-Json
$releaseVersion = $rootPackage.version
$expectedChromeId = 'jjfaegknedfakmidhhdlmbebnjafcjfi'
$expectedPermissions = @('activeTab', 'contextMenus', 'nativeMessaging', 'notifications')
$expectedMatches = @(
    'https://chatgpt.com/*'
    'https://chat.openai.com/*'
    'https://claude.ai/*'
    'https://gemini.google.com/*'
)
$expectedIcons = [ordered]@{
    '16'  = 'icons/icon-16.png'
    '32'  = 'icons/icon-32.png'
    '48'  = 'icons/icon-48.png'
    '128' = 'icons/icon-128.png'
}
$expectedFiles = @(
    'background.js'
    'content.js'
    'icons/icon-16.png'
    'icons/icon-32.png'
    'icons/icon-48.png'
    'icons/icon-128.png'
    'icons/notification.png'
    'manifest.json'
)
$forbiddenReleasePatterns = @(
    '*.map'
    '*.test.*'
    '*.spec.*'
    '*.ts'
    '*.tsx'
)

function ConvertTo-ChromiumExtensionId {
    param([string]$PublicKey)

    if ([string]::IsNullOrWhiteSpace($PublicKey)) {
        throw 'The production extension manifest must contain a public key.'
    }

    try {
        $publicKeyBytes = [System.Convert]::FromBase64String($PublicKey)
    }
    catch {
        throw 'The production extension manifest key must be valid base64.'
    }

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $digest = $sha256.ComputeHash($publicKeyBytes)
    }
    finally {
        $sha256.Dispose()
    }

    $alphabet = 'abcdefghijklmnop'
    $extensionId = [System.Text.StringBuilder]::new(32)
    foreach ($value in $digest[0..15]) {
        [void]$extensionId.Append($alphabet[[int]($value -shr 4)])
        [void]$extensionId.Append($alphabet[[int]($value -band 0x0f)])
    }

    return $extensionId.ToString()
}

function Assert-ExactArray {
    param(
        [string]$Name,
        [object[]]$Actual,
        [string[]]$Expected
    )

    if ($Actual.Count -ne $Expected.Count) {
        throw "$Name does not contain the expected number of entries."
    }
    for ($index = 0; $index -lt $Expected.Count; $index++) {
        if ($Actual[$index] -cne $Expected[$index]) {
            throw "$Name does not match the approved release configuration."
        }
    }
}

function New-DeterministicZip {
    param(
        [string]$SourceDirectory,
        [string]$DestinationPath
    )

    Add-Type -AssemblyName System.IO.Compression
    if (Test-Path -LiteralPath $DestinationPath) {
        Remove-Item -LiteralPath $DestinationPath -Force
    }

    $stream = [System.IO.File]::Open($DestinationPath, [System.IO.FileMode]::CreateNew)
    try {
        $archive = [System.IO.Compression.ZipArchive]::new(
            $stream,
            [System.IO.Compression.ZipArchiveMode]::Create,
            $false
        )
        try {
            $files = Get-ChildItem -LiteralPath $SourceDirectory -Recurse -File |
                Sort-Object { $_.FullName.Substring($SourceDirectory.Length).Replace('\', '/') }
            foreach ($file in $files) {
                $entryName = $file.FullName.Substring($SourceDirectory.Length).TrimStart('\').Replace('\', '/')
                $entry = $archive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
                $entry.LastWriteTime = [System.DateTimeOffset]::new(1980, 1, 1, 0, 0, 0, [System.TimeSpan]::Zero)
                $entryStream = $entry.Open()
                $fileStream = [System.IO.File]::OpenRead($file.FullName)
                try {
                    $fileStream.CopyTo($entryStream)
                }
                finally {
                    $fileStream.Dispose()
                    $entryStream.Dispose()
                }
            }
        }
        finally {
            $archive.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }
}

if ($releaseVersion -cnotmatch '^\d+\.\d+\.\d+$') {
    throw 'The root package version is not a valid release version.'
}
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $repositoryRoot "dist\release\v$releaseVersion"
}

if (Test-Path -LiteralPath $OutputDirectory) {
    $allowedStagedNames = @(
        "Slate-Extension-$releaseVersion.zip"
        "Slate-$releaseVersion-Windows-x64.exe"
        "Slate-$releaseVersion-Windows-ARM64.exe"
        'SHA256SUMS.txt'
    )
    $unexpectedEntries = @(
        Get-ChildItem -LiteralPath $OutputDirectory |
            Where-Object { $_.PSIsContainer -or $allowedStagedNames -cnotcontains $_.Name }
    )
    if ($unexpectedEntries.Count -gt 0) {
        throw 'The release directory contains unexpected entries; clean it manually before packaging.'
    }

    foreach ($ownedName in @("Slate-Extension-$releaseVersion.zip", 'SHA256SUMS.txt')) {
        $ownedPath = Join-Path $OutputDirectory $ownedName
        if (Test-Path -LiteralPath $ownedPath -PathType Leaf) {
            Remove-Item -LiteralPath $ownedPath -Force
        }
    }
}
[System.IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null

if (Test-Path -LiteralPath $extensionOutputDirectory) {
    Remove-Item -LiteralPath $extensionOutputDirectory -Recurse -Force
}

Push-Location $repositoryRoot
try {
    $pnpmCommand = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
    if ($null -ne $pnpmCommand) {
        & $pnpmCommand.Source build:extension
    }
    else {
        & corepack pnpm build:extension
    }
    if ($LASTEXITCODE -ne 0) {
        throw 'The production extension build failed.'
    }
}
finally {
    Pop-Location
}

$manifestPath = Join-Path $extensionOutputDirectory 'manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw 'The production extension build did not emit manifest.json.'
}

$sourceManifest = Get-Content -Raw -LiteralPath $sourceManifestPath | ConvertFrom-Json
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
if ($manifest.name -cne 'Slate' -or $manifest.version -cne $releaseVersion) {
    throw 'The built extension name or version is not the approved release identity.'
}
if ($manifest.key -cne $sourceManifest.key) {
    throw 'The built extension manifest key differs from the source manifest.'
}
if ((ConvertTo-ChromiumExtensionId -PublicKey $manifest.key) -cne $expectedChromeId) {
    throw 'The built extension manifest key does not derive the approved Chrome ID.'
}
Assert-ExactArray -Name 'permissions' -Actual @($manifest.permissions) -Expected $expectedPermissions
Assert-ExactArray -Name 'content_scripts matches' -Actual @($manifest.content_scripts[0].matches) -Expected $expectedMatches
foreach ($size in $expectedIcons.Keys) {
    if ($manifest.icons.$size -cne $expectedIcons[$size]) {
        throw "The built extension is missing the approved $size pixel icon."
    }
}
if (@($manifest.icons.psobject.Properties).Count -ne $expectedIcons.Count) {
    throw 'The built extension contains an unexpected icon declaration.'
}
if ($null -ne $manifest.host_permissions) {
    throw 'The release extension must not declare host_permissions.'
}

$actualFiles = @(
    Get-ChildItem -LiteralPath $extensionOutputDirectory -Recurse -File |
        ForEach-Object { $_.FullName.Substring($extensionOutputDirectory.Length).TrimStart('\').Replace('\', '/') } |
        Sort-Object
)
$sortedExpectedFiles = @($expectedFiles | Sort-Object)
Assert-ExactArray -Name 'release files' -Actual $actualFiles -Expected $sortedExpectedFiles

foreach ($pattern in $forbiddenReleasePatterns) {
    if ($actualFiles | Where-Object { $_ -like $pattern }) {
        throw "The release extension contains a forbidden file matching $pattern."
    }
}

$zipPath = Join-Path $OutputDirectory "Slate-Extension-$releaseVersion.zip"
New-DeterministicZip -SourceDirectory $extensionOutputDirectory -DestinationPath $zipPath
& (Join-Path $PSScriptRoot 'Write-ReleaseChecksums.ps1') -ReleaseDirectory $OutputDirectory | Out-Null

Write-Output $zipPath
