/**
 * Answers with only the changed parts: edits by data-id applied to the screen's design JSX give
 * the same proposal as writing the whole screen by hand.
 */
import { defaultTokens } from "@appshape/dialect-tailwind";
import type { Tokens } from "@appshape/ir";
import { beforeAll, describe, expect, it } from "vitest";
import { landingProject } from "../../../examples/codegen-demo/src/landing";
import { applyJsxEdits, designJsx, JsxEditError, proposeFromJsx } from "../src";

let defaults: Tokens;
beforeAll(async () => {
  defaults = await defaultTokens();
});

const home = () => {
  const project = landingProject(defaults);
  const frame = project.frames.find((f) => f.name === "Home")!;
  const jsx = designJsx(frame, project);
  const id = (pattern: RegExp) => pattern.exec(jsx)![1]!;
  return { project, frame, jsx, id };
};
const edit = (op: Parameters<typeof applyJsxEdits>[1][number]["op"], target: string, jsx = "", anchor = "") => ({ op, target, jsx, anchor });

describe("answers with only the changed parts", () => {
  it("replaces, inserts, appends, removes and moves elements by data-id", () => {
    const { project, frame, jsx, id } = home();
    const h1 = id(/<h1 data-id="([^"]+)"/);
    const badge = id(/<Badge data-id="([^"]+)"/);
    const features = id(/data-id="([^"]+)" data-name="Features"/);
    const testimonials = id(/data-id="([^"]+)" data-name="Testimonials"/);
    const faqQuestions = id(/data-id="([^"]+)" data-name="Questions"/);
    const next = applyJsxEdits(jsx, [
      edit("replace", h1, `<h1 data-id="${h1}" className="type-h1 text-center">Ship faster</h1>`),
      edit("remove", badge),
      edit("insertAfter", h1, `<p className="text-sm">No credit card needed.</p>`),
      edit("append", faqQuestions, `<AccordionItem question="Is there an API?" answer="Yes." />`),
      edit("moveBefore", testimonials, "", features),
    ]);
    const draft = proposeFromJsx(project, frame.id, next);
    expect(draft.warnings).toEqual([]);
    const texts = draft.summary.join("\n");
    expect(texts).toContain("“Ship faster”");
    expect(texts).toContain("No credit card needed.");
    expect(texts).toMatch(/Removed .*Badge/);
    expect(texts).toMatch(/Moved/);
    expect(draft.ops.some((o) => o.op === "insert" && JSON.stringify(o.node).includes("Is there an API?"))).toBe(true);
    // the order of the page's sections
    const order = (draft.root as { children: { name?: string }[] }).children.map((c) => c.name);
    expect(order.indexOf("Testimonials")).toBeLessThan(order.indexOf("Features"));
  });

  it("updates an element's classes and keeps its children, also when a model 'replaces' it with an empty copy", () => {
    const { project, frame, jsx, id } = home();
    const grid = id(/<div data-id="([^"]+)" className="grid grid-cols-1 gap-6 aps-reveal/);
    const classes = /<div data-id="[^"]+" (className="grid grid-cols-1 gap-6 aps-reveal[^"]*")/.exec(jsx)![1]!.replace("md:grid-cols-3", "lg:grid-cols-4");
    for (const op of ["update", "replace"] as const) {
      const draft = proposeFromJsx(project, frame.id, applyJsxEdits(jsx, [edit(op, grid, `<div data-id="${grid}" ${classes}></div>`)]));
      expect(draft.ops.map((o) => o.op), op).not.toContain("delete");
      expect(draft.summary.join("\n"), op).toMatch(/Changed the (look|layout)/);
    }
    // a self-closing tag for an element with children keeps them too
    const draft = proposeFromJsx(project, frame.id, applyJsxEdits(jsx, [edit("update", grid, `<div data-id="${grid}" ${classes} />`)]));
    expect(draft.ops.map((o) => o.op)).not.toContain("delete");
  });

  it("is much shorter than the whole screen", () => {
    const { jsx, id } = home();
    const h1 = id(/<h1 data-id="([^"]+)"/);
    const answer = JSON.stringify([edit("replace", h1, `<h1 data-id="${h1}" className="type-h1 text-center">Ship faster</h1>`)]);
    expect(answer.length * 20).toBeLessThan(jsx.length);
  });

  it("takes the whole screen too, for answers that change most of it", () => {
    const { jsx } = home();
    expect(applyJsxEdits(jsx, [edit("screen", "", jsx)])).toBe(jsx);
  });

  it("says in words what it can't apply", () => {
    const { jsx, id } = home();
    const root = id(/^<div data-id="([^"]+)"/);
    const problems = (edits: Parameters<typeof applyJsxEdits>[1]) => {
      try {
        applyJsxEdits(jsx, edits);
        return [];
      } catch (e) {
        expect(e).toBeInstanceOf(JsxEditError);
        return (e as JsxEditError).problems;
      }
    };
    expect(problems([])).toEqual(["The answer has no changes."]);
    expect(problems([edit("remove", "n_nothere")])[0]).toContain('no element with data-id "n_nothere"');
    expect(problems([edit("remove", root)])[0]).toContain("outermost element");
    expect(problems([edit("replace", root)])[0]).toContain("has no JSX");
    expect(problems([edit("moveAfter", root, "", "n_x")])[0]).toContain("outermost");
  });
});
