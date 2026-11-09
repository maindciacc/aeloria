param(
  [string]$ConfigPath = (Join-Path $PSScriptRoot "config.yml")
)

$ErrorActionPreference = "Stop"
$cloudflared = (Get-Command cloudflared -ErrorAction Stop).Source
if (-not (Test-Path $ConfigPath)) {
  throw "Missing Cloudflare named-tunnel config: $ConfigPath"
}

& $cloudflared tunnel --config $ConfigPath run
