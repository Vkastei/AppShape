import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clone, type Frame, type Project } from "@appshape/ir";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { counter, rng } from "../../ir/test/helpers";
import { randomTree } from "../../ir/test/random";
import {
  AlreadyInitializedError,
  type DataLocation,
  emptyProject,
  initProject,
  ProjectFiles,
  ProjectLoadError,
  resolveLocation,
  serializeProject,
} from "../src";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "appshape-store-"));
  process.env.APPSHAPE_HOME = join(root, "home");
});
afterEach(async () => {
  delete process.env.APPSHAPE_HOME;
  await rm(root, { recursive: true, force: true });
});

function sampleProject(seed = 1): Project {
  const r = rng(seed);
  const frames: Frame[] = [0, 1, 2].map((i) => {
    const tree = randomTree(r, counter(`s${seed}f${i}n`));
    return {
      id: `f_${i}`,
      name: `Frame ${i}`,
      kind: i === 0 ? "imported" : "new",
      platform: i === 2 ? "mobile" : "web",
      target: { adapter: "react-vite", route: `/page-${i}` },
      viewports: [{ id: "desktop", width: 1280 }, { id: "mobile", width: 390 }],
      ...(i === 0 ? { baseline: clone(tree) } : {}),
      current: tree,
    };
  });
  return {
    ...emptyProject("Sample"),
    components: [
      { id: "cmp_button", name: "Button", kind: "ui-kit", platform: "web" },
      { id: "cmp_card", name: "Card", kind: "project", platform: "web" },
    ],
    frames,
    board: {
      items: [
        { type: "frame", id: "p1", frameId: "f_0", x: 0, y: 0 },
        { type: "frame", id: "p2", frameId: "f_0", x: 1400, y: 0, viewportId: "mobile" },
        { type: "note", id: "n1", x: 100, y: -200, text: "Make it pop", color: "yellow" },
        { type: "arrow", id: "a1", kind: "flow", from: { itemId: "p1" }, to: { itemId: "n1" } },
      ],
    },
  };
}

async function setup(project = sampleProject()) {
  const location: DataLocation = { appRoot: root, dataDir: join(root, ".appshape"), mode: "in-repo" };
  const files = new ProjectFiles(location);
  await files.save(project);
  return { location, files };
}

describe("ProjectFiles", () => {
  it("round-trips projects exactly", async () => {
    for (const seed of [1, 2, 3]) {
      const project = sampleProject(seed);
      const { location } = await setup(project);
      const { project: loaded, problems } = await new ProjectFiles(location).load();
      expect(problems).toEqual([]);
      expect(loaded).toEqual(project);
      await rm(location.dataDir, { recursive: true });
    }
  });

  it("keeps drawings (design requests) in requests/, one file each", async () => {
    const at = "2026-10-14T10:00:00.000Z";
    const request = { id: "rq_1", frameId: "f_1", viewportId: "desktop", shapes: [{ id: "s1", kind: "rect" as const, color: "add", x: 10, y: 20, w: 300, h: 80, targets: ["x"] }], message: "A search field here", status: "draft" as const, route: "note" as const, createdAt: at, updatedAt: at };
    const project = { ...sampleProject(), requests: [request] };
    const { location, files } = await setup(project);
    const { project: loaded, problems } = await new ProjectFiles(location).load();
    expect(problems).toEqual([]);
    expect(loaded.requests).toEqual([request]);
    expect(await readFile(join(location.dataDir, "requests", "rq_1.json"), "utf8")).toContain('"message": "A search field here"');
    // removed with the drawing; a drawing on a missing screen is a warning
    expect(await files.save({ ...project, requests: [] })).toEqual(["requests/rq_1.json"]);
    await files.save({ ...project, requests: [{ ...request, frameId: "f_gone" }] });
    expect((await new ProjectFiles(location).load()).problems).toEqual([expect.objectContaining({ severity: "warning", file: "requests/rq_1.json" })]);
  });

  it("writes stable output and only changed files", async () => {
    const project = sampleProject();
    const { files } = await setup(project);
    expect(await files.save(project)).toEqual([]);
    const moved = clone(project);
    moved.board.items[2] = { ...moved.board.items[2]!, x: 999 } as Project["board"]["items"][number];
    expect(await files.save(moved)).toEqual(["board.json"]);
    expect(serializeProject(moved)).toEqual(serializeProject(clone(moved)));
  });

  it("deletes files of removed entities", async () => {
    const project = sampleProject();
    const { files, location } = await setup(project);
    const without = { ...project, frames: project.frames.slice(1), board: { items: [] } };
    const touched = await files.save(without);
    expect(touched).toEqual(expect.arrayContaining(["frames/f_0/frame.json", "frames/f_0/baseline.json", "frames/f_0/current.json"]));
    const reloaded = await new ProjectFiles(location).load();
    expect(reloaded.project.frames.map((f) => f.id)).toEqual(["f_1", "f_2"]);
  });

  it("reports broken files and never overwrites them", async () => {
    const { location } = await setup();
    const broken = join(location.dataDir, "frames", "f_1", "current.json");
    await writeFile(broken, "{ not json");
    const files = new ProjectFiles(location);
    const { project, problems } = await files.load();
    expect(project.frames.map((f) => f.id)).toEqual(["f_0", "f_2"]);
    expect(problems).toEqual([expect.objectContaining({ severity: "error", file: "frames/f_1/current.json" })]);
    await files.save(project);
    expect(await readFile(broken, "utf8")).toBe("{ not json");
  });

  it("reports dangling references as warnings", async () => {
    const project = sampleProject();
    project.board.items.push({ type: "frame", id: "p9", frameId: "f_missing", x: 0, y: 0 });
    const { location } = await setup(project);
    const { problems } = await new ProjectFiles(location).load();
    expect(problems).toEqual([expect.objectContaining({ severity: "warning", message: expect.stringContaining("f_missing") })]);
  });

  it("refuses projects from newer versions and missing files", async () => {
    const { location } = await setup();
    await writeFile(join(location.dataDir, "project.json"), JSON.stringify({ irVersion: 99 }));
    await expect(new ProjectFiles(location).load()).rejects.toThrow(/newer AppShape/);
    await rm(join(location.dataDir, "board.json"));
    await writeFile(join(location.dataDir, "project.json"), serializeProject(sampleProject()).get("project.json")!);
    await expect(new ProjectFiles(location).load()).rejects.toThrow(ProjectLoadError);
  });

  it("notices external changes but not its own writes", async () => {
    const project = sampleProject();
    const { files } = await setup(project);
    await files.load();
    const seen: string[][] = [];
    const stop = files.watch((paths) => seen.push(paths), 50);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const moved = clone(project);
    moved.board.items.pop();
    await files.save(moved);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(seen).toEqual([]);

    await writeFile(join(files.location.dataDir, "board.json"), '{ "items": [] }\n');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await stop();
    expect(seen.flat()).toContain("board.json");
  });
});

describe("locations", () => {
  it("finds in-repo data from nested folders", async () => {
    await initProject(root, { name: "App" });
    await mkdir(join(root, "src", "pages"), { recursive: true });
    const location = await resolveLocation(join(root, "src", "pages"));
    expect(location).toMatchObject({ dataDir: join(root, ".appshape"), mode: "in-repo" });
    await expect(initProject(root)).rejects.toThrow(AlreadyInitializedError);
    const { project } = await new ProjectFiles(location!).load();
    expect(project.name).toBe("App");
  });

  it("finds external data through the registry", async () => {
    const app = join(root, "work-app");
    const data = join(root, "designs", "work-app");
    await mkdir(app, { recursive: true });
    await initProject(app, { external: data });
    expect(await resolveLocation(join(app, "src"))).toMatchObject({ appRoot: app, dataDir: data, mode: "external" });
    expect(await resolveLocation(data)).toMatchObject({ appRoot: app, mode: "external" });
    expect(await resolveLocation(join(root, "elsewhere"))).toBeUndefined();
  });
});
