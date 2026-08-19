[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $File,
    [Parameter(Mandatory = $true)] [string] $Version,
    [Parameter(Mandatory = $true)] [string] $Bucket,
    [Parameter(Mandatory = $true)] [string] $AccountId,
    [Parameter(Mandatory = $true)] [string] $BaseUrl,
    [string] $Prefix = 'open-md'
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command aws.exe -ErrorAction SilentlyContinue)) { throw 'AWS CLI is required for the R2 S3-compatible upload.' }
$filePath = (Resolve-Path -LiteralPath $File -ErrorAction Stop).Path
$name = Split-Path $filePath -Leaf
$key = "$Prefix/$Version/$name"
$endpoint = "https://$AccountId.r2.cloudflarestorage.com"
$url = "$($BaseUrl.TrimEnd('/'))/$key"

$existing = & aws s3api head-object --bucket $Bucket --key $key --endpoint-url $endpoint 2>$null
if ($LASTEXITCODE -eq 0) { throw "Refusing to overwrite immutable release object: s3://$Bucket/$key" }

$sha = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant()
$contentType = if ($name -match '\.msi$') { 'application/x-msi' } elseif ($name -match '\.zip$') { 'application/zip' } else { 'application/octet-stream' }

& aws s3api put-object `
    --bucket $Bucket `
    --key $key `
    --body $filePath `
    --endpoint-url $endpoint `
    --region auto `
    --if-none-match '*' `
    --content-type $contentType `
    --cache-control 'public,max-age=31536000,immutable' `
    --metadata "sha256=$sha,version=$Version"
if ($LASTEXITCODE -ne 0) { throw "R2 upload failed for $key" }

[ordered]@{
    version = $Version
    file = $name
    sha256 = $sha
    key = $key
    url = $url
} | ConvertTo-Json
