/**
 * Runs the evaluation of AppShape's AI on the drawn requests (`src/cases.ts`) with real models,
 * scores every proposal and writes a report with the pictures (runs/<time>/report.html).
 *
 *   pnpm draw:eval -- --settings opus:medium,sonnet:medium,haiku:medium [--cases id,id] [--budget 10] [--again] [--dry]
 *
 * --again: after each design, asks once more with a follow-up message (like *Try again*) and
 * records what that second request cost and how much of it was read from the prompt cache.
 *
 * Costs money: every run is added to runs/spend.json, and a run stops before it would take the
 * total over --budget (USD, default 10). --dry uses the fake model (free) to try the harness.
 * The key comes from ANTHROPIC_API_KEY, or from the repository's .env (never printed or stored).
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { AiError, costOf, createProvider, type DesignAnswer, type DesignProvider, type Effort, defaultAnswer, designRequest, expectedCost, fakeProvider } from "@appshape/ai";
import { launchBrowser } from "@appshape/capture";
import { CASES } from "../src/cases";
import { afterImage, afterScreen, loadSources, type Prepared, prepare } from "../src/prepare";
import { REPO } from "../src/projects";
import { report, type Result, summarize } from "../src/report";
import { score, scoreVariants } from "../src/score";

const { values } = parseArgs({
  options: {
    settings: { type: "string", default: "opus:medium,sonnet:medium,haiku:low" },
    cases: { type: "string" },
    budget: { type: "string", default: "10" },
    concurrency: { type: "string", default: "3" },
    dry: { type: "boolean", default: false },
    again: { type: "boolean", default: false },
  },
});

const ALIASES: Record<string, string> = { opus: "claude-opus-5-5", sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-5-5" };
const settings = values.settings!.split(",").map((s) => {
  const [model, effort = "medium"] = s.trim().split(":");
  return { model: ALIASES[model!] ?? model!, effort: effort as Effort, name: `${model}-${effort}` };
});
const cases = values.cases ? CASES.filter((c) => values.cases!.split(",").includes(c.id)) : CASES;
const budget = Number(values.budget);
const dry = values.dry!;

if (!dry && !process.env.ANTHROPIC_API_KEY && existsSync(join(REPO, ".env"))) process.loadEnvFile(join(REPO, ".env"));
if (!dry && !process.env.ANTHROPIC_API_KEY) throw new Error("No ANTHROPIC_API_KEY (environment or the repository's .env); use --dry to try the harness for free.");

const RUNS = new URL("../runs/", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const ledgerFile = join(RUNS, "spend.json");
type Ledger = { totalUsd: number; runs: { at: string; settings: string[]; cases: number; costUsd: number }[] };
await mkdir(RUNS, { recursive: true });
const ledger: Ledger = existsSync(ledgerFile) ? (JSON.parse(await readFile(ledgerFile, "utf8")) as Ledger) : { totalUsd: 0, runs: [] };
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const out = join(RUNS, dry ? `${stamp}-dry` : stamp);
await mkdir(out, { recursive: true });


console.log(`${cases.length} cases × ${settings.map((s) => s.name).join(", ")}${dry ? " (dry: fake model)" : ""}; spent so far $${ledger.totalUsd.toFixed(2)} of $${budget}`);
const browser = await launchBrowser();
const sources = await loadSources();
const prepared: Prepared[] = [];
for (const c of cases) {
  const p = await prepare(c, sources, browser);
  prepared.push(p);
  const dir = join(out, "cases", c.id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "clean.png"), p.images.clean);
  await writeFile(join(dir, "marked.png"), p.images.marked);
  await writeFile(join(dir, "request.json"), `${JSON.stringify(p.request, null, 2)}\n`);
}

let spent = 0;
let stopped = false;
const results: Result[] = [];
const save = async () => {
  ledger.totalUsd = Math.round((ledger.totalUsd + spent) * 10000) / 10000;
  if (!dry) ledger.runs.push({ at: new Date().toISOString(), settings: settings.map((s) => s.name), cases: cases.length, costUsd: Math.round(spent * 10000) / 10000 });
  if (!dry) await writeFile(ledgerFile, `${JSON.stringify(ledger, null, 2)}\n`);
  spent = 0;
};

async function runOne(p: Prepared, setting: (typeof settings)[number]): Promise<void> {
  const expected = expectedCost(p.source.project, p.request, setting.model);
  // stop before going over the budget (the estimate with a margin)
  if (!dry && ledger.totalUsd + spent + expected * 1.5 > budget) {
    if (!stopped) console.log(`Stopping: the next request could take the total over $${budget}.`);
    stopped = true;
    return;
  }
  const answers: DesignAnswer[] = [];
  const base: DesignProvider = dry ? fakeProvider(defaultAnswer, { model: "fake" }) : createProvider(setting.model, { effort: setting.effort });
  const provider: DesignProvider = { model: base.model, design: async (call) => answers[answers.push(await base.design(call)) - 1]! };
  const started = Date.now();
  const dir = join(out, setting.name, p.case.id);
  await mkdir(dir, { recursive: true });
  const result: Result = { case: p.case.id, setting: setting.name, model: setting.model, effort: setting.effort, ok: false, seconds: 0, costUsd: 0, expectedUsd: Math.round(expected * 10000) / 10000, rounds: 0, summary: [], questions: [] };
  try {
    const designed = await designRequest({ project: p.source.project, request: p.request, provider, images: p.images });
    // one design, or each variant (after.png, after-2.png, …)
    const designs = [designed.proposal, ...designed.alternatives];
    const scores = [];
    for (const [i, proposal] of designs.entries()) {
      const after = afterScreen(p, proposal.ops);
      scores.push(score(p.case, p.before, after, p.refs, proposal.ops, proposal.warnings ?? []));
      const suffix = i ? `-${i + 1}` : "";
      await writeFile(join(dir, `after${suffix}.png`), await afterImage(p, after, browser));
      await writeFile(join(dir, `after${suffix}.jsx`), after.jsx());
    }
    Object.assign(result, {
      ok: true,
      costUsd: dry ? 0 : Math.round(designed.costUsd * 10000) / 10000,
      rounds: designed.rounds,
      usage: designed.usage,
      summary: designs.flatMap((d, i) => d.summary.map((s) => (designs.length > 1 ? `${i + 1}: ${s}` : s))),
      questions: designed.proposal.questions ?? [],
      score: p.case.variants ? scoreVariants(scores, p.case.variants) : scores[0],
      ...(p.case.variants && { ideas: designs.map((d) => d.idea ?? "") }),
    });
    // to score again with changed checks (scripts/rescore.ts); generated screens keep their ids
    await writeFile(join(dir, "proposal.json"), `${JSON.stringify(designed.proposal, null, 2)}\n`);
    if (designed.alternatives.length) await writeFile(join(dir, "alternatives.json"), `${JSON.stringify(designed.alternatives, null, 2)}\n`);
  } catch (error) {
    result.error = error instanceof AiError ? `${error.kind}: ${error.message}` : String((error as Error).stack ?? error);
    result.rounds = answers.length;
    result.costUsd = dry ? 0 : Math.round(answers.reduce((sum, a) => sum + costOf(setting.model, a.usage), 0) * 10000) / 10000;
  }
  result.seconds = Math.round((Date.now() - started) / 100) / 10;
  // Try again: the same drawing with a follow-up (the pictures and the screen come from the cache)
  if (values.again && result.ok) {
    const at = new Date().toISOString();
    const followUp = { ...p.request, message: "Try a slightly different take on it.", history: [{ message: p.request.message, at }] };
    try {
      const again = await designRequest({ project: p.source.project, request: followUp, provider, images: p.images });
      result.again = { costUsd: dry ? 0 : Math.round(again.costUsd * 10000) / 10000, rounds: again.rounds, usage: again.usage };
      result.costUsd = Math.round((result.costUsd + result.again.costUsd) * 10000) / 10000;
    } catch (error) {
      result.again = { costUsd: 0, rounds: 0, error: String((error as Error).message ?? error) };
    }
  }
  spent += result.costUsd;
  await writeFile(join(dir, "answers.json"), `${JSON.stringify(answers.map(({ transcript: _t, ...a }) => a), null, 2)}\n`);
  results.push(result);
  const s = result.score;
  const again = result.again?.usage ? ` · again $${result.again.costUsd.toFixed(3)} (${result.again.usage.cacheReadTokens} cached of ${result.again.usage.inputTokens + result.again.usage.cacheReadTokens + result.again.usage.cacheWriteTokens} input tokens)` : result.again?.error ? ` · again failed: ${result.again.error.slice(0, 60)}` : "";
  console.log(`${setting.name.padEnd(16)} ${p.case.id.padEnd(24)} ${result.ok ? `${s!.passed}/${s!.checks.length} checks, ${s!.collateral.length} outside, ${s!.warnings.length} warnings` : `failed: ${result.error!.slice(0, 80)}`} · $${result.costUsd.toFixed(3)} · ${result.seconds}s${result.rounds > 1 ? " · repaired" : ""}${again}`);
}

try {
  for (const setting of settings) {
    // a few at a time; the first request of a setting alone, so the others read its cached prefix
    const queue = [...prepared];
    const first = queue.shift();
    if (first) await runOne(first, setting);
    const workers = Array.from({ length: Number(values.concurrency) }, async () => {
      for (let p = queue.shift(); p; p = queue.shift()) await runOne(p, setting);
    });
    await Promise.all(workers);
  }
} finally {
  await save();
  await browser.close();
  await writeFile(join(out, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  await writeFile(join(out, "report.html"), report(results, { cases: prepared.map((p) => p.case), settings: settings.map((s) => s.name), stamp, dry }));
}

const table = summarize(results, settings.map((s) => s.name));
console.log(`\n${table}\nReport: ${join(out, "report.html")}\nSpent this run: $${results.reduce((s, r) => s + r.costUsd, 0).toFixed(2)}; total $${ledger.totalUsd.toFixed(2)} of $${budget}`);
