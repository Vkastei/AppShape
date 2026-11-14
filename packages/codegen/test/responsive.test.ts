/**
 * "Make it work on phones": changes for phones only are fine; anything that also changes tablets
 * and desktops is found and becomes a warning on the proposal.
 */
import { defaultTokens } from "@appshape/dialect-tailwind";
import type { DesignRequest, Tokens } from "@appshape/ir";
import { beforeAll, describe, expect, it } from "vitest";
import { landingProject } from "../../../examples/codegen-demo/src/landing";
import { designJsx, largerScreenChanges, proposeFromJsx, proposeOptionsFor, requestBrief } from "../src";

let defaults: Tokens;
beforeAll(async () => {
  defaults = await defaultTokens();
});

const home = () => {
  const project = landingProject(defaults);
  const frame = project.frames.find((f) => f.name === "Home")!;
  return { project, frame, jsx: designJsx(frame, project) };
};
const GRID = /className="grid grid-cols-1 gap-6 aps-reveal aps-stagger \[--aps-stagger:120ms\] \*:motion-safe:animate-\[aps-slide-up_600ms_ease-out_both\] md:grid-cols-3"/;

describe("make it work on phones", () => {
  it("finds what changes on larger screens, and nothing for phone-only changes", () => {
    const { project, frame, jsx } = home();
    const grid = /<div data-id="([^"]+)" className="grid grid-cols-1 gap-6 aps-reveal/.exec(jsx)![1]!;
    const changed = (next: string) => largerScreenChanges(frame.current, proposeFromJsx(project, frame.id, next).root, project.tokens, 768);
    // phones get two columns, tablets and desktops keep three: fine
    expect(changed(jsx.replace(GRID, (m) => m.replace("grid-cols-1 ", "grid-cols-2 ")))).toEqual([]);
    // desktops get four: found
    expect(changed(jsx.replace(GRID, (m) => m.replace("md:grid-cols-3", "md:grid-cols-4")))).toEqual([grid]);
    // hidden on phones only: fine
    const h1 = /<h1 data-id="([^"]+)" className="([^"]+)"/.exec(jsx)!;
    expect(changed(jsx.replace(`className="${h1[2]}"`, `className="${h1[2]} hidden md:block"`))).toEqual([]);
    // smaller padding on phones only (an override that sets only top and bottom keeps the sides)
    const hero = /<section data-id="[^"]+" data-name="Hero" className="([^"]+)"/.exec(jsx)!;
    expect(hero[1]).toBe("flex flex-col items-center px-gutter py-section md:px-gutter md:py-section-lg");
    expect(changed(jsx.replace(`className="${hero[1]}"`, `className="flex flex-col items-center px-gutter py-8 md:py-section-lg"`))).toEqual([]);
    // a class AppShape keeps as it is, for smaller screens only
    expect(changed(jsx.replace(`className="${hero[1]}"`, `className="${hero[1]} max-md:py-8"`))).toEqual([]);
    // a new element that shows on desktops: its parent is found
    expect(changed(jsx.replace(`</h1>`, `</h1>\n<p className="text-sm">New</p>`)).length).toBe(1);
  });

  it("warns on the proposal when larger screens change, and says the job in the request", () => {
    const { project, frame, jsx } = home();
    const at = "2026-10-19T10:00:00.000Z";
    const request: DesignRequest = { id: "rq_1", frameId: frame.id, viewportId: "mobile", message: "", status: "draft", intent: "phones", shapes: [], createdAt: at, updatedAt: at };
    const options = proposeOptionsFor(project, request);
    expect(options).toEqual({ keepFrom: 768 });
    const draft = proposeFromJsx(project, frame.id, jsx.replace(GRID, (m) => m.replace("md:grid-cols-3", "md:grid-cols-4")), options);
    expect(draft.warnings.join(" ")).toMatch(/Also looks different on larger screens \(768px and up\)/);
    expect(proposeFromJsx(project, frame.id, jsx.replace(GRID, (m) => m.replace("grid-cols-1 ", "grid-cols-2 ")), options).warnings).toEqual([]);
    expect(proposeOptionsFor(project, { ...request, intent: undefined })).toEqual({});

    const brief = requestBrief(project, request);
    expect(brief).toContain("## The job: make this screen work on phones");
    expect(brief).toContain("(no message: the job above)");
    expect(requestBrief(project, { ...request, intent: "section", message: "Pricing with three plans" })).toContain("## The job: one new section");
    // a review: findings with submit_review, nothing changed
    const review = requestBrief(project, { ...request, intent: "review" });
    expect(review).toContain("## The job: review this screen");
    expect(review).toContain("Call `submit_review`");
    expect(review).not.toContain("Answer with the whole screen");
    // variants: the coding agent answers with all of them together
    const three = requestBrief(project, { ...request, variants: 3 });
    expect(three).toContain("## 3 variants");
    expect(three).toContain("Answer with 3 whole screens as JSX");
    expect(brief).not.toContain("variants");
  });
});
