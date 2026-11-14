/** Comparing measured pages: texts the app shows that the design doesn't account for. */
import { describe, expect, it } from "vitest";
import { extraTexts } from "../src/compare";
import type { MeasuredElement } from "../src/measure";

const el = (p: number, end: number, own = "", key?: string): MeasuredElement => ({ p, end, tag: "div", r: [0, 0, 10, 10], vis: true, own, s: {}, ...(key && { key }) });

describe("extra texts", () => {
  // design: page > card (with a title); app: page > card > title + a new badge
  const design = [el(-1, 2, "", "page"), el(0, 2, "", "card"), el(1, 2, "Pro", "title")];
  const app = [el(-1, 3), el(0, 3), el(1, 2, "Pro"), el(1, 3, "Most popular")];
  const match = new Map([
    [0, 0],
    [1, 1],
    [2, 2],
  ]);

  it("reports a text no design element accounts for", () => {
    expect(extraTexts(design, app, match, 0)).toEqual(["Most popular"]);
  });

  it("not inside an element a drawing asks to change (it isn't held to the design)", () => {
    expect(extraTexts(design, app, match, 0, new Set([1]))).toEqual([]);
    // the same text elsewhere still counts
    expect(extraTexts(design, app, match, 0, new Set([2]))).toEqual(["Most popular"]);
  });
});
