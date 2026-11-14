import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildApps, FIXTURES } from "../src/apps";

const { files, warnings, skipped } = await buildApps();
for (const [path, content] of files) {
  mkdirSync(dirname(join(FIXTURES, path)), { recursive: true });
  writeFileSync(join(FIXTURES, path), content);
}
console.log(`wrote ${files.size} files under fixtures/generated-*`);
console.log("skipped:", skipped);
console.log("warnings:", warnings);
