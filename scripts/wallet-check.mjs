// Confirm every Solana wallet Finch relies on: that its secret key in
// .env.local parses, which PUBLIC address it derives to, whether that matches
// the address on record, and its SOL balance right now. Prints addresses,
// balances and a verdict only. Never prints, logs, or copies key material —
// a malformed key is reported by name and shape, never by content.
//
// Usage: node scripts/wallet-check.mjs
import { existsSync, readFileSync } from "node:fs";
import { createKeyPairSignerFromBytes, createSolanaRpc, getBase58Encoder, isAddress } from "@solana/kit";

if (!existsSync(".env.local")) {
  console.log("no .env.local here — nothing to check. Run from the repo root.");
  process.exit(0);
}
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);

const WALLETS = [
  { label: "operator (bounded agent float)", key: "FLIGHTPATH_OPERATOR_KEY", addr: null },
  { label: "fee wallet", key: "FINCH_FEE_WALLET_PRIVATE_KEY", addr: "FINCH_FEE_WALLET_ADDRESS" },
  { label: "registry authority (signs registry memos)", key: "FINCH_REGISTRY_AUTHORITY_KEY", addr: "FINCH_REGISTRY_AUTHORITY" },
];

/** Accepts a base58 64-byte secret or a JSON array of 64 numbers; returns bytes or a reason. */
function secretBytes(raw) {
  const text = raw.trim();
  if (text.startsWith("[")) {
    try {
      const numbers = JSON.parse(text);
      if (Array.isArray(numbers) && numbers.length === 64 && numbers.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
        return { bytes: Uint8Array.from(numbers) };
      }
    } catch {}
    return { reason: "a JSON array, but not 64 numbers from 0 to 255" };
  }
  if (/^0x[0-9a-fA-F]+$/.test(text)) return { reason: "hex — not a Solana key format" };
  try {
    const bytes = new Uint8Array(getBase58Encoder().encode(text));
    return bytes.length === 64 ? { bytes } : { reason: `base58, but ${bytes.length} bytes instead of 64` };
  } catch {
    return { reason: "neither base58 nor a JSON array" };
  }
}

const cluster = env.SOLANA_CLUSTER ?? process.env.SOLANA_CLUSTER ?? "mainnet-beta";
const rpcUrl =
  (env.SOLANA_RPC_URLS ?? "").split(",").map((url) => url.trim()).find(Boolean) ??
  env.SOLANA_RPC_URL ??
  `https://api.${cluster}.solana.com`;
const rpc = createSolanaRpc(rpcUrl);

async function balance(address) {
  if (!isAddress(address)) return "not a Solana address";
  try {
    const { value } = await rpc.getBalance(address).send();
    const whole = value / 1_000_000_000n;
    const frac = (value % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
    return `${whole}${frac ? `.${frac}` : ""} SOL`;
  } catch (error) {
    return `unreadable (${error?.message?.slice(0, 60) ?? "RPC error"})`;
  }
}

console.log(`cluster ${cluster} via ${new URL(rpcUrl).host}\n`);
let ok = true;
for (const wallet of WALLETS) {
  const raw = env[wallet.key];
  const stated = wallet.addr ? env[wallet.addr] : undefined;
  console.log(`  ${wallet.label}`);
  if (stated && !isAddress(stated)) {
    console.log(`    ${wallet.addr}=${stated} is not a Solana address — replace it`);
    ok = false;
  }
  if (!raw) {
    const onRecord = stated && isAddress(stated) ? `  (${wallet.addr}=${stated}, ${await balance(stated)})` : "";
    console.log(`    ${wallet.key}: not set${onRecord}`);
    continue;
  }
  const parsed = secretBytes(raw);
  if (!parsed.bytes) {
    console.log(`    ${wallet.key}: present but malformed — ${parsed.reason}`);
    ok = false;
    continue;
  }
  let derived;
  try {
    // Rejects a 64-byte value whose second half is not the first half's public key.
    derived = (await createKeyPairSignerFromBytes(parsed.bytes)).address;
  } catch {
    console.log(`    ${wallet.key}: present but not a valid keypair (public half does not match the secret half)`);
    ok = false;
    continue;
  }
  parsed.bytes.fill(0);
  const match = stated === undefined ? null : stated === derived;
  console.log(`    ${wallet.key}: present, derives to ${derived}  balance ${await balance(derived)}`);
  if (wallet.addr) {
    console.log(`    ${wallet.addr}=${stated ?? "(unset)"}  match: ${match === null ? "no address on record" : match ? "yes" : "NO"}`);
  }
  if (match === false) ok = false;
}

// Names only, never values: anything .env.example does not list (set or
// commented out) is a variable no code reads — usually a leftover. Vercel's
// own CLI token is expected and skipped.
if (existsSync(".env.example")) {
  const known = new Set(
    [...readFileSync(".env.example", "utf8").matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]),
  );
  const unknown = Object.keys(env).filter((name) => !known.has(name) && !name.startsWith("VERCEL_"));
  if (unknown.length) console.log(`\n  in .env.local but not in .env.example (nothing reads them — check, then delete): ${unknown.join(", ")}`);
}

console.log(`\n  verdict: ${ok ? "every key that is set parses, and each matches the address on record where there is one" : "ATTENTION — see above"}`);
