import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ProjectFiles } from "@appshape/store";
import { VerifyService } from "../src/index";

/**
 * Verifies a changeset of an app without writing to its `.appshape/` (works on a copy of it):
 * `tsx scripts/verify-copy.ts <appRoot> <changesetId>`.
 */
const [appArg, changesetId] = process.argv.slice(2);
if (!appArg || !changesetId) throw new Error("usage: verify-copy <appRoot> <changesetId>");
const appRoot = resolve(appArg);
const dataDir = await mkdtemp(join(tmpdir(), "aps-verify-copy-"));
await cp(join(appRoot, ".appshape"), dataDir, { recursive: true, filter: (src) => !src.includes(".cache") });
const service = new VerifyService(appRoot, dataDir);
try {
  const { project } = await new ProjectFiles({ appRoot, dataDir, mode: "in-repo" }).load();
  const changeset = project.changesets.find((c) => c.id === changesetId)!;
  for (const t of changeset.tasks ?? []) console.log(`${t.id} [${t.kind}] ${t.title.slice(0, 150)}`);
  const started = Date.now();
  const result = await service.verifyChangeset(project, changesetId, { log: (l) => console.log(l) });
  console.log(`\n${result.report.status} in ${Math.round((Date.now() - started) / 1000)} s (was ${changeset.status}, would be ${result.changeset.status})`);
  for (const r of result.report.results) {
    console.log(`${r.status === "pass" ? "✓" : r.status === "fail" ? "✗" : "–"} ${r.changeId}`);
    for (const c of r.checks) console.log(`    ${c.status} ${c.text}${c.detail ? `: ${c.detail}` : ""}`);
  }
  for (const v of result.report.visual) console.log(`  ${v.frameId} ${v.viewport}: ${(v.mismatchRatio * 100).toFixed(1)}%`);
} finally {
  await service.close();
  if (!process.env.APPSHAPE_KEEP) await rm(dataDir, { recursive: true, force: true });
}
