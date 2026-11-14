import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import type { Command } from "@appshape/ir";
import { type ServerMessage, TOKEN_HEADER } from "@appshape/protocol";
import { type DataLocation, emptyProject, ProjectFiles } from "@appshape/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { type RunningServer, startServer } from "../src";

const quiet = { info() {}, warn() {}, error() {} };
let root: string;
let location: DataLocation;
let server: RunningServer;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "appshape-server-"));
  location = { appRoot: root, dataDir: join(root, ".appshape"), mode: "in-repo" };
  await new ProjectFiles(location).save({
    ...emptyProject("Test"),
    board: { items: [{ type: "note", id: "n1", x: 0, y: 0, text: "Hello" }] },
  });
  server = await startServer({ location, saveDelayMs: 20, log: quiet });
});
afterEach(async () => {
  await server.close();
  await rm(root, { recursive: true, force: true });
});

const api = (path: string, init: RequestInit = {}) =>
  fetch(`${server.url}${path}`, { ...init, headers: { [TOKEN_HEADER]: server.token, ...init.headers } });

/** Raw HTTP request, so the Host header can be set (fetch does not allow it). */
function rawGet(path: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: server.port, path, headers: { host, [TOKEN_HEADER]: server.token } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
}

class Client {
  readonly messages: ServerMessage[] = [];
  private constructor(readonly ws: WebSocket) {
    ws.on("message", (data) => this.messages.push(JSON.parse(String(data)) as ServerMessage));
  }
  static open(token = server.token, origin?: string): Promise<Client> {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/api/ws?token=${encodeURIComponent(token)}`, origin ? { origin } : {});
    return new Promise((resolve, reject) => {
      ws.once("open", () => resolve(new Client(ws)));
      ws.once("error", reject);
    });
  }
  send(command: Command, baseRev = 0) {
    this.ws.send(JSON.stringify({ type: "command", command, baseRev }));
  }
  async next(type: ServerMessage["type"], timeout = 3000): Promise<ServerMessage> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const found = this.messages.find((m) => m.type === type);
      if (found) {
        this.messages.splice(this.messages.indexOf(found), 1);
        return found;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`no ${type} message`);
  }
}

describe("HTTP API", () => {
  it("serves the project with a valid token only", async () => {
    expect((await fetch(`${server.url}/api/project`)).status).toBe(401);
    expect((await api("/api/project", { headers: { [TOKEN_HEADER]: "wrong" } })).status).toBe(401);
    const snapshot = await (await api("/api/project")).json();
    expect(snapshot).toMatchObject({ rev: 0, project: { name: "Test" }, location: { mode: "in-repo" } });
  });

  it("rejects foreign Host headers (DNS rebinding)", async () => {
    expect(await rawGet("/api/project", `127.0.0.1:${server.port}`)).toBe(200);
    expect(await rawGet("/api/project", "evil.example:80")).toBe(403);
  });

  it("stores UI state in the cache folder", async () => {
    expect(await (await api("/api/ui-state")).json()).toEqual({});
    const put = await api("/api/ui-state", { method: "PUT", body: JSON.stringify({ camera: { x: 1, y: 2, zoom: 0.5 } }) });
    expect(put.status).toBe(204);
    expect(JSON.parse(await readFile(join(location.dataDir, ".cache", "ui.json"), "utf8"))).toEqual({ camera: { x: 1, y: 2, zoom: 0.5 } });
  });

  it("does not serve files outside the assets folder", async () => {
    expect((await api("/api/assets/..%2Fproject.json")).status).toBe(404);
  });
});

describe("WebSocket", () => {
  it("refuses connections without token or from foreign origins", async () => {
    await expect(Client.open("wrong")).rejects.toThrow();
    await expect(Client.open(server.token, "https://evil.example")).rejects.toThrow();
  });

  it("applies commands, acknowledges them, persists and informs other tabs", async () => {
    const a = await Client.open();
    const b = await Client.open();
    a.send({ id: "c1", ops: [{ id: "o1", op: "updateItem", itemId: "n1", patch: { text: "Changed" } }] });
    expect(await a.next("ack")).toEqual({ type: "ack", commandId: "c1", rev: 1 });
    const applied = await b.next("applied");
    expect(applied).toMatchObject({ type: "applied", rev: 1, command: { id: "c1" } });

    await server.session.flush();
    const board = JSON.parse(await readFile(join(location.dataDir, "board.json"), "utf8"));
    expect(board.items[0].text).toBe("Changed");
    a.ws.close();
    b.ws.close();
  });

  it("rejects invalid commands without changing state", async () => {
    const a = await Client.open();
    a.send({ id: "c1", ops: [{ id: "o1", op: "removeItem", itemId: "missing" }] });
    expect(await a.next("reject")).toMatchObject({ commandId: "c1", rev: 0, error: expect.stringContaining("unknown item") });
    a.ws.send("{ nonsense");
    a.ws.send(JSON.stringify({ type: "command", command: { id: "c2", ops: [] }, baseRev: 0 }));
    expect(await a.next("reject")).toMatchObject({ commandId: "c2", error: "invalid message" });
    expect(server.session.currentRev).toBe(0);
    a.ws.close();
  });

  it("sends a reset when files change on disk", async () => {
    const a = await Client.open();
    await new Promise((r) => setTimeout(r, 300));
    await writeFile(join(location.dataDir, "board.json"), '{ "items": [] }\n');
    const reset = await a.next("reset", 5000);
    expect(reset).toMatchObject({ type: "reset", snapshot: { rev: 1, project: { board: { items: [] } } } });
    a.ws.close();
  });
});
