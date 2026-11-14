/**
 * Scores a run again with the current checks, without calling a model (free):
 *
 *   pnpm --filter @appshape/draw-eval exec tsx scripts/rescore.ts runs/<time>
 *
 * The model's last answer (answers.json) is read again with the current JSX reader, so fixes to
 * AppShape's side count too; without it, the saved proposal (proposal.json) is used. Generated
 * screens have the same ids on every run, so answers apply to the screens as loaded now.
 */
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { applyJsxEdits, designJsx, type JsxEdit, proposeFromJsx } from "@appshape/codegen";
import { applyOps, type Proposal } from "@appshape/ir";
import { CASES } from "../src/cases";
import { loadSources } from "../src/prepare";
import { report, type Result, summarize } from "../src/report";
import { type Score, score, scoreVariants } from "../src/score";
import { must, Screen } from "../src/tree";

const dir = resolve(process.argv[2] ?? "");
if (!existsSync(join(dir, "results.json"))) throw new Error(`No results.json in ${dir}`);
const results = JSON.parse(await readFile(join(dir, "results.json"), "utf8")) as Result[];
const sources = await loadSources();
let rescored = 0;
for (const result of results) {
  const c = CASES.find((k) => k.id === result.case);
  const file = join(dir, result.setting, result.case, "proposal.json");
  const answers = join(dir, result.setting, result.case, "answers.json");
  if (!c || !result.ok || !existsSync(file)) continue;
  const source = sources[c.project];
  const frame = source.project.frames.find((f) => f.name === c.screen)!;
  const before = new Screen(source.project, frame);
  const refs = Object.fromEntries(Object.entries(c.refs).map(([name, find]) => [name, must(find, before, `${c.id}.${name}`).id]));
  const scoreOf = (proposal: Pick<Proposal, "ops" | "warnings">): Score => {
    const changed = applyOps(new Map([[frame.id, frame]]), proposal.ops).get(frame.id)!;
    const after = new Screen({ ...source.project, frames: source.project.frames.map((f) => (f.id === frame.id ? changed : f)) }, changed);
    return score(c, before, after, refs, proposal.ops, proposal.warnings ?? []);
  };
  if (c.variants) {
    // variants: the saved proposals, scored again
    const others = join(dir, result.setting, result.case, "alternatives.json");
    const all = [JSON.parse(await readFile(file, "utf8")) as Proposal, ...(existsSync(others) ? (JSON.parse(await readFile(others, "utf8")) as Proposal[]) : [])];
    result.score = scoreVariants(all.map(scoreOf), c.variants);
    rescored++;
    continue;
  }
  // the design's last answer (with --again, the Try again answers come after it)
  const last = existsSync(answers) ? (JSON.parse(await readFile(answers, "utf8")) as { jsx?: string; edits?: JsxEdit[] }[])[Math.max(0, result.rounds - 1)] : undefined;
  // answers of changes apply to the screen as it was sent (the same ids on every run)
  const jsx = last?.edits?.length ? applyJsxEdits(designJsx(frame, source.project), last.edits) : last?.jsx;
  const proposal = jsx ? proposeFromJsx(source.project, frame.id, jsx) : (JSON.parse(await readFile(file, "utf8")) as Proposal);
  result.score = scoreOf(proposal);
  rescored++;
}
const settings = [...new Set(results.map((r) => r.setting))];
const cases = CASES.filter((c) => results.some((r) => r.case === c.id));
await writeFile(join(dir, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
await writeFile(join(dir, "report.html"), report(results, { cases, settings, stamp: basename(dir), dry: dir.endsWith("-dry") }));
console.log(`Scored ${rescored} of ${results.length} results again.\n\n${summarize(results, settings)}`);
