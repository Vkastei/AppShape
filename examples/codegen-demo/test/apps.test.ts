import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildApps, FIXTURES } from "../src/apps";

describe("generated example apps", () => {
  it("are up to date (run `pnpm --filter @appshape/codegen-demo generate`)", async () => {
    const { files } = await buildApps();
    for (const [path, content] of files) {
      expect(readFileSync(join(FIXTURES, path), "utf8").replace(/\r\n/g, "\n"), path).toBe(content);
    }
  });

  it("generate without warnings and skip only the phone screen", async () => {
    const { warnings, skipped } = await buildApps();
    expect(Object.values(warnings).flat()).toEqual([]);
    expect(skipped).toEqual(["f_phone: phone screen (native code generation comes with M7)"]);
  });
});
