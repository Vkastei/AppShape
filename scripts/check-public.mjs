#!/usr/bin/env node
/**
 * Before anything of this repository goes public: no `.npmrc`, no registry other than the public
 * one in a lockfile, no secrets, no personal email. Checks every file git would publish (tracked
 * and new files, without ignored ones); exits with 1 and the findings when something is found.
 *
 *   pnpm check:public            # this repository
 *   pnpm check:public <folder>   # a folder (the export for the public repository)
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.argv[2] ?? process.cwd();

/** Registries a lockfile may name. */
const PUBLIC_HOSTS = /^(registry\.npmjs\.org|registry\.yarnpkg\.com|www\.npmjs\.com|github\.com|codeload\.github\.com|objects\.githubusercontent\.com)$/;
/** What must never be published (a name and a pattern each). */
const SECRETS = [
  ["Anthropic API key", /sk-ant-[A-Za-z0-9_-]{20,}/],
  ["OpenAI API key", /sk-(proj-)?[A-Za-z0-9]{32,}/],
  ["GitHub token", /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|github_pat_[A-Za-z0-9_]{60,}/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["Slack token", /\bxox[abpors]-[A-Za-z0-9-]{10,}/],
  ["Stripe or Paddle live key", /\b(sk_live|rk_live|pdl_live)_[A-Za-z0-9]{16,}/],
  ["private key", /-----BEGIN ((RSA|EC|OPENSSH|DSA|PGP) )?PRIVATE KEY( BLOCK)?-----/],
  ["npm token", /\bnpm_[A-Za-z0-9]{36}\b|_authToken=[^\s$]/],
];
/**
 * Private words (your email, a company registry's host) come from `.check-public.local` (git-ignored,
 * one word per line), so this script doesn't publish them itself.
 */
// next to the folder checked, or in this repository (an export folder has none of its own)
const wordFiles = [join(root, ".check-public.local"), fileURLToPath(new URL("../.check-public.local", import.meta.url))];
const words = new Set(wordFiles.flatMap((file) => (existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/) : [])).map((l) => l.trim()).filter((w) => w && !w.startsWith("#")));
for (const word of words) SECRETS.push([`private word "${word.slice(0, 3)}…"`, new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")]);
const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|icns|woff2?|ttf|otf|eot|zip|gz|exe|dll|node|pdf|mp4|webm)$/i;

/** The files that would be published. */
function files() {
  try {
    const out = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
    return out.split("\0").filter(Boolean);
  } catch {
    // not a git repository (an export folder): everything but node_modules and .git
    const list = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === ".git") continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else list.push(relative(root, path).replace(/\\/g, "/"));
      }
    };
    walk(root);
    return list;
  }
}

const findings = [];
for (const file of files()) {
  // this script (its patterns would find themselves)
  if (file === "scripts/check-public.mjs" || basename(file) === ".check-public.local") continue;
  if (basename(file) === ".npmrc") {
    findings.push(`${file}: an .npmrc (registry settings and tokens stay private)`);
    continue;
  }
  if (BINARY.test(file)) continue;
  let text;
  try {
    text = readFileSync(join(root, file), "utf8");
  } catch {
    continue;
  }
  if (/(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/.test(file)) {
    for (const [, host] of text.matchAll(/https?:\/\/([a-zA-Z0-9.-]+)/g)) {
      if (!PUBLIC_HOSTS.test(host)) findings.push(`${file}: names the registry ${host}`);
    }
  }
  const lines = text.split("\n");
  for (const [name, pattern] of SECRETS) {
    const at = lines.findIndex((line) => pattern.test(line));
    if (at >= 0) findings.push(`${file}:${at + 1}: ${name}`);
  }
}

const unique = [...new Set(findings)];
if (unique.length) {
  console.error(`Not ready to publish (${unique.length}):\n${unique.map((f) => `  ${f}`).join("\n")}`);
  process.exit(1);
}
console.log("Ready to publish: no .npmrc, no private registry, no secrets, no personal email.");
