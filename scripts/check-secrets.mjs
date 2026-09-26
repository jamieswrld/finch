#!/usr/bin/env node
/**
 * Refuse to commit a secret.
 *
 * This exists because .env.example is a tracked, public file that looks like a
 * natural place to put keys, and a key committed to a public repo is burned
 * the moment it lands — history rewrites do not recall it from clones, forks
 * or scrapers. Cheaper to make the mistake impossible than to rotate later.
 *
 * Scans STAGED content only, so it judges what is actually about to ship.
 * `node scripts/check-secrets.mjs <file>…` scans those working-tree files
 * instead, for checking something before it is staged.
 *
 * Solana keys are the hard case. A secret key is 64 bytes, usually written as
 * 86-88 base58 characters or as a JSON array of 64 numbers. A transaction
 * signature is ALSO 64 bytes of base58, the same length and alphabet, and
 * signatures belong in docs, tests and logs. Length alone cannot tell them
 * apart, so a key-length base58 string is flagged only where a key would sit:
 * as the value of an env-style assignment, or right after a key-ish name
 * (secret, private, keypair, …key) and a `:` or `=`. A key pasted bare into
 * prose, or under an innocent name, gets past this — the scan narrows the
 * common mistake, it does not prove a file clean. Public addresses (32-44
 * characters) are never key-length and never flagged.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const B58 = "[1-9A-HJ-NP-Za-km-z]";
/** A 64-byte value in base58: 87-88 characters almost always, 86 rarely. */
const B58_64 = `${B58}{86,88}(?!${B58})`;
const BYTE = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";

/** Checked one line at a time, so the public-value marker can excuse a line. */
const LINE_PATTERNS = [
  [/\bgsk_[A-Za-z0-9]{20,}/, "Groq API key"],
  [/\bsk-or-v1-[A-Za-z0-9]{20,}/, "OpenRouter API key"],
  [/\bsk-[A-Za-z0-9]{32,}/, "OpenAI-style API key"],
  [/\bcsk-[A-Za-z0-9]{20,}/, "Cerebras API key"],
  [/\bAIza[0-9A-Za-z_-]{30,}/, "Google API key"],
  [/\bghp_[A-Za-z0-9]{30,}/, "GitHub token"],
  [/\bxoxb-[A-Za-z0-9-]{20,}/, "Slack token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key id"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "PEM private key"],
  [/mongodb(\+srv)?:\/\/[^\s:@"']+:[^\s@"']+@/, "MongoDB URI with credentials"],
  [
    new RegExp(`^\\s*(?:export\\s+)?[A-Za-z_][A-Za-z0-9_]*\\s*=\\s*["']?(?<![1-9A-HJ-NP-Za-km-z])${B58_64}["']?\\s*$`),
    "Solana secret key (64-byte base58 in an env assignment)",
    { redact: true },
  ],
  [
    new RegExp(`(?:secret|private|keypair|key)[A-Za-z0-9_-]*["']?\\s*[:=]\\s*["'\`]?(?<![1-9A-HJ-NP-Za-km-z])${B58_64}`, "i"),
    "Solana secret key (64-byte base58 under a key-ish name)",
    { redact: true },
  ],
];

/**
 * Checked across the whole file, because `solana-keygen` writes a keypair as
 * one JSON array but an editor may have wrapped it over many lines.
 */
const CONTENT_PATTERNS = [
  [new RegExp(`\\[\\s*(?:${BYTE}\\s*,\\s*){63}${BYTE}\\s*\\]`), "Solana secret key (JSON array of 64 bytes)"],
];

// Public 64-byte values exist — a test vector, a fixture signature written
// as bytes — and can look exactly like a key. A line that holds one says so
// with this marker; everything else that matches is treated as a key. The
// marker is a claim reviewed like any other line of code.
const PUBLIC_MARKER = /public value, not a key/;

/** Files where a value is expected to be a placeholder, never a real secret. */
const TEMPLATE_FILES = /(^|\/)\.env\.example$/;

const SKIP = (file) =>
  /\.(png|jpe?g|gif|ico|woff2?|ttf|pdf|zip)$/i.test(file) || file === "package-lock.json" || file.endsWith(".tsbuildinfo");

const explicit = process.argv.slice(2);
const files = (
  explicit.length > 0
    ? explicit
    : execSync("git diff --cached --name-only --diff-filter=ACM", { encoding: "utf8" }).split("\n")
)
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((file) => !SKIP(file));

function read(file) {
  if (explicit.length > 0) return readFileSync(file, "utf8");
  return execSync(`git show :${JSON.stringify(file)}`, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

const problems = [];

for (const file of files) {
  let content = "";
  try {
    content = read(file);
  } catch {
    continue;
  }
  const lines = content.split(/\r?\n/);

  const flaggedLines = new Set();
  for (const [pattern, label, options] of LINE_PATTERNS) {
    for (const [index, line] of lines.entries()) {
      if (PUBLIC_MARKER.test(line)) continue;
      const match = line.match(pattern);
      if (!match) continue;
      // One report per line. A Solana key is never echoed, not even a
      // prefix: this output gets pasted into chats and CI logs.
      if (!flaggedLines.has(index)) {
        flaggedLines.add(index);
        problems.push({
          file,
          label: `${label}, line ${index + 1}`,
          sample: options?.redact ? "" : `${match[0].trim().slice(0, 8)}…`,
        });
      }
      break;
    }
  }

  for (const [pattern, label] of CONTENT_PATTERNS) {
    for (const match of content.matchAll(new RegExp(pattern.source, "g"))) {
      // Excused only if the line where the value starts carries the marker.
      const lineNumber = content.slice(0, match.index).split(/\r?\n/).length;
      if (PUBLIC_MARKER.test(lines[lineNumber - 1] ?? "")) continue;
      problems.push({ file, label: `${label}, line ${lineNumber}`, sample: "" });
      break;
    }
  }

  // A template file must not carry assigned values for anything key-shaped.
  // Names ending in _MINT or _ADDRESS hold public values by construction.
  if (TEMPLATE_FILES.test(file)) {
    for (const line of lines) {
      const assignment = /^([A-Z0-9_]*(?:KEY|SECRET|TOKEN|URI|PASSWORD)[A-Z0-9_]*)=(.+)$/.exec(line.trim());
      if (assignment && !/_(MINT|ADDRESS)$/.test(assignment[1]) && assignment[2].trim().length > 0) {
        problems.push({ file, label: `${assignment[1]} has a value in a template file`, sample: "" });
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`\n  COMMIT BLOCKED — secret-shaped content is ${explicit.length > 0 ? "in these files" : "staged"}:\n`);
  for (const p of problems) {
    console.error(`    ${p.file}: ${p.label} ${p.sample}`);
  }
  console.error(`
  Secrets belong in .env.local (gitignored) for local runs, and in
  \`vercel env add <NAME> production\` for the deployment. Never in a
  tracked file — this repo is public, so a committed key is burned
  immediately and must be rotated, not just removed.
`);
  process.exit(1);
}

console.log(
  `secret scan: clean (${files.length} ${explicit.length > 0 ? "" : "staged "}file${files.length === 1 ? "" : "s"})`,
);
