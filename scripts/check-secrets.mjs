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
 */
import { execSync } from "node:child_process";

const PATTERNS = [
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
  [/\b0x[a-fA-F0-9]{64}\b/, "possible raw private key (32-byte hex)"],
];

/** Files where a value is expected to be a placeholder, never a real secret. */
const TEMPLATE_FILES = /(^|\/)\.env\.example$/;

const staged = execSync("git diff --cached --name-only --diff-filter=ACM", { encoding: "utf8" })
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((file) => !/\.(png|jpe?g|gif|ico|woff2?|ttf|pdf|zip)$/i.test(file))
  .filter((file) => file !== "package-lock.json" && !file.endsWith(".tsbuildinfo"));

const problems = [];

for (const file of staged) {
  let content = "";
  try {
    content = execSync(`git show :${JSON.stringify(file)}`, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  } catch {
    continue;
  }

  for (const [pattern, label] of PATTERNS) {
    const match = content.match(pattern);
    if (match) problems.push({ file, label, sample: `${match[0].slice(0, 8)}…` });
  }

  // A template file must not carry assigned values for anything key-shaped.
  if (TEMPLATE_FILES.test(file)) {
    for (const line of content.split("\n")) {
      const assignment = /^([A-Z0-9_]*(?:KEY|SECRET|TOKEN|URI|PASSWORD)[A-Z0-9_]*)=(.+)$/.exec(line.trim());
      if (assignment && assignment[2].trim().length > 0) {
        problems.push({ file, label: `${assignment[1]} has a value in a template file`, sample: "" });
      }
    }
  }
}

if (problems.length > 0) {
  console.error("\n  COMMIT BLOCKED — secret-shaped content is staged:\n");
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

console.log(`secret scan: clean (${staged.length} staged file${staged.length === 1 ? "" : "s"})`);
