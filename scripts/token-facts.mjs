// Read everything verifiable about an SPL mint on Solana: the mint account
// itself (supply, decimals, authorities, token program), Jupiter's record
// (price, holder count, verification), the DEX markets DexScreener sees, and
// for a pump.fun launch its bonding curve (on the curve, or graduated).
// Facts only — this prints what each source returns, and says when a source
// returns nothing or cannot be reached. Never a guess, never a zero for a
// failed read.
//
// Usage: node scripts/token-facts.mjs [mint]
// With no mint argument it reads FINCH_TOKEN_MINT (env, then .env.local) when
// that is set, and says plainly when no mint account exists there yet. There
// is no default mint: with neither, it asks for one.
import { existsSync, readFileSync } from "node:fs";
import { address, createSolanaRpc, getAddressEncoder, getProgramDerivedAddress, isAddress } from "@solana/kit";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match?.[1] && match[2] && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

// No default, matching FINCH_TOKEN_MINT_DEFAULT in packages/flightpath/src/tokens.ts.
const fromArg = process.argv[2];
const mint = fromArg ?? process.env.FINCH_TOKEN_MINT;
if (!mint) {
  console.error("usage: node scripts/token-facts.mjs <mint>   (or set FINCH_TOKEN_MINT)");
  process.exit(1);
}
const source = fromArg ? "" : " (from FINCH_TOKEN_MINT)";
if (!isAddress(mint)) {
  console.error(`not a Solana address: ${mint}`);
  process.exit(1);
}

const cluster = process.env.SOLANA_CLUSTER ?? "mainnet-beta";
const rpcUrl =
  (process.env.SOLANA_RPC_URLS ?? "").split(",").map((url) => url.trim()).find(Boolean) ??
  process.env.SOLANA_RPC_URL ??
  `https://api.${cluster === "mainnet-beta" ? "mainnet-beta" : cluster}.solana.com`;
const JUPITER = (process.env.JUPITER_API_URL ?? "https://lite-api.jup.ag").replace(/\/$/, "");
const jupiterHeaders = { Accept: "application/json", ...(process.env.JUPITER_API_KEY ? { "x-api-key": process.env.JUPITER_API_KEY } : {}) };
const rpc = createSolanaRpc(rpcUrl);
const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const TOKEN_PROGRAMS = {
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "SPL Token",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "Token-2022",
};

// The endpoint host only — a provider URL often carries its API key in the path.
console.log(`mint      ${mint}${source}`);
console.log(`cluster   ${cluster} via ${new URL(rpcUrl).host}`);

// Exiting with process.exit() while the RPC client still holds sockets can
// crash Node on Windows, so a finished read sets `done` and falls through.
let done = false;
try {
  const { value: account } = await rpc.getAccountInfo(address(mint), { encoding: "jsonParsed" }).send();
  const program = account ? TOKEN_PROGRAMS[account.owner] : undefined;
  const parsed = account?.data?.parsed;
  if (!account) {
    console.log(`account   NONE — no mint account at ${mint} on this cluster${fromArg ? "" : ", so the configured token has not launched"}`);
    done = true;
  } else if (!program || parsed?.type !== "mint") {
    console.log(`account   exists but is not a mint (owner ${account.owner}, type ${parsed?.type ?? "unparsed"})`);
    done = true;
  } else {
    const info = parsed.info;
    const supply = BigInt(info.supply);
    const whole = supply / 10n ** BigInt(info.decimals);
    console.log(`program   ${program} (${account.owner})`);
    console.log(`mint      decimals=${info.decimals} supply=${whole.toLocaleString("en-US")} (raw ${supply}) initialized=${info.isInitialized}`);
    console.log(`authority mint=${info.mintAuthority ?? "none (fixed supply)"} freeze=${info.freezeAuthority ?? "none"}`);
    const metadata = (info.extensions ?? []).find((extension) => extension.extension === "tokenMetadata")?.state;
    if (metadata) console.log(`metadata  name=${metadata.name} symbol=${metadata.symbol} (Token-2022 metadata extension)`);
    await readPumpCurve(info.decimals);
  }
} catch (error) {
  console.log(`account   UNREACHABLE — ${error?.message?.slice(0, 120) ?? error}`);
}

/**
 * pump.fun keeps each launch's bonding curve in a PDA of its program, seeded
 * with "bonding-curve" and the mint. Layout after the 8-byte discriminator:
 * five u64s (virtual token, virtual SOL, real token, real SOL reserves, total
 * supply), then the `complete` flag — set, with the reserves emptied, once the
 * curve graduates to an AMM. Raw reserves only; no derived percentage.
 */
async function readPumpCurve(decimals) {
  const [curve] = await getProgramDerivedAddress({
    programAddress: PUMP_PROGRAM,
    seeds: ["bonding-curve", getAddressEncoder().encode(address(mint))],
  });
  try {
    const { value } = await rpc.getAccountInfo(curve, { encoding: "base64" }).send();
    if (!value || value.owner !== PUMP_PROGRAM) {
      console.log("pump.fun  no bonding-curve account for this mint (not a pump.fun launch)");
      return;
    }
    const data = Buffer.from(value.data[0], "base64");
    if (data.length < 49) {
      console.log(`pump.fun  bonding-curve account ${curve} has an unexpected layout (${data.length} bytes)`);
      return;
    }
    const realToken = data.readBigUInt64LE(24);
    const realSol = data.readBigUInt64LE(32);
    if (data[48] === 1) {
      console.log(`pump.fun  graduated — curve ${curve} is complete, so trading has moved to an AMM (see markets)`);
    } else {
      const tokens = (realToken / 10n ** BigInt(decimals)).toLocaleString("en-US");
      console.log(`pump.fun  on the bonding curve ${curve}: ${Number(realSol) / 1e9} SOL in real reserves, ${tokens} tokens left to sell`);
    }
  } catch (error) {
    console.log(`pump.fun  UNREACHABLE — ${error?.message?.slice(0, 120) ?? error}`);
  }
}

if (!done && cluster !== "mainnet-beta") {
  console.log("jupiter   skipped — Jupiter and DexScreener index mainnet only");
  done = true;
}

async function getJson(url, headers = { Accept: "application/json" }) {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(12_000) });
    if (!response.ok) return { error: `HTTP ${response.status}` };
    return { data: await response.json() };
  } catch (error) {
    return { error: error?.message ?? String(error) };
  }
}

if (!done) await readMarkets();

async function readMarkets() {
  const search = await getJson(`${JUPITER}/tokens/v2/search?query=${mint}`, jupiterHeaders);
  const record = Array.isArray(search.data) ? search.data.find((token) => token.id === mint) : null;
  if (search.error) console.log(`jupiter   UNREACHABLE — ${search.error}`);
  else if (!record) console.log("jupiter   no token record for this mint");
  else {
    console.log(`jupiter   name=${record.name} symbol=${record.symbol} verified=${record.isVerified ?? "not reported"} holders=${record.holderCount ?? "not reported"}`);
    console.log(`jupiter   mcap=${record.mcap ?? "-"} fdv=${record.fdv ?? "-"} liquidity=${record.liquidity ?? "-"} (USD)`);
  }

  const price = await getJson(`${JUPITER}/price/v3?ids=${mint}`, jupiterHeaders);
  const quote = price.data?.[mint];
  if (price.error) console.log(`price     UNREACHABLE — ${price.error}`);
  else if (!quote) console.log("price     Jupiter does not price this mint");
  else console.log(`price     $${quote.usdPrice} (24h ${quote.priceChange24h?.toFixed?.(2) ?? "?"}%, block ${quote.blockId ?? "?"})`);

  const pairs = await getJson(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`);
  if (pairs.error) console.log(`markets   UNREACHABLE — ${pairs.error}`);
  else if (!Array.isArray(pairs.data) || pairs.data.length === 0) console.log("markets   DexScreener lists no pairs for this mint");
  else {
    const sorted = [...pairs.data].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    console.log(`markets   ${pairs.data.length} pair${pairs.data.length === 1 ? "" : "s"} on DexScreener; deepest:`);
    for (const pair of sorted.slice(0, 5)) {
      console.log(`  ${pair.dexId.padEnd(10)} ${pair.baseToken?.symbol}/${pair.quoteToken?.symbol} ${pair.pairAddress} liquidity=$${pair.liquidity?.usd ?? "?"} vol24h=$${pair.volume?.h24 ?? "?"}`);
    }
  }
}
