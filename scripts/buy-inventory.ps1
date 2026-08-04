# Buy stock-token inventory for PackSale.
#   powershell -File scripts\buy-inventory.ps1 -Rpc <rpc> -EthIn <wei> -PerStock <usdg base units>
# Swaps ETH -> USDG on Uniswap v4, then USDG -> each stock, then sends the stock to PackSale.
param(
  [string]$Rpc = 'https://rpc.mainnet.chain.robinhood.com',
  [string]$EthIn = '60000000000000000',   # 0.06 ETH
  [long]$PerStock = 15000000              # $15 per stock
)
$ErrorActionPreference = 'Continue'
$cast = "$env:USERPROFILE\.foundry\bin\cast.exe"
$key = ((Get-Content C:\Users\carne\RWAPACKS\contracts\.env) | Select-String '^PRIVATE_KEY').ToString().Substring(12)
$me = '0x3F46489093ea0697d36272cBDab8C65f5F14D243'
$router = '0x8876789976decbfcbbbe364623c63652db8c0904'
$quoter = '0x8dc178efb8111bb0973dd9d722ebeff267c98f94'
$permit2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
$usdg = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'
$sale = '0x9e44cAE4D95D267984167219C832eFcFcb8d5B8F'
$zero = '0x0000000000000000000000000000000000000000'
$qsig = 'quoteExactInputSingle(((address,address,uint24,int24,address),bool,uint128,bytes))(uint256,uint256)'

function N([string]$s) { return [bigint](($s -replace '\s*\[.*', '').Trim()) }
function Bal([string]$t, [string]$w) { return N (& $cast call $t 'balanceOf(address)(uint256)' $w --rpc-url $Rpc) }

# stock -> best (fee, tickSpacing) discovered on chain
$stocks = [ordered]@{
  NVDA  = @('0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC', 3000, 60)
  AAPL  = @('0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9', 3000, 60)
  TSLA  = @('0x322F0929c4625eD5bAd873c95208D54E1c003b2d', 3000, 60)
  MSFT  = @('0xe93237C50D904957Cf27E7B1133b510C669c2e74', 3000, 60)
  SPY   = @('0x117cc2133c37B721F49dE2A7a74833232B3B4C0C', 3000, 60)
  AMZN  = @('0x12f190a9F9d7D37a250758b26824B97CE941bF54', 3000, 60)
  GOOGL = @('0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3', 3000, 60)
  META  = @('0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35', 3000, 60)
}

# --- 1. ETH -> USDG so we have something to buy stocks with ---
if ([bigint]$EthIn -gt 0) {
  $q = & $cast call $quoter $qsig "(($zero,$usdg,500,10,$zero),true,$EthIn,0x)" --rpc-url $Rpc
  $exp = N (($q -split "`n")[0]); $min = [bigint][Math]::Floor([double]$exp * 0.97)
  $p0 = & $cast abi-encode 'x(((address,address,uint24,int24,address),bool,uint128,uint128,bytes))' "(($zero,$usdg,500,10,$zero),true,$EthIn,$min,0x)"
  $p1 = & $cast abi-encode 'x(address,uint256)' $zero $EthIn
  $p2 = & $cast abi-encode 'x(address,uint256)' $usdg $min
  $in0 = & $cast abi-encode 'x(bytes,bytes[])' '0x060c0f' "[$p0,$p1,$p2]"
  & $cast send $router 'execute(bytes,bytes[],uint256)' '0x10' "[$in0]" 9999999999 --value $EthIn --private-key $key --rpc-url $Rpc | Out-Null
  Write-Output ("ETH -> USDG: now holding {0:N2} USDG" -f ((Bal $usdg $me) / 1000000))
}

# --- 2. approve Permit2 once, then allow the router to pull USDG ---
& $cast send $usdg 'approve(address,uint256)' $permit2 '1461501637330902918203684832716283019655932542975' --private-key $key --rpc-url $Rpc | Out-Null
& $cast send $permit2 'approve(address,address,uint160,uint48)' $usdg $router '1461501637330902918203684832716283019655932542975' 281474976710655 --private-key $key --rpc-url $Rpc | Out-Null
Write-Output 'permit2 approvals set'

# --- 3. USDG -> each stock, then push inventory to PackSale ---
foreach ($t in $stocks.Keys) {
  $stock = $stocks[$t][0]; $fee = $stocks[$t][1]; $ts = $stocks[$t][2]
  if ((Bal $usdg $me) -lt $PerStock) { Write-Output "  $t skipped - out of USDG"; continue }

  if ([string]::Compare($usdg.ToLower(), $stock.ToLower(), $false) -lt 0) { $c0 = $usdg; $c1 = $stock; $zfo = 'true' }
  else { $c0 = $stock; $c1 = $usdg; $zfo = 'false' }

  $q = & $cast call $quoter $qsig "(($c0,$c1,$fee,$ts,$zero),$zfo,$PerStock,0x)" --rpc-url $Rpc 2>&1
  $exp = N (($q -split "`n")[0]); $min = [bigint][Math]::Floor([double]$exp * 0.95)

  $p0 = & $cast abi-encode 'x(((address,address,uint24,int24,address),bool,uint128,uint128,bytes))' "(($c0,$c1,$fee,$ts,$zero),$zfo,$PerStock,$min,0x)"
  $p1 = & $cast abi-encode 'x(address,uint256)' $usdg $PerStock
  $p2 = & $cast abi-encode 'x(address,uint256)' $stock $min
  $in0 = & $cast abi-encode 'x(bytes,bytes[])' '0x060c0f' "[$p0,$p1,$p2]"

  $before = Bal $stock $me
  & $cast send $router 'execute(bytes,bytes[],uint256)' '0x10' "[$in0]" 9999999999 --private-key $key --rpc-url $Rpc 2>&1 | Out-Null
  $got = (Bal $stock $me) - $before
  if ($got -le 0) { Write-Output "  $t SWAP FAILED"; continue }

  & $cast send $stock 'transfer(address,uint256)' $sale $got --private-key $key --rpc-url $Rpc | Out-Null
  Write-Output ("  {0}: bought {1} wei, sent to PackSale (contract now holds {2})" -f $t, $got, (Bal $stock $sale))
}

Write-Output ("`nleftover USDG in wallet: {0:N2}" -f ((Bal $usdg $me) / 1000000))
Write-Output ("PackSale USDG float:     {0:N2}" -f ((Bal $usdg $sale) / 1000000))
