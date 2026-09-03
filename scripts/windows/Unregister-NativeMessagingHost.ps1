[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Chrome', 'Edge', 'Both')]
    [string]$Browser
)

$ErrorActionPreference = 'Stop'
$hostName = 'com.aiclipmemory.bridge'
$chromeRegistryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"
$edgeRegistryPath = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName"

$registryPaths = switch ($Browser) {
    'Chrome' { $chromeRegistryPath }
    'Edge' { $edgeRegistryPath }
    'Both' {
        $chromeRegistryPath
        $edgeRegistryPath
    }
}

foreach ($registryPath in $registryPaths) {
    if (Test-Path -LiteralPath $registryPath) {
        Remove-Item -LiteralPath $registryPath -Force
    }
}

if (
    -not (Test-Path -LiteralPath $chromeRegistryPath) -and
    -not (Test-Path -LiteralPath $edgeRegistryPath)
) {
    $manifestDirectory = Join-Path $env:LOCALAPPDATA 'AI Clip Memory\NativeMessaging'
    $manifestPath = Join-Path $manifestDirectory "$hostName.json"
    if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
        Remove-Item -LiteralPath $manifestPath -Force
    }
    if (
        (Test-Path -LiteralPath $manifestDirectory -PathType Container) -and
        -not (Get-ChildItem -LiteralPath $manifestDirectory -Force)
    ) {
        Remove-Item -LiteralPath $manifestDirectory -Force
    }
}

Write-Output "Unregistered $hostName for $Browser at the current-user level."
