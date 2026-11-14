/**
 * The evaluation's cases without a model (free): every case finds its elements on its screen,
 * an unchanged screen fails its checks, and doing nothing changes nothing outside the scope.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { CASES } from "../src/cases";
import { loadSources, type Sources } from "../src/prepare";
import { markNodes } from "../src/render";
import { outOfScope } from "../src/score";
import { must, Screen } from "../src/tree";

let sources: Sources;
beforeAll(async () => {
  sources = await loadSources();
}, 60_000);

describe("the drawn requests of the evaluation", () => {
  it("are 17, with distinct ids, and cover every kind of change", () => {
    expect(CASES).toHaveLength(17);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(17);
    expect(CASES.filter((c) => c.variants === 3).map((c) => c.id)).toEqual(["variants-hero", "variants-logos"]);
    expect(new Set(CASES.map((c) => c.project))).toEqual(new Set(["landing", "desktopOnly", "pricing", "fixture"]));
    expect(new Set(CASES.map((c) => c.intent).filter(Boolean))).toEqual(new Set(["phones", "section"]));
    expect(CASES.some((c) => c.viewport === "mobile")).toBe(true);
    expect(CASES.filter((c) => !c.message).length).toBeGreaterThanOrEqual(2);
  });

  for (const c of CASES) {
    it(`${c.id}: finds its elements, and the screen as it is doesn't pass`, () => {
      const source = sources[c.project];
      const frame = source.project.frames.find((f) => f.name === c.screen)!;
      expect(frame).toBeDefined();
      const before = new Screen(source.project, frame);
      const refs = Object.fromEntries(Object.entries(c.refs).map(([name, find]) => [name, must(find, before, name).id]));
      for (const mark of c.marks) expect(markNodes(mark, before).length).toBeGreaterThan(0);
      for (const name of [...c.scope, ...(c.into ?? [])]) expect(refs[name]).toBeDefined();
      const checks = c.checks(before, before, refs);
      expect(checks.length).toBeGreaterThan(0);
      expect(checks.every((k) => k.pass)).toBe(false);
      expect(outOfScope(c, before, refs, [])).toEqual([]);
    });
  }
});
