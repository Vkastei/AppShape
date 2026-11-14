import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyOps,
  ChangesetSchema,
  ComponentSchema,
  diffTree,
  type Frame,
  FrameSchema,
  findNode,
  findReferenceProblems,
  normalizeNode,
  ProjectSchema,
  squash,
  TokensSchema,
} from "@appshape/ir";
import { SpecDocumentSchema } from "@appshape/protocol";
import { ProjectFiles } from "@appshape/store";
import { describe, expect, it } from "vitest";
import { buildArtifacts, buildModel, DEMO_PROJECT } from "../src/artifacts";
import { buildDemoProject } from "../src/demo";

const root = fileURLToPath(new URL("..", import.meta.url));
const { pricing, changesets, specs, tokens, components } = buildModel();
const frames = new Map<string, Frame>([[pricing.id, pricing]]);

describe("hand-written IR", () => {
  it("validates against the schemas", () => {
    expect(() => FrameSchema.parse(pricing)).not.toThrow();
    expect(() => TokensSchema.parse(tokens)).not.toThrow();
    for (const c of components) expect(() => ComponentSchema.parse(c)).not.toThrow();
  });

  it("only uses token refs that exist", () => {
    const refs = JSON.stringify([pricing, changesets]).match(/"\$[a-zA-Z]+\.[^"]+"/g) ?? [];
    for (const raw of new Set(refs)) {
      const [group, ...name] = raw.slice(2, -1).split(".");
      expect(tokens.groups[group as keyof typeof tokens.groups]?.[name.join(".")], raw).toBeDefined();
    }
  });
});

describe.each(changesets.map((cs, i) => [cs.id, cs, specs[i]!] as const))("%s", (_, changeset, spec) => {
  it("is a valid ready changeset", () => {
    expect(() => ChangesetSchema.parse(changeset)).not.toThrow();
  });

  it("applies cleanly, and squash/diff reproduce the result", () => {
    const after = applyOps(frames, changeset.ops);
    const viaSquash = applyOps(frames, squash(changeset.ops, frames));
    for (const [id, frame] of after) {
      expect(normalizeNode(viaSquash.get(id)!.current)).toEqual(normalizeNode(frame.current));
      expect(() => FrameSchema.parse(frame)).not.toThrow();
      const before = frames.get(id);
      if (before) {
        const ops = diffTree(id, before.current, frame.current);
        const replay = applyOps(frames, ops).get(id)!;
        expect(normalizeNode(replay.current)).toEqual(normalizeNode(frame.current));
      }
    }
  });

  it("has a spec that covers every op exactly once and refers to real nodes", () => {
    expect(() => SpecDocumentSchema.parse(spec)).not.toThrow();
    const specChanges = spec.frames.flatMap((f) => f.changes);
    expect(specChanges.map((c) => ({ id: c.id, opIds: c.opIds }))).toEqual(changeset.changes);
    const after = applyOps(frames, changeset.ops);
    for (const frame of spec.frames) {
      const tree = frames.get(frame.frameId)?.current ?? after.get(frame.frameId)!.current;
      for (const change of frame.changes) {
        const refs = [change.node, change.position?.parent, change.position?.after, change.position?.before];
        for (const ref of refs.filter((r) => r !== undefined)) {
          expect(findNode(tree, ref.id), `${change.id} → ${ref.id}`).toBeDefined();
        }
      }
    }
  });
});

describe("generated files", () => {
  it("are up to date (run `pnpm m0:generate`)", () => {
    for (const [path, content] of buildArtifacts()) {
      expect(readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n"), path).toBe(content);
    }
  });
});

describe("demo project", () => {
  const demo = buildDemoProject();

  it("is valid and has no dangling references", () => {
    expect(() => ProjectSchema.parse(demo)).not.toThrow();
    expect(findReferenceProblems(demo.board, new Map(demo.frames.map((f) => [f.id, f])))).toEqual([]);
  });

  it("loads from the generated files", async () => {
    const { project, problems } = await new ProjectFiles({ appRoot: "", dataDir: join(root, DEMO_PROJECT), mode: "in-repo" }).load();
    expect(problems).toEqual([]);
    expect(project.board).toEqual(demo.board);
    expect(project.frames.map((f) => f.id).sort()).toEqual(demo.frames.map((f) => f.id).sort());
  });
});
