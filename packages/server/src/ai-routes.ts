import { join } from "node:path";
import { AI_MODELS, AiError, aiModel, aiProvider, createProvider, DEFAULT_MODEL, type DesignProvider, defaultAnswer, designRequest, expectedCost, fakeProvider, reviewRequest } from "@appshape/ai";
import { designPictures, launchBrowser } from "@appshape/capture";
import type { AnyOp, DesignRequest } from "@appshape/ir";
import { type AiEstimate, type AiStatus, AiUpdateSchema } from "@appshape/protocol";
import { appshapeHome, type DataLocation, readText, writeFileAtomic } from "@appshape/store";
import type { Hono } from "hono";
import { z } from "zod";
import type { EventLog } from "./events";
import type { ProjectSession } from "./session";

/**
 * AppShape's own AI (Draw & describe): designs a drawn request with the user's API key, on the
 * server (the key never reaches the board). Starting sets the request to *designing*; the result
 * (a proposal, or the reason it failed) arrives as a change of the request, like any other edit.
 */

/**
 * Where a provider's API key comes from (`provider` is an `AI_PROVIDERS` id: anthropic, later
 * others). The key is never stored in the project and never sent to the browser.
 */
export interface AiKeyStore {
  get(provider: string): Promise<{ key: string; source: "env" | "keychain" } | undefined>;
  /** Saves (or with null removes) a key; only where a safe store exists (the desktop app's keychain). */
  set?(provider: string, key: string | null): Promise<void>;
}

/** The terminal's keys: the provider's environment variable (ANTHROPIC_API_KEY, …); nothing is written to disk. */
export const envKeyStore: AiKeyStore = {
  async get(provider) {
    const key = process.env[aiProvider(provider).keyEnv];
    return key ? { key, source: "env" } : undefined;
  },
};

/** Personal AI settings and spending (`~/.appshape/ai.json`; no key in it). */
const AiFileSchema = z.looseObject({
  model: z.string().optional(),
  consented: z.boolean().optional(),
  last: z.object({ model: z.string(), costUsd: z.number(), at: z.string() }).optional(),
  month: z.object({ month: z.string(), costUsd: z.number(), requests: z.number() }).optional(),
});
type AiFile = z.infer<typeof AiFileSchema>;
const aiFile = () => join(appshapeHome(), "ai.json");

async function readAiFile(): Promise<AiFile> {
  try {
    return AiFileSchema.parse(JSON.parse((await readText(aiFile())) ?? "{}"));
  } catch {
    return {};
  }
}
async function updateAiFile(change: (file: AiFile) => AiFile): Promise<AiFile> {
  const next = change(await readAiFile());
  await writeFileAtomic(aiFile(), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
const thisMonth = () => new Date().toISOString().slice(0, 7);

export interface AiRoutesOptions {
  keys: AiKeyStore;
  /** A provider to use instead of the Claude API (tests; APPSHAPE_FAKE_AI=1 uses the built-in fake). */
  provider?: (model: string, key: string | undefined) => DesignProvider;
}

export function aiRoutes(app: Hono, session: ProjectSession, location: DataLocation, log: EventLog, applyFromServer: (ops: AnyOp[]) => boolean, options: AiRoutesOptions): { close(): Promise<void> } {
  const fake = process.env.APPSHAPE_FAKE_AI === "1";
  const running = new Map<string, AbortController>();
  let browser: ReturnType<typeof launchBrowser> | undefined;

  const key = async (model: string) => (fake ? { key: "fake", source: "env" as const } : await options.keys.get(aiModel(model).provider));
  const provider = (model: string, apiKey: string | undefined): DesignProvider =>
    options.provider?.(model, apiKey) ?? (fake ? fakeProvider(defaultAnswer, { model: "fake", delayMs: 400 }) : createProvider(model, { ...(apiKey && { apiKey }) }));

  const status = async (): Promise<AiStatus> => {
    const file = await readAiFile();
    const model = aiModel(file.model ?? DEFAULT_MODEL).id;
    const found = await key(model);
    const month = file.month?.month === thisMonth() ? file.month : { month: thisMonth(), costUsd: 0, requests: 0 };
    return {
      available: Boolean(found),
      keySource: found?.source ?? "none",
      canSaveKey: Boolean(options.keys.set),
      model,
      models: AI_MODELS.map((m) => ({ id: m.id, label: m.label, provider: m.provider, note: m.note })),
      consented: Boolean(file.consented),
      ...(file.last && { last: file.last }),
      month,
    };
  };

  const current = (id: string) => session.snapshot().project.requests?.find((r) => r.id === id);
  /** What a request cost, added to the month's spending (ai.json). */
  const countSpending = (model: string, costUsd: number) =>
    updateAiFile((f) => {
      const month = f.month?.month === thisMonth() ? f.month : { month: thisMonth(), costUsd: 0, requests: 0 };
      return { ...f, last: { model, costUsd, at: new Date().toISOString() }, month: { ...month, costUsd: month.costUsd + costUsd, requests: month.requests + 1 } };
    });
  const setRequest = (request: DesignRequest | null, id: string) => applyFromServer([{ id: `op_ai${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, op: "setRequest", requestId: id, request }]);

  app.get("/api/ai", async (c) => c.json(await status()));
  app.put("/api/ai", async (c) => {
    const parsed = AiUpdateSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: "invalid settings" }, 400);
    const { model, consented, key: newKey } = parsed.data;
    if (newKey !== undefined) {
      if (!options.keys.set) return c.json({ error: "Set ANTHROPIC_API_KEY before starting AppShape; keys are saved only in the desktop app." }, 400);
      await options.keys.set(aiModel(model ?? (await readAiFile()).model).provider, newKey);
    }
    if (model !== undefined || consented !== undefined) {
      await updateAiFile((f) => ({ ...f, ...(model !== undefined && { model: aiModel(model).id }), ...(consented !== undefined && { consented }) }));
    }
    return c.json(await status());
  });

  app.get("/api/requests/:id/estimate", async (c) => {
    const request = current(c.req.param("id"));
    if (!request) return c.json({ error: "unknown request" }, 404);
    const model = (await status()).model;
    const project = session.snapshot().project;
    const byModel = Object.fromEntries(AI_MODELS.map((m) => [m.id, expectedCost(project, request, m.id)]));
    const body: AiEstimate = { model, costUsd: byModel[model] ?? 0, byModel };
    return c.json(body);
  });

  app.post("/api/requests/:id/design", async (c) => {
    const id = c.req.param("id");
    const request = current(id);
    if (!request) return c.json({ error: "unknown request" }, 404);
    if (running.has(id)) return c.json({ error: "already designing" }, 409);
    const { model } = await status();
    const found = await key(model);
    if (!found) return c.json({ error: `No API key: set ${aiProvider(aiModel(model).provider).keyEnv} (or save a key in the desktop app's settings).` }, 400);
    const { error: _error, proposal: _proposal, alternatives: _alternatives, review, ...rest } = request;
    // a new review replaces the last one; a fix of a finding keeps the review it came from
    const keep = request.intent !== "review" && review ? { review } : {};
    if (!setRequest({ ...rest, ...keep, route: "ai", status: "designing", updatedAt: new Date().toISOString() }, id)) return c.json({ error: "could not start" }, 409);

    const controller = new AbortController();
    running.set(id, controller);
    const step = log.step("agent", `Designing the drawing on ${session.snapshot().project.frames.find((f) => f.id === request.frameId)?.name ?? "a screen"}…`);
    void (async () => {
      try {
        const project = session.snapshot().project;
        const sent = current(id)!;
        // the pictures: the screen as it is and with the drawing (without a browser, the drawing in words only)
        const images = await (async () => designPictures({ project, request: sent, appRoot: location.appRoot, dataDir: location.dataDir, browser: await (browser ??= launchBrowser()) }))().catch(() => ({}));
        if (sent.intent === "review") {
          const reviewed = await reviewRequest({ project, request: sent, provider: provider(model, found.key), images, signal: controller.signal });
          const now = current(id);
          if (!now || now.status !== "designing" || now.route !== "ai") return step.done("The screen changed meanwhile: the review was dropped.");
          await countSpending(reviewed.review.by, reviewed.costUsd);
          setRequest({ ...now, status: "proposed", review: reviewed.review, updatedAt: new Date().toISOString() }, id);
          const n = reviewed.review.findings.length;
          return step.done(n ? `Reviewed: ${n} thing${n === 1 ? "" : "s"} to improve ($${reviewed.costUsd.toFixed(2)})` : `Reviewed: nothing important to improve ($${reviewed.costUsd.toFixed(2)})`);
        }
        const result = await designRequest({ project, request: sent, provider: provider(model, found.key), images, signal: controller.signal });
        const now = current(id);
        // deleted or taken back meanwhile: the result is dropped
        if (!now || now.status !== "designing" || now.route !== "ai") return step.done("The drawing changed meanwhile: the design was dropped.");
        await countSpending(result.proposal.by, result.costUsd);
        const latest = current(id);
        if (latest?.status === "designing") setRequest({ ...latest, status: "proposed", proposal: result.proposal, ...(result.alternatives.length && { alternatives: result.alternatives }), updatedAt: new Date().toISOString() }, id);
        const count = result.alternatives.length + 1;
        step.done(count > 1 ? `Designed ${count} variants to compare ($${result.costUsd.toFixed(2)})` : `Designed: ${result.proposal.summary.length} change${result.proposal.summary.length === 1 ? "" : "s"} to review ($${result.costUsd.toFixed(2)})`);
      } catch (error) {
        const failure = error instanceof AiError ? error : new AiError((error as Error).message, "api");
        const now = current(id);
        if (now && now.status === "designing") {
          const { proposal: _p, alternatives: _a, ...back } = now;
          setRequest({ ...back, status: "draft", ...(failure.kind !== "cancelled" && { error: failure.message }), updatedAt: new Date().toISOString() }, id);
        }
        if (failure.kind === "cancelled") step.done("Designing cancelled");
        else step.fail("Couldn't design the drawing", failure.message);
      } finally {
        running.delete(id);
      }
    })();
    return c.json({ started: true, model });
  });

  app.post("/api/requests/:id/cancel", async (c) => {
    const id = c.req.param("id");
    running.get(id)?.abort();
    const now = current(id);
    if (now?.status === "designing" && now.route === "ai") setRequest({ ...now, status: "draft", updatedAt: new Date().toISOString() }, id);
    return c.body(null, 204);
  });

  return {
    async close() {
      for (const controller of running.values()) controller.abort();
      if (browser) await browser.then((b) => b.close()).catch(() => {});
    },
  };
}
