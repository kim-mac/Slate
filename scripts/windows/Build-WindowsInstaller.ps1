[CmdletBinding()]
param(
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
$extensionManifestPath = Join-Path $repositoryRoot 'apps\extension\public\manifest.json'
$releaseIdentityPath = Join-Path $repositoryRoot 'apps\extension\release-identity.json'

$extensionManifest = Get-Content -Raw -LiteralPath $extensionManifestPath | ConvertFrom-Json
$releaseIdentity = Get-Content -Raw -LiteralPath $releaseIdentityPath | ConvertFrom-Json
$chromeExtensionId = ConvertTo-ChromiumExtensionId -PublicKey $extensionManifest.key
$chromeWebStoreExtensionId = $releaseIdentity.chromeWebStoreExtensionId
$edgeExtensionId = $releaseIdentity.edgeExtensionId
Assert-ExtensionId -Name 'Derived Chrome extension ID' -Value $chromeExtensionId
Assert-ExtensionId -Name 'Configured Chrome Web Store extension ID' -Value $chromeWebStoreExtensionId
Assert-ExtensionId -Name 'Configured Edge extension ID' -Value $edgeExtensionId
if ($chromeExtensionId -ceq $chromeWebStoreExtensionId -or
    $chromeExtensionId -ceq $edgeExtensionId -or
    $chromeWebStoreExtensionId -ceq $edgeExtensionId) {
    throw 'Development Chrome, Chrome Web Store, and Edge release extension IDs must be distinct.'
}

if (-not [string]::IsNullOrWhiteSpace($OutputDirectory) -and -not $ManifestOnly) {
    throw 'OutputDirectory may only be overridden with ManifestOnly.'
}
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = $defaultOutputDirectory
}

$allowedOrigins = @(
    "chrome-extension://$chromeExtensionId/"
    "chrome-extension://$chromeWebStoreExtensionId/"
    "chrome-extension://$edgeExtensionId/"
)

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
