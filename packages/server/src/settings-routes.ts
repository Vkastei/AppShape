import { AGENT_IDS, type AgentId, type SettingsResponse, SettingsUpdateSchema } from "@appshape/protocol";
import type { DataLocation } from "@appshape/store";
import type { Hono } from "hono";
import { AGENTS, agentStatuses, connectAgent, disconnectAgent, mcpCommand } from "./agents";
import type { EventLog } from "./events";
import type { ProjectSession } from "./session";

/** `/api/settings` (project settings) and `/api/agents/<id>` (connect coding agents). */
export function settingsRoutes(app: Hono, session: ProjectSession, location: DataLocation, log: EventLog, publish: (reason: string) => void): void {
  const response = async (): Promise<SettingsResponse> => {
    const project = session.snapshot().project;
    return {
      name: project.name,
      settings: project.settings ?? {},
      redaction: project.redaction,
      location: { mode: location.mode, appRoot: location.appRoot, dataDir: location.dataDir },
      agents: await agentStatuses(location.appRoot),
      mcp: mcpCommand(location.appRoot),
      viewports: [...new Set(project.frames.filter((f) => f.kind !== "component").flatMap((f) => f.viewports.map((v) => v.id)))],
    };
  };

  app.get("/api/settings", async (c) => c.json(await response()));

  app.put("/api/settings", async (c) => {
    const parsed = SettingsUpdateSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
    session.updateProject(parsed.data);
    await session.flush();
    publish("settings saved");
    log.add({ level: "step", source: "server", text: "Settings saved" });
    return c.json(await response());
  });

  const agentOf = (id: string): AgentId | undefined => ((AGENT_IDS as readonly string[]).includes(id) ? (id as AgentId) : undefined);

  app.post("/api/agents/:id", async (c) => {
    const id = agentOf(c.req.param("id"));
    if (!id) return c.json({ error: "unknown agent" }, 404);
    try {
      const written = await connectAgent(id, location.appRoot);
      log.add({ level: "step", source: "agent", text: `Connected ${AGENTS[id].name}`, detail: written.join("\n") });
      return c.json(await response());
    } catch (error) {
      log.error(`Couldn't connect ${AGENTS[id].name}`, "agent", (error as Error).message);
      return c.json({ error: (error as Error).message }, 500);
    }
  });

  app.delete("/api/agents/:id", async (c) => {
    const id = agentOf(c.req.param("id"));
    if (!id) return c.json({ error: "unknown agent" }, 404);
    await disconnectAgent(id, location.appRoot);
    log.add({ level: "step", source: "agent", text: `Disconnected ${AGENTS[id].name}` });
    return c.json(await response());
  });
}
