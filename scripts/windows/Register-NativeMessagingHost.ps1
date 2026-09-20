[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Chrome', 'Edge', 'Both')]
    [string]$Browser,

    [Parameter(Mandatory = $true)]
    [string[]]$ExtensionId,

    [Parameter(Mandatory = $true)]
    [string]$HostPath
)

$ErrorActionPreference = 'Stop'
$hostName = 'com.aiclipmemory.bridge'
$extensionIdPattern = '^[a-p]{32}$'

if ($HostPath -notmatch '^(?:[A-Za-z]:[\\/]|\\\\)') {
    throw 'HostPath must be an absolute path.'
}

$resolvedHostPath = (Resolve-Path -LiteralPath $HostPath).Path
if (-not (Test-Path -LiteralPath $resolvedHostPath -PathType Leaf)) {
    throw 'HostPath must point to an existing native-host executable.'
}

$allowedOrigins = foreach ($id in $ExtensionId) {
    if ($id -cnotmatch $extensionIdPattern) {
        throw 'Each ExtensionId must contain exactly 32 lowercase letters from a through p.'
    }
    "chrome-extension://$id/"
}
$allowedOrigins = @($allowedOrigins | Sort-Object -Unique)

$manifestDirectory = Join-Path $env:LOCALAPPDATA 'AI Clip Memory\NativeMessaging'
$manifestPath = Join-Path $manifestDirectory "$hostName.json"
$manifest = [ordered]@{
    name            = $hostName
    description     = 'Slate local capture bridge'
    path            = $resolvedHostPath
    type            = 'stdio'
    allowed_origins = $allowedOrigins
}

[System.IO.Directory]::CreateDirectory($manifestDirectory) | Out-Null
$manifestJson = $manifest | ConvertTo-Json -Depth 3
[System.IO.File]::WriteAllText(
    $manifestPath,
    $manifestJson,
    [System.Text.UTF8Encoding]::new($false)
)

$registryPaths = switch ($Browser) {
    'Chrome' { "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName" }
    'Edge' { "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName" }
    'Both' {
        "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"
        "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName"
    }
}

foreach ($registryPath in $registryPaths) {
    New-Item -Path $registryPath -Force | Out-Null
    Set-Item -LiteralPath $registryPath -Value $manifestPath
}

Write-Output "Registered $hostName for $Browser at the current-user level."
