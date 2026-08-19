[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string[]] $Path,
    [string] $ExpectedSubject
)

$ErrorActionPreference = 'Stop'

function Find-SignTool {
    $command = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $roots = @("$env:ProgramFiles\Windows Kits\10\bin", "$env:ProgramFiles(x86)\Windows Kits\10\bin")
    foreach ($root in $roots) {
        if (Test-Path $root) {
            $candidate = Get-ChildItem $root -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue |
                Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
                Sort-Object FullName -Descending | Select-Object -First 1
            if ($candidate) { return $candidate.FullName }
        }
    }
    throw 'signtool.exe was not found.'
}

$signtool = Find-SignTool
$evidence = @()
foreach ($item in $Path) {
    $file = (Resolve-Path -LiteralPath $item -ErrorAction Stop).Path
    $sig = Get-AuthenticodeSignature -LiteralPath $file
    if ($sig.Status -ne 'Valid') { throw "Authenticode status for $file is $($sig.Status)" }
    if ($ExpectedSubject -and $sig.SignerCertificate.Subject -notlike "*$ExpectedSubject*") {
        throw "Unexpected signer for $file: $($sig.SignerCertificate.Subject)"
    }

    & $signtool verify /pa /all /tw $file
    if ($LASTEXITCODE -ne 0) { throw "SignTool verification failed for $file" }

    $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    $evidence += [ordered]@{
        path = $file
        sha256 = $hash
        signer = $sig.SignerCertificate.Subject
        thumbprint = $sig.SignerCertificate.Thumbprint
        notAfter = $sig.SignerCertificate.NotAfter.ToUniversalTime().ToString('o')
    }
}

$evidence | ConvertTo-Json -Depth 5
