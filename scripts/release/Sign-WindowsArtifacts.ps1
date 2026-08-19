[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string[]] $Path,
    [Parameter(Mandatory = $true)] [string] $PfxPath,
    [Parameter(Mandatory = $true)] [string] $PfxPassword,
    [Parameter(Mandatory = $true)] [string] $TimestampUrl,
    [string] $Description = 'open.md',
    [string] $DescriptionUrl = 'https://github.com/gvastethecreator/open.md'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $PfxPath -PathType Leaf)) {
    throw "Signing certificate not found: $PfxPath"
}
if ([string]::IsNullOrWhiteSpace($PfxPassword)) { throw 'PfxPassword must not be empty.' }
if ([string]::IsNullOrWhiteSpace($TimestampUrl)) { throw 'TimestampUrl must be an RFC 3161 endpoint.' }

function Find-SignTool {
    $command = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $roots = @(
        "$env:ProgramFiles\Windows Kits\10\bin",
        "$env:ProgramFiles(x86)\Windows Kits\10\bin"
    )
    foreach ($root in $roots) {
        if (Test-Path $root) {
            $candidate = Get-ChildItem $root -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue |
                Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
                Sort-Object FullName -Descending | Select-Object -First 1
            if ($candidate) { return $candidate.FullName }
        }
    }
    throw 'signtool.exe was not found. Install the Windows SDK.'
}

$signtool = Find-SignTool
$resolved = @()
foreach ($item in $Path) {
    $candidate = (Resolve-Path -LiteralPath $item -ErrorAction Stop).Path
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { throw "Not a file: $candidate" }
    $resolved += $candidate
}

foreach ($file in $resolved) {
    Write-Host "Signing $file"
    & $signtool sign /fd SHA256 /f $PfxPath /p $PfxPassword /tr $TimestampUrl /td SHA256 /d $Description /du $DescriptionUrl /a $file
    if ($LASTEXITCODE -ne 0) { throw "SignTool failed for $file with exit code $LASTEXITCODE" }

    & $signtool verify /pa /all /tw $file
    if ($LASTEXITCODE -ne 0) { throw "Signature verification failed for $file with exit code $LASTEXITCODE" }
}

Write-Host "Signed and verified $($resolved.Count) artifact(s)."