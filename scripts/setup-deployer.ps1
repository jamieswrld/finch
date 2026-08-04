# finch deployer handoff -- run this yourself in a terminal:
#   powershell -ExecutionPolicy Bypass -File scripts\setup-deployer.ps1
#
# Copy your private key in the Robinhood wallet, then press Enter here; the key is
# read from the clipboard (never displayed) and the clipboard is wiped right after.
# Also accepts a 12/24-word recovery phrase on the clipboard.
# Writes contracts\.env (gitignored), derives the address, checks ETH balances.

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $root 'contracts\.env'
$cast = "$env:USERPROFILE\.foundry\bin\cast.exe"

Write-Host 'In your Robinhood wallet: export the private key and COPY it to the clipboard.' -ForegroundColor Cyan
Read-Host 'Then press Enter (the key is read from the clipboard; it is never displayed)' | Out-Null
$secret = [string](Get-Clipboard -Raw)
Set-Clipboard -Value ' '  # wipe the key from the clipboard immediately
if (-not $secret -or -not $secret.Trim()) {
  Write-Host 'ERROR: clipboard was empty. Copy the key first, then run this again.' -ForegroundColor Red
  exit 1
}
$secret = ($secret.Trim() -replace '["'']', '' -replace '\s+', ' ')

$key = $null
$words = $secret.Split(' ')

if ($words.Count -ge 12) {
  # recovery phrase -> derive private key at the default path
  if ($words.Count -notin 12, 15, 18, 21, 24) {
    Write-Host "ERROR: got $($words.Count) words - a recovery phrase has 12, 15, 18, 21, or 24." -ForegroundColor Red
    exit 1
  }
  try {
    $key = (& $cast wallet private-key $secret 2>&1 | Select-Object -Last 1).ToString().Trim()
  } catch {}
  if ($key -notmatch '^0x[0-9a-fA-F]{64}$') {
    Write-Host 'ERROR: could not derive a key from that phrase - check for typos.' -ForegroundColor Red
    exit 1
  }
  Write-Host "Recovery phrase accepted ($($words.Count) words), key derived." -ForegroundColor Green
} else {
  $candidate = $secret -replace '\s', ''
  if (-not $candidate.StartsWith('0x')) { $candidate = "0x$candidate" }
  if ($candidate -notmatch '^0x[0-9a-fA-F]{64}$') {
    $len = $candidate.Length - 2
    Write-Host "ERROR: not a valid key. After cleanup I see $len chars; a private key has exactly 64 hex chars." -ForegroundColor Red
    exit 1
  }
  $key = $candidate
}

"PRIVATE_KEY=$key" | Out-File $envFile -Encoding ascii -NoNewline
Write-Host 'Saved -> contracts\.env' -ForegroundColor Green

Push-Location $root
$ignored = git check-ignore contracts/.env 2>$null
Pop-Location
if ($ignored) {
  Write-Host 'Git ignore check: contracts\.env will NEVER be committed. OK' -ForegroundColor Green
} else {
  Write-Host 'WARNING: contracts\.env is NOT gitignored! Do not commit. Tell Claude.' -ForegroundColor Red
}

$addr = & $cast wallet address --private-key $key
Write-Host ''
Write-Host "Deployer address: $addr" -ForegroundColor Cyan

foreach ($net in @(
  @{ name = 'mainnet (4663) '; rpc = 'https://rpc.mainnet.chain.robinhood.com' },
  @{ name = 'testnet (46630)'; rpc = 'https://rpc.testnet.chain.robinhood.com' }
)) {
  try {
    $bal = & $cast balance $addr --rpc-url $net.rpc --ether 2>$null
    $flag = if ([double]$bal -gt 0) { 'FUNDED' } else { 'empty - needs ETH' }
    Write-Host ("  {0}  {1} ETH   [{2}]" -f $net.name, $bal, $flag)
  } catch {
    Write-Host ("  {0}  balance check failed" -f $net.name) -ForegroundColor Yellow
  }
}

Write-Host ''
Write-Host 'Done. Tell Claude "deployer is set" and deployment proceeds from here.' -ForegroundColor Green
