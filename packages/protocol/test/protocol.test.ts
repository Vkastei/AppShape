import { describe, expect, it } from "vitest";
import { z } from "zod";
import { mcpTools, renderSpecMarkdown, type SpecDocument, SpecDocumentSchema } from "../src";

describe("MCP contract", () => {
  it("converts every tool input and output to JSON Schema", () => {
    for (const [name, tool] of Object.entries(mcpTools)) {
      expect(() => z.toJSONSchema(tool.input, { io: "input" }), name).not.toThrow();
      expect(() => z.toJSONSchema(tool.output, { unrepresentable: "any" }), name).not.toThrow();
      expect(tool.cli.startsWith("appshape "), name).toBe(true);
    }
  });
});

describe("renderSpecMarkdown", () => {
  const doc: SpecDocument = {
    specVersion: 1,
    generatedAt: "2026-10-05T10:00:00.000Z",
    changeset: { id: "cs_test", title: "Test", status: "ready" },
    project: { name: "demo", root: "app", stack: ["React", "Tailwind CSS v4"], adapter: "react-vite", styleDialect: "tailwind-v4" },
    components: [{ name: "Button", file: "src/ui/button.tsx", kind: "ui-kit" }],
    frames: [
      {
        frameId: "f_home",
        name: "Home",
        kind: "imported",
        platform: "web",
        target: { adapter: "react-vite", route: "/" },
        viewports: ["desktop 1280"],
        changes: [
          {
            id: "c1",
            opIds: ["op_1"],
            kind: "restyle",
            title: "Round the card",
            node: { id: "n_card", name: "Card", element: "div", source: { file: "src/Card.tsx", line: 3, col: 5 } },
            scope: "component",
            instances: { count: 3 },
            classes: { remove: ["rounded-md"], add: ["rounded-xl"] },
          },
        ],
      },
    ],
    requirements: [],
    acceptance: [{ changeId: "c1", text: "Cards use rounded-xl" }],
    hints: [],
  };

  it("validates and renders the essentials", () => {
    expect(SpecDocumentSchema.safeParse(doc).success).toBe(true);
    const md = renderSpecMarkdown(doc);
    expect(md).toContain("### c1 · restyle · scope: component (3 instances)");
    expect(md).toContain("`<div>` Card (`src/Card.tsx:3:5`)");
    expect(md).toContain("remove `rounded-md` · add `rounded-xl`");
    expect(md).toContain("- [ ] **c1**: Cards use rounded-xl");
  });

  it("rejects acceptance criteria for unknown changes", () => {
    const bad = { ...doc, acceptance: [{ changeId: "c9", text: "?" }] };
    expect(SpecDocumentSchema.safeParse(bad).success).toBe(false);
  });
});
