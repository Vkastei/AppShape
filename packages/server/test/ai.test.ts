import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AiError, defaultAnswer, fakeProvider } from "@appshape/ai";
import type { DesignRequest, Project } from "@appshape/ir";
import { TOKEN_HEADER } from "@appshape/protocol";
import { type DataLocation, emptyProject, ProjectFiles } from "@appshape/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AiKeyStore, type RunningServer, startServer } from "../src";

const quiet = { info() {}, warn() {}, error() {} };
const at = "2026-10-14T10:00:00.000Z";
let root: string;
let location: DataLocation;
let server: RunningServer | undefined;

const request: DesignRequest = { id: "rq_1", frameId: "f_home", viewportId: "desktop", message: "A shorter heading", status: "draft", createdAt: at, updatedAt: at, shapes: [{ id: "s_1", kind: "rect", color: "change", x: 0, y: 0, w: 300, h: 60, targets: ["n_title"] }] };
const project = (): Project => ({
  ...emptyProject("AI test"),
  frames: [{ id: "f_home", name: "Home", kind: "new", platform: "web", target: { adapter: "react-vite", route: "/" }, viewports: [{ id: "desktop", width: 1280 }], current: { id: "n_root", type: "box", origin: "added", children: [{ id: "n_title", type: "text", origin: "added", text: "A very long heading for the page", semantic: { role: "heading", level: 1 } }] } }],
  requests: [request],
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "appshape-ai-"));
  process.env.APPSHAPE_HOME = join(root, ".home");
  location = { appRoot: root, dataDir: join(root, ".appshape"), mode: "in-repo" };
  await new ProjectFiles(location).save(project());
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  delete process.env.APPSHAPE_HOME;
  await rm(root, { recursive: true, force: true });
});

const start = async (keys: AiKeyStore, provider = fakeProvider(defaultAnswer, { model: "claude-sonnet-5-5" })) => {
  server = await startServer({ location, saveDelayMs: 20, log: quiet, aiKeys: keys, aiProvider: () => provider });
  return provider;
};
const api = (path: string, init: RequestInit = {}) => fetch(`${server!.url}${path}`, { ...init, headers: { [TOKEN_HEADER]: server!.token, "content-type": "application/json", ...init.headers } });
const withKey: AiKeyStore = { get: async () => ({ key: "sk-test", source: "env" }) };
const noKey: AiKeyStore = { get: async () => undefined };
const current = () => server!.session.snapshot().project.requests?.find((r) => r.id === "rq_1");
async function until(test: () => boolean, timeout = 20_000) {
  const end = Date.now() + timeout;
  while (!test()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("AppShape's AI on the server", () => {
  it("needs a key; says where keys come from", async () => {
    await start(noKey);
    expect(await (await api("/api/ai")).json()).toMatchObject({ available: false, keySource: "none", canSaveKey: false, model: "claude-opus-5-5", consented: false, month: { requests: 0 } });
    const response = await api("/api/requests/rq_1/design", { method: "POST" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("ANTHROPIC_API_KEY");
    expect((await api("/api/ai", { method: "PUT", body: JSON.stringify({ key: "sk-x" }) })).status).toBe(400);
  });

  it("designs a drawn request: designing, then a proposal with its cost; spending is counted", { timeout: 60_000 }, async () => {
    const provider = await start(withKey);
    await api("/api/ai", { method: "PUT", body: JSON.stringify({ model: "claude-sonnet-5-5", consented: true }) });
    const estimate = await (await api("/api/requests/rq_1/estimate")).json();
    expect(estimate.model).toBe("claude-sonnet-5-5");
    expect(estimate.costUsd).toBeGreaterThan(0);
    // every model's, for the picker: Haiku cheapest, Opus dearest
    expect(estimate.byModel["claude-sonnet-5-5"]).toBe(estimate.costUsd);
    expect(estimate.byModel["claude-haiku-5-5"]).toBeLessThan(estimate.costUsd);
    expect(estimate.byModel["claude-opus-5-5"]).toBeGreaterThan(estimate.costUsd);

    expect(await (await api("/api/requests/rq_1/design", { method: "POST" })).json()).toEqual({ started: true, model: "claude-sonnet-5-5" });
    expect(current()).toMatchObject({ status: "designing", route: "ai" });
    await until(() => current()?.status === "proposed");
    expect(current()!.proposal).toMatchObject({ by: "claude-sonnet-5-5", summary: ["Changed the text “A very long heading for the page” to “Designed by the fake AI”"], usage: { inputTokens: 1000, outputTokens: 200 } });
    // the model got the request, the design system, and both pictures (when a browser is there)
    expect(provider.calls[0]!.details).toContain("A shorter heading");
    expect(provider.calls[0]!.images.marked?.subarray(1, 4)).toEqual(new Uint8Array([0x50, 0x4e, 0x47]));
    const status = await (await api("/api/ai")).json();
    expect(status).toMatchObject({ consented: true, last: { model: "claude-sonnet-5-5" }, month: { requests: 1 } });
    expect(JSON.parse(await readFile(join(root, ".home", "ai.json"), "utf8"))).not.toHaveProperty("key");
  });

  it("designs three variants in one request: the picked one and the others", { timeout: 60_000 }, async () => {
    await new ProjectFiles(location).save({ ...project(), requests: [{ ...request, variants: 3 }] });
    const provider = await start(withKey);
    await api("/api/ai", { method: "PUT", body: JSON.stringify({ model: "claude-sonnet-5-5", consented: true }) });
    await api("/api/requests/rq_1/design", { method: "POST" });
    await until(() => current()?.status === "proposed");
    expect(provider.calls[0]!.variants).toBe(3);
    expect(current()!.proposal).toMatchObject({ variant: 1, idea: "A bold headline" });
    expect(current()!.alternatives?.map((p) => [p.variant, p.summary])).toEqual([
      [2, ["Changed the text “A very long heading for the page” to “Designed by the fake AI (2)”"]],
      [3, ["Changed the text “A very long heading for the page” to “Designed by the fake AI (3)”"]],
    ]);
  });

  it("puts a failure on the drawing, and cancels", { timeout: 60_000 }, async () => {
    await start(withKey, fakeProvider(() => {
      throw new AiError("Too many requests right now (rate limit). Try again in a minute; the drawing is kept.", "rate");
    }));
    await api("/api/requests/rq_1/design", { method: "POST" });
    await until(() => current()?.status === "draft" && current()?.error !== undefined);
    expect(current()).toMatchObject({ status: "draft", route: "ai", error: "Too many requests right now (rate limit). Try again in a minute; the drawing is kept." });
    await server!.close();

    await start(withKey, fakeProvider(defaultAnswer, { delayMs: 30_000 }));
    await api("/api/requests/rq_1/design", { method: "POST" });
    expect(current()).toMatchObject({ status: "designing" });
    expect(current()).not.toHaveProperty("error");
    await api("/api/requests/rq_1/cancel", { method: "POST" });
    await until(() => current()?.status === "draft");
    await new Promise((r) => setTimeout(r, 200));
    expect(current()!.error).toBeUndefined();
  });

  it("saves a key only where a keychain is (the desktop app)", async () => {
    let saved: string | null | undefined;
    await start({ get: async () => (saved ? { key: saved, source: "keychain" } : undefined), set: async (provider, key) => void (saved = provider === "anthropic" ? key : "wrong provider") });
    expect(await (await api("/api/ai", { method: "PUT", body: JSON.stringify({ key: "sk-ant-123" }) })).json()).toMatchObject({ available: true, keySource: "keychain", canSaveKey: true });
    expect(saved).toBe("sk-ant-123");
    expect(JSON.stringify(await (await api("/api/ai")).json())).not.toContain("sk-ant-123");
  });
});
