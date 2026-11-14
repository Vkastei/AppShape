import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { binDir, cliOnPath, refreshShim, setCliOnPath, shimContent } from "../src/cli-path";

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "appshape-cli-path-"));
  process.env.APPSHAPE_HOME = home;
});
afterEach(async () => {
  delete process.env.APPSHAPE_HOME;
  await rm(home, { recursive: true, force: true });
});

const target = { exe: "C:\Program Files\AppShape\AppShape.exe", cli: "C:\Program Files\AppShape\resources\app\cli\appshape.mjs" };

describe("appshape command in terminals", () => {
  it("runs the bundled CLI with the app's executable in Node mode, without leaking the variable", () => {
    expect(shimContent(target, "win32")).toBe(
      '@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"C:\Program Files\AppShape\AppShape.exe" "C:\Program Files\AppShape\resources\app\cli\appshape.mjs" %*\r\n',
    );
    expect(shimContent({ exe: "/Applications/AppShape.app/Contents/MacOS/AppShape", cli: "/x/appshape.mjs" }, "darwin")).toBe(
      '#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "/Applications/AppShape.app/Contents/MacOS/AppShape" "/x/appshape.mjs" "$@"\n',
    );
  });

  it("writes the script, changes the PATH and remembers it; off removes it", async () => {
    const calls: [string, boolean][] = [];
    const updatePath = async (dir: string, add: boolean) => void calls.push([dir, add]);
    expect((await cliOnPath()).on).toBe(false);

    const on = await setCliOnPath(true, target, updatePath);
    expect(on).toMatchObject({ on: true, dir: join(home, "bin") });
    const shim = join(binDir(), process.platform === "win32" ? "appshape.cmd" : "appshape");
    expect(await readFile(shim, "utf8")).toContain(target.cli);
    expect(JSON.parse(await readFile(join(home, "settings.json"), "utf8")).cliOnPath).toBe(true);

    // after an update the script follows the app
    await refreshShim({ ...target, exe: "D:\AppShape.exe" });
    expect(await readFile(shim, "utf8")).toContain("D:\AppShape.exe");

    expect((await setCliOnPath(false, target, updatePath)).on).toBe(false);
    expect(existsSync(shim)).toBe(false);
    expect(calls).toEqual([
      [join(home, "bin"), true],
      [join(home, "bin"), false],
    ]);
  });
});
