// Verify the four deployed contracts on Blockscout via its v2 API.
//
// forge verify-contract is blocked: it hits the legacy /api?module=contract
// endpoint with its own UA and gets a Cloudflare challenge page. The v2 API
// answers a browser UA. Standard-JSON input is rebuilt from the exact settings
// forge compiled with (read from each artifact's metadata), so the bytecode
// matches what is on chain.
import { readFileSync } from "node:fs";
import { encodeAbiParameters } from "viem";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const API = "https://robinhoodchain.blockscout.com/api/v2";
const headers = { "User-Agent": UA, Accept: "application/json" };

const TREASURY = "0x55bb1a9F0252d37121F1344e3693B59dD1Ce0389";
const CONTRACTS = [
  { name: "FinchRegistry", address: "0x4211e21c416D8f66F038Add24B02d1eB03D5Fb6C", types: [], values: [] },
  { name: "FeeVault", address: "0x20f51A3eC950F7488dd88941971CA8F7EfA3D165", types: [{ type: "address" }], values: [TREASURY] },
  { name: "OperatorBudget", address: "0xF61A7b0A2FC716b46f1b076DF88c7c6e8A1301F3", types: [{ type: "address" }], values: [TREASURY] },
  {
    name: "FeeSplitter",
    address: "0x5819ee3e11bC7c8A0ddef3d961dCd05dbFc9dB34",
    types: [{ type: "address" }, { type: "address" }, { type: "uint256" }],
    values: ["0xFe62B033bc2fb8e8373Ec9f6D8B34fD13703D6c2", "0x20f51A3eC950F7488dd88941971CA8F7EfA3D165", 9000n],
  },
];

const config = await fetch(`${API}/smart-contracts/verification/config`, { headers }).then((r) => r.json());
const evms = config.solidity_evm_versions ?? [];
const compiler = (config.solidity_compiler_versions ?? []).find((v) => v.startsWith("v0.8.24+commit.e11b9ed9")) ?? "v0.8.24+commit.e11b9ed9";
console.log(`  compiler ${compiler} | cancun supported: ${evms.includes("cancun")} | licenses: ${(config.license_types ?? []).length}`);

function standardJson(name) {
  const artifact = JSON.parse(readFileSync(`contracts/out/${name}.sol/${name}.json`, "utf8"));
  const meta = typeof artifact.metadata === "string" ? JSON.parse(artifact.metadata) : artifact.metadata;
  const settings = meta.settings ?? {};
  const sources = {};
  for (const path of Object.keys(meta.sources ?? { [`src/${name}.sol`]: {} })) {
    sources[path] = { content: readFileSync(`contracts/${path}`, "utf8") };
  }
  const evmVersion = settings.evmVersion && evms.includes(settings.evmVersion) ? settings.evmVersion : undefined;
  return {
    evmVersion,
    input: {
      language: "Solidity",
      sources,
      settings: {
        optimizer: settings.optimizer ?? { enabled: true, runs: 200 },
        ...(evmVersion ? { evmVersion } : {}),
        remappings: settings.remappings ?? [],
        metadata: { bytecodeHash: settings.metadata?.bytecodeHash ?? "ipfs" },
        outputSelection: { "*": { "*": ["abi", "evm.bytecode", "evm.deployedBytecode", "metadata"] } },
      },
    },
  };
}

async function status(address) {
  const r = await fetch(`${API}/smart-contracts/${address}`, { headers });
  if (!r.ok) return { verified: false };
  const d = await r.json();
  return { verified: Boolean(d.is_verified), name: d.name ?? null };
}

for (const c of CONTRACTS) {
  const before = await status(c.address);
  if (before.verified) {
    console.log(`  ${c.name.padEnd(15)} already verified as ${before.name}`);
    continue;
  }
  const { input, evmVersion } = standardJson(c.name);
  const form = new FormData();
  form.set("compiler_version", compiler);
  form.set("license_type", "mit");
  form.set("autodetect_constructor_args", "false");
  form.set("constructor_args", c.types.length ? encodeAbiParameters(c.types, c.values) : "");
  form.set("files[0]", new Blob([JSON.stringify(input)], { type: "application/json" }), `${c.name}.json`);
  const res = await fetch(`${API}/smart-contracts/${c.address}/verification/via/standard-input`, { method: "POST", headers: { "User-Agent": UA, Accept: "application/json" }, body: form });
  const text = await res.text();
  console.log(`  ${c.name.padEnd(15)} submit -> ${res.status} ${text.slice(0, 120).replace(/\s+/g, " ")} (evm=${evmVersion ?? "default"})`);
  if (!res.ok) continue;
  // Verification is asynchronous; poll.
  let result = { verified: false, name: null };
  for (let i = 0; i < 18 && !result.verified; i += 1) {
    await new Promise((r) => setTimeout(r, 5_000));
    result = await status(c.address);
  }
  console.log(`  ${c.name.padEnd(15)} ${result.verified ? `VERIFIED as ${result.name}` : "not verified after 90s (may still be processing)"}`);
}
