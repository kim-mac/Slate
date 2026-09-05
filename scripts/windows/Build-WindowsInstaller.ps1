[CmdletBinding()]
param(
    [string]$ChromeExtensionId,
    [string]$EdgeExtensionId,

    [ValidateSet('x64', 'arm64')]
    [string]$Architecture,

    [string]$OutputDirectory,

    [switch]$ManifestOnly
)

$ErrorActionPreference = 'Stop'
$hostName = 'com.aiclipmemory.bridge'
$hostExecutable = 'ai-clip-memory-native-host.exe'
$extensionIdPattern = '^[a-p]{32}$'
$releaseVersion = '0.1.0'

function Assert-ExtensionId {
    param(
        [string]$Name,
        [string]$Value
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw "$Name is required."
    }
    if ($Value -cnotmatch $extensionIdPattern) {
        throw "$Name must contain exactly 32 lowercase letters from a through p."
    }
}

Assert-ExtensionId -Name 'ChromeExtensionId' -Value $ChromeExtensionId
Assert-ExtensionId -Name 'EdgeExtensionId' -Value $EdgeExtensionId

if ([string]::IsNullOrWhiteSpace($Architecture)) {
    throw 'Architecture is required and must be x64 or arm64.'
}

$architectureConfiguration = switch ($Architecture) {
    'x64' {
        [pscustomobject]@{
            TargetTriple   = 'x86_64-pc-windows-msvc'
            ArtifactSuffix = 'x64-setup.exe'
        }
    }
    'arm64' {
        [pscustomobject]@{
            TargetTriple   = 'aarch64-pc-windows-msvc'
            ArtifactSuffix = 'arm64-setup.exe'
        }
    }
}

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$tauriDirectory = Join-Path $repositoryRoot 'apps\desktop\src-tauri'
$templatePath = Join-Path $tauriDirectory 'windows\native-messaging-host.json.template'
$defaultOutputDirectory = Join-Path $tauriDirectory 'windows\generated'

if (-not [string]::IsNullOrWhiteSpace($OutputDirectory) -and -not $ManifestOnly) {
    throw 'OutputDirectory may only be overridden with ManifestOnly.'
}
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = $defaultOutputDirectory
}

$allowedOrigins = @(
    "chrome-extension://$ChromeExtensionId/"
    "chrome-extension://$EdgeExtensionId/"
) | Sort-Object -Unique

$manifest = Get-Content -Raw -LiteralPath $templatePath | ConvertFrom-Json
$manifest.allowed_origins = @($allowedOrigins)

[System.IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
$manifestPath = Join-Path $OutputDirectory "$hostName.json"
$manifestJson = $manifest | ConvertTo-Json -Depth 3
[System.IO.File]::WriteAllText(
    $manifestPath,
    $manifestJson,
    [System.Text.UTF8Encoding]::new($false)
)

$validatedManifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$validatedOrigins = @($validatedManifest.allowed_origins)
if ($validatedManifest.name -cne $hostName) {
    throw 'Generated manifest has an invalid host name.'
}
if ($validatedManifest.path -cne $hostExecutable) {
    throw 'Generated manifest has an invalid native-host path.'
}
if ($validatedManifest.type -cne 'stdio') {
    throw 'Generated manifest has an invalid transport type.'
}
if ($validatedOrigins.Count -ne $allowedOrigins.Count) {
    throw 'Generated manifest has an invalid allowed_origins list.'
}
foreach ($origin in $allowedOrigins) {
    if ($validatedOrigins -cnotcontains $origin) {
        throw 'Generated manifest is missing an exact extension origin.'
    }
}
if ($manifestJson.Contains('*') -or $manifestJson -match '(?i)placeholder') {
    throw 'Generated manifest contains a forbidden wildcard or placeholder.'
}

if ($ManifestOnly) {
    Write-Output $manifestPath
    return
}

$installedTargets = @(& rustup target list --installed)
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to inspect installed Rust targets.'
}
if ($installedTargets -notcontains $architectureConfiguration.TargetTriple) {
    throw "Rust target $($architectureConfiguration.TargetTriple) is not installed. Install it explicitly before building."
}

Push-Location $repositoryRoot
try {
    $pnpmCommand = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
    if ($null -ne $pnpmCommand) {
        & $pnpmCommand.Source --filter '@ai-clip-memory/desktop' exec tauri build --bundles nsis --target $architectureConfiguration.TargetTriple
    }
    else {
        & corepack pnpm --filter '@ai-clip-memory/desktop' exec tauri build --bundles nsis --target $architectureConfiguration.TargetTriple
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Tauri failed to build the $Architecture NSIS installer."
    }
}
finally {
    Pop-Location
}

$bundleDirectory = Join-Path $tauriDirectory "target\$($architectureConfiguration.TargetTriple)\release\bundle\nsis"
$expectedArtifactName = "AI Clip Memory_${releaseVersion}_$($architectureConfiguration.ArtifactSuffix)"
$artifact = Get-ChildItem -LiteralPath $bundleDirectory -File |
    Where-Object { $_.Name -eq $expectedArtifactName } |
    Select-Object -First 1

if ($null -eq $artifact) {
    throw "The expected $Architecture-labelled NSIS artifact was not produced."
}

Write-Output $artifact.FullName
