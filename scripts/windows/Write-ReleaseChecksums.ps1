[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ReleaseDirectory
)

$ErrorActionPreference = 'Stop'
$resolvedReleaseDirectory = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
$checksumPath = Join-Path $resolvedReleaseDirectory 'SHA256SUMS.txt'
$artifacts = @(
    Get-ChildItem -LiteralPath $resolvedReleaseDirectory -File |
        Where-Object { $_.Name -cne 'SHA256SUMS.txt' } |
        Sort-Object -Property Name
)

if ($artifacts.Count -eq 0) {
    throw 'The release directory does not contain any artifacts to hash.'
}

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

$lines = foreach ($artifact in $artifacts) {
    $hash = Get-Sha256 -Path $artifact.FullName
    "$hash  $($artifact.Name)"
}

$contents = ($lines -join "`n") + "`n"
[System.IO.File]::WriteAllText(
    $checksumPath,
    $contents,
    [System.Text.UTF8Encoding]::new($false)
)

Write-Output $checksumPath
