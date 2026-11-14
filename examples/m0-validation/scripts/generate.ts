import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectFiles } from "@appshape/store";
import { FIXTURE_ROOT } from "../src/anchor";
import { buildArtifacts } from "../src/artifacts";
import { buildDemoProject } from "../src/demo";

const root = fileURLToPath(new URL("..", import.meta.url));

for (const [path, content] of buildArtifacts()) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  console.log(`wrote ${path}`);
}

// The fixture's project is for dogfooding: create it once, never overwrite edits made in the editor.
const dataDir = join(FIXTURE_ROOT, ".appshape");
if (existsSync(join(dataDir, "project.json"))) {
  console.log(`kept ${dataDir} (delete it to start over from the generated demo project)`);
} else {
  const touched = await new ProjectFiles({ appRoot: FIXTURE_ROOT, dataDir, mode: "in-repo" }).save(buildDemoProject());
  console.log(`demo project: ${touched.length} file(s) written to ${dataDir}`);
}
