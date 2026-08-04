# finch deployer handoff — run this yourself in a terminal:
#   powershell -ExecutionPolicy Bypass -File scripts\setup-deployer.ps1
#
# Prompts for your funded wallet's private key (hidden input), writes it to
# contracts\.env (gitignored), then derives the address and checks ETH balances
# on Robinhood Chain mainnet + testnet. The key never leaves this machine.

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $root 'contracts\.env'
$cast = "$env:USERPROFILE\.foundry\bin\cast.exe"

# --- collect key (hidden) ---
$secure = Read-Host 'Paste deployer PRIVATE KEY (input hidden)' -AsSecureString
$key = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
$key = $key.Trim()
if (-not $key.StartsWith('0x')) { $key = "0x$key" }
if ($key -notmatch '^0x[0-9a-fA-F]{64}$') {
  Write-Host 'ERROR: that does not look like a private key (need 64 hex chars).' -ForegroundColor Red
  exit 1
}

# --- write .env ---
"PRIVATE_KEY=$key" | Out-File $envFile -Encoding ascii -NoNewline
Write-Host "Saved -> contracts\.env" -ForegroundColor Green

# --- safety: confirm git ignores it ---
Push-Location $root
$ignored = git check-ignore contracts/.env 2>$null
Pop-Location
if ($ignored) {
  Write-Host 'Git ignore check: contracts\.env will NEVER be committed. OK' -ForegroundColor Green
} else {
  Write-Host 'WARNING: contracts\.env is NOT gitignored! Do not commit. Tell Claude.' -ForegroundColor Red
}

# --- derive address + check balances ---
$addr = & $cast wallet address --private-key $key
Write-Host ''
Write-Host "Deployer address: $addr" -ForegroundColor Cyan

foreach ($net in @(
  @{ name = 'mainnet (4663) '; rpc = 'https://rpc.mainnet.chain.robinhood.com' },
  @{ name = 'testnet (46630)'; rpc = 'https://rpc.testnet.chain.robinhood.com' }
)) {
  try {
    $bal = & $cast balance $addr --rpc-url $net.rpc --ether 2>$null
    $flag = if ([double]$bal -gt 0) { 'FUNDED' } else { 'empty — needs ETH' }
    Write-Host ("  {0}  {1} ETH   [{2}]" -f $net.name, $bal, $flag)
  } catch {
    Write-Host ("  {0}  balance check failed" -f $net.name) -ForegroundColor Yellow
  }
}

Write-Host ''
Write-Host 'Done. Tell Claude "deployer is set" and deployment proceeds from here.' -ForegroundColor Green
