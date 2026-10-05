// Anchor an agent or a swarm in the registry: one Memo-program transaction,
// signed and paid for by the registry authority, whose text is
//
//   finch-registry/1 register <kind>:<handle> sha256:<manifest sha256 hex> [<uri>]
//
// The registry IS those transactions. Anyone can read the authority's
// signature history, check that the authority signed each memo, and hash the
// manifest themselves — no contract, no database, nothing to trust but Solana.
//
// Without --send this only prints what would be sent: the memo, its size, the
// fee payer, and a fee quote and simulation when the fee payer is known.
// Nothing is signed or submitted: the RPC sees only an unsigned copy, which
// cannot land. With --send it signs with
// FINCH_REGISTRY_AUTHORITY_KEY from .env.local (never printed) and submits;
// sending costs a network fee (5000 lamports per signature at the base rate)
// paid by the authority wallet. It never runs on its own — no hook, no CI,
// no app code calls it.
//
// Usage:
//   node scripts/registry-anchor.mjs <finch|nest> <handle> <manifest.json> [uri] [--send]
//
// The kind is the registry's id for what is anchored: finch for an agent,
// nest for a swarm.
//
// The hash is SHA-256 over the file's exact bytes, so anchor the same bytes
// you publish: reformatting the JSON changes the hash.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  appendTransactionMessageInstruction,
  compileTransaction,
  createKeyPairSignerFromBytes,
  createNoopSigner,
  createSolanaRpc,
  createTransactionMessage,
  getBase58Encoder,
  getBase64Decoder,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  isAddress,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { getAddMemoInstruction, LEGACY_MEMO_PROGRAM_ADDRESS_V3 } from "@solana-program/memo";

const PREFIX = "finch-registry/1";
// The long-standing SPL Memo program (MemoSq4…), not the package's newer
// default: RPC memo indexing — the `memo` field of getSignaturesForAddress and
// jsonParsed "spl-memo" — is known to cover this one, and the registry index
// is read through exactly those.
const MEMO_PROGRAM = LEGACY_MEMO_PROGRAM_ADDRESS_V3;
const args = process.argv.slice(2);
const send = args.includes("--send");
const [kind, handle, manifestPath, uri] = args.filter((arg) => arg !== "--send");

function usage(problem) {
  if (problem) console.error(problem);
  console.error("usage: node scripts/registry-anchor.mjs <finch|nest> <handle> <manifest.json> [uri] [--send]");
  console.error("       kind: finch = an agent, nest = a swarm (the registry's ids)");
  process.exit(1);
}
if (kind !== "finch" && kind !== "nest") usage(`kind must be "finch" (an agent) or "nest" (a swarm), got ${JSON.stringify(kind)}`);
if (!handle || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(handle)) usage("handle must be 2-64 lowercase letters, digits and hyphens");
if (!manifestPath || !existsSync(manifestPath)) usage(`manifest file not found: ${manifestPath ?? "(none given)"}`);
// Fields are space-separated, so a URI with whitespace would break parsing.
// The 200-character cap matches registryMemo() in @finch/flightpath.
if (uri !== undefined && (!/^\S{1,200}$/.test(uri) || !/^(https?|ipfs|ar):\/\//.test(uri))) {
  usage("uri must be one https://, ipfs:// or ar:// URL, at most 200 characters, with no spaces");
}

const env = { ...process.env };
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match?.[1] && match[2] && env[match[1]] === undefined) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

const bytes = readFileSync(manifestPath);
try {
  JSON.parse(bytes.toString("utf8"));
} catch {
  usage(`${manifestPath} is not valid JSON`);
}
const hash = createHash("sha256").update(bytes).digest("hex");
const memo = [PREFIX, "register", `${kind}:${handle}`, `sha256:${hash}`, ...(uri ? [uri] : [])].join(" ");
const memoBytes = Buffer.byteLength(memo, "utf8");
// A transaction is at most 1232 bytes; a single-signer memo leaves room for
// roughly 560 bytes of text. Refuse early rather than fail at the network.
if (memoBytes > 500) usage(`memo is ${memoBytes} bytes; keep it under 500 (shorten the uri)`);

/** A base58 64-byte secret or a JSON array of 64 numbers. The value is never echoed. */
async function authoritySigner(raw) {
  const text = raw.trim();
  let secret;
  if (text.startsWith("[")) {
    const numbers = JSON.parse(text);
    if (!Array.isArray(numbers) || numbers.length !== 64) throw new Error("FINCH_REGISTRY_AUTHORITY_KEY is not a 64-number array");
    secret = Uint8Array.from(numbers);
  } else {
    secret = new Uint8Array(getBase58Encoder().encode(text));
    if (secret.length !== 64) throw new Error("FINCH_REGISTRY_AUTHORITY_KEY is not a 64-byte base58 secret");
  }
  try {
    return await createKeyPairSignerFromBytes(secret);
  } catch {
    throw new Error("FINCH_REGISTRY_AUTHORITY_KEY is not a valid keypair");
  } finally {
    secret.fill(0);
  }
}

const cluster = env.SOLANA_CLUSTER ?? "mainnet-beta";
const rpcUrl =
  (env.SOLANA_RPC_URLS ?? "").split(",").map((url) => url.trim()).find(Boolean) ??
  env.SOLANA_RPC_URL ??
  `https://api.${cluster}.solana.com`;
const rpc = createSolanaRpc(rpcUrl);
const configured = env.FINCH_REGISTRY_AUTHORITY || undefined;
if (configured && !isAddress(configured)) usage(`FINCH_REGISTRY_AUTHORITY=${configured} is not a Solana address`);

let signer = null;
if (env.FINCH_REGISTRY_AUTHORITY_KEY) {
  try {
    signer = await authoritySigner(env.FINCH_REGISTRY_AUTHORITY_KEY);
  } catch (error) {
    usage(error.message);
  }
}
const feePayer = signer?.address ?? configured ?? null;

// Everything below talks to the RPC. It returns an exit code instead of
// calling process.exit(), which can crash Node on Windows while the RPC
// client still holds open sockets.
process.exitCode = await anchor();

async function anchor() {
  console.log(`memo       ${memo}`);
  console.log(`size       ${memoBytes} bytes`);
  console.log(`manifest   ${manifestPath} (${bytes.length} bytes, sha256 ${hash})`);
  console.log(`program    SPL Memo ${MEMO_PROGRAM}`);
  console.log(`cluster    ${cluster} via ${new URL(rpcUrl).host}`);
  console.log(`fee payer  ${feePayer ?? "unknown — set FINCH_REGISTRY_AUTHORITY (address) and, to send, FINCH_REGISTRY_AUTHORITY_KEY in .env.local"}`);
  if (signer && configured && signer.address !== configured) {
    console.log(`\nREFUSING: the key derives to ${signer.address}, but FINCH_REGISTRY_AUTHORITY is ${configured}.`);
    console.log("A memo signed by any other address is not part of the registry, so sending it would only spend a fee.");
    return 1;
  }
  if (!configured) {
    console.log(`note       FINCH_REGISTRY_AUTHORITY is unset, so the app would not count this anchor yet${signer ? " — set it to the fee payer above" : ""}.`);
  }
  if (!feePayer) return send ? 1 : 0;

  // The authority is both fee payer and the memo's listed signer: the Memo
  // program itself then checks the signature, so the memo attests who wrote it.
  const payerSigner = signer ?? createNoopSigner(feePayer);
  const { value: latest } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payerSigner, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latest, m),
    (m) => appendTransactionMessageInstruction(getAddMemoInstruction({ memo, signers: [payerSigner] }, { programAddress: MEMO_PROGRAM }), m),
  );
  const compiled = compileTransaction(message);
  const { value: fee } = await rpc.getFeeForMessage(getBase64Decoder().decode(compiled.messageBytes), { commitment: "confirmed" }).send();
  const { value: balance } = await rpc.getBalance(feePayer, { commitment: "confirmed" }).send();
  const sol = (lamports) => `${(Number(lamports) / 1e9).toFixed(9).replace(/\.?0+$/, "")} SOL`;
  console.log(`fee        ${fee === null ? "not quoted (blockhash expired — rerun)" : `${fee} lamports (${sol(fee)})`}, paid by the fee payer`);
  console.log(`balance    ${sol(balance)} at the fee payer`);

  const simulation = await rpc
    .simulateTransaction(getBase64EncodedWireTransaction(compiled), { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" })
    .send();
  const simError = simulation.value.err;
  const json = (value) => JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  console.log(`simulated  ${simError ? `FAILS — ${json(simError)}` : `ok, ${simulation.value.unitsConsumed ?? "?"} compute units`}`);

  if (!send) {
    console.log("\nDry run — nothing was signed or submitted. Re-run with --send to sign with FINCH_REGISTRY_AUTHORITY_KEY and submit.");
    console.log("Sending costs the network fee above, paid from the authority wallet.");
    return 0;
  }
  if (!signer) {
    console.error("\n--send needs FINCH_REGISTRY_AUTHORITY_KEY in .env.local");
    return 1;
  }
  if (simError) {
    console.log("\nNot sending: the simulation fails, so the transaction would fail too.");
    return 1;
  }

  const signed = await signTransactionMessageWithSigners(message);
  const signature = getSignatureFromTransaction(signed);
  await rpc.sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: "base64", preflightCommitment: "confirmed" }).send();
  console.log(`\nsent       ${signature}`);

  // Sent is not landed. Poll until the network confirms it, reports it failed,
  // or the blockhash expires — and say which.
  const explorer = (env.SOLANA_EXPLORER_URL ?? "https://solscan.io").replace(/\/$/, "");
  const clusterQuery = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  for (;;) {
    const { value: [status] } = await rpc.getSignatureStatuses([signature]).send();
    if (status?.err) {
      console.log(`FAILED     landed in slot ${status.slot} with ${json(status.err)} — the fee was paid, nothing was anchored`);
      return 1;
    }
    if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) {
      console.log(`confirmed  slot ${status.slot} (${status.confirmationStatus})`);
      console.log(`explorer   ${explorer}/tx/${signature}${clusterQuery}`);
      return 0;
    }
    const height = await rpc.getBlockHeight({ commitment: "confirmed" }).send();
    if (height > latest.lastValidBlockHeight) {
      // One last look through history, in case it landed between the two reads.
      const { value: [late] } = await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }).send();
      if (late) continue;
      console.log("NOT LANDED the blockhash expired before the transaction confirmed; nothing was anchored and no fee was charged. Rerun.");
      return 1;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}
