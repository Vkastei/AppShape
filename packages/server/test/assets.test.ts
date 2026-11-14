import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FontCatalogResponse, type InstalledFontsResponse, TOKEN_HEADER, type UploadedAsset } from "@appshape/protocol";
import { type DataLocation, emptyProject, ProjectFiles } from "@appshape/store";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type RunningServer, startServer } from "../src";

const quiet = { info() {}, warn() {}, error() {} };
let root: string;
let location: DataLocation;
let server: RunningServer;

/** Stands in for Google Fonts' metadata and the fontsource CDN. */
let cdn: Server;
let cdnRequests: string[] = [];
const WOFF2 = Buffer.from("wOF2-fake-font");
beforeAll(async () => {
  cdn = createServer((req, res) => {
    cdnRequests.push(req.url!);
    if (req.url === "/metadata/fonts") {
      res.end(`)]}'\n${JSON.stringify({ familyMetadataList: [
        { family: "Lato", category: "Sans Serif", fonts: { "400": {}, "700": {}, "400i": {} }, axes: [], popularity: 9 },
        { family: "Fraunces", category: "Serif", fonts: { "400": {}, "700": {} }, axes: [{ tag: "wght", min: 100, max: 900 }], popularity: 80 },
      ] })}`);
    } else if (req.url === "/npm/@fontsource-variable/fraunces@latest/index.css") {
      res.end(`/* fraunces-latin-wght-normal */
@font-face {
  font-family: 'Fraunces Variable';
  font-style: normal;
  font-weight: 100 900;
  src: url(./files/fraunces-latin-wght-normal.woff2) format('woff2-variations');
  unicode-range: U+0000-00FF;
}`);
    } else if (req.url?.startsWith("/npm/@fontsource-variable/fraunces@latest/files/")) {
      res.end(WOFF2);
    } else if (req.url === "/npm/@fontsource/lato/latin-700.css" || req.url === "/npm/@fontsource/lato/latin-400.css") {
      const weight = req.url.includes("700") ? 700 : 400;
      res.end(`@font-face {
  font-family: 'Lato';
  font-weight: ${weight};
  src: url(./files/lato-latin-${weight}-normal.woff2) format('woff2'), url(./files/lato-latin-${weight}-normal.woff) format('woff');
}`);
    } else if (req.url?.startsWith("/npm/@fontsource/lato/files/")) {
      res.end(WOFF2);
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((resolve) => cdn.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(cdn.address() as AddressInfo).port}`;
  process.env.APPSHAPE_FONT_CATALOG = `${base}/metadata/fonts`;
  process.env.APPSHAPE_FONT_CDN = `${base}/npm`;
  process.env.APPSHAPE_HOME = await mkdtemp(join(tmpdir(), "appshape-home-"));
});
afterAll(async () => {
  await new Promise((resolve) => cdn.close(resolve));
  await rm(process.env.APPSHAPE_HOME!, { recursive: true, force: true });
});

beforeEach(async () => {
  cdnRequests = [];
  root = await mkdtemp(join(tmpdir(), "appshape-assets-"));
  location = { appRoot: root, dataDir: join(root, ".appshape"), mode: "in-repo" };
  await new ProjectFiles(location).save(emptyProject("Test"));
  server = await startServer({ location, saveDelayMs: 20, log: quiet });
});
afterEach(async () => {
  await server.close();
  await rm(root, { recursive: true, force: true });
});

const api = (path: string, init: RequestInit = {}) =>
  fetch(`${server.url}${path}`, { ...init, headers: { [TOKEN_HEADER]: server.token, ...init.headers } });

describe("uploads", () => {
  it("stores an image once under a readable, content-based name and serves it as an image only", async () => {
    const body = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const first = (await (await api("/api/assets?name=My%20Hero%20Photo.PNG", { method: "POST", body })).json()) as UploadedAsset;
    expect(first.src).toMatch(/^asset:uploads\/my-hero-photo-[0-9a-f]{10}\.png$/);
    const again = (await (await api("/api/assets?name=My%20Hero%20Photo.PNG", { method: "POST", body })).json()) as UploadedAsset;
    expect(again.src).toBe(first.src);

    const served = await api(`/api/assets/${first.src.slice("asset:".length)}`);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("content-security-policy")).toContain("sandbox");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(body);
  });

  it("refuses files that aren't images", async () => {
    expect((await api("/api/assets?name=run.html", { method: "POST", body: "<script>" })).status).toBe(415);
    expect((await api("/api/assets?name=empty.png", { method: "POST", body: "" })).status).toBe(400);
  });
});

describe("fonts", () => {
  it("lists Google Fonts by popularity and installs one self-hosted", async () => {
    const catalog = (await (await api("/api/fonts/catalog")).json()) as FontCatalogResponse;
    expect(catalog.complete).toBe(true);
    expect(catalog.fonts.map((f) => [f.family, f.variable, f.weights, f.italic])).toEqual([
      ["Lato", false, [400, 700], true],
      ["Fraunces", true, [400, 700], false],
    ]);

    const response = await api("/api/fonts", { method: "POST", body: JSON.stringify({ family: "fraunces" }) });
    if (!response.ok) throw new Error(await response.text());
    const installed = (await response.json()) as InstalledFontsResponse;
    expect(installed.fonts).toEqual([
      expect.objectContaining({ family: "Fraunces", cssFamily: "Fraunces Variable", slug: "fraunces", variable: true, package: "@fontsource-variable/fraunces", files: ["files/fraunces-latin-wght-normal.woff2"] }),
    ]);
    const dir = join(location.dataDir, "assets", "fonts", "fraunces");
    expect(await readFile(join(dir, "files", "fraunces-latin-wght-normal.woff2"))).toEqual(WOFF2);
    expect(await readFile(join(dir, "font.css"), "utf8")).toContain("src: url(./files/fraunces-latin-wght-normal.woff2) format('woff2-variations');");
    expect(((await (await api("/api/fonts")).json()) as InstalledFontsResponse).fonts.map((f) => f.slug)).toEqual(["fraunces"]);
    // the catalog was cached: no second download
    expect(cdnRequests.filter((u) => u === "/metadata/fonts")).toHaveLength(1);
  });

  it("serves previews of fonts through the board (cached), in the weights a font has", async () => {
    const response = await api("/api/fonts/preview?family=Lato&weights=600,900");
    expect(response.headers.get("content-type")).toContain("text/css");
    const css = await response.text();
    // 600 and 900 don't exist: the nearest weights (700) are used, once
    expect(css.match(/@font-face/g)).toHaveLength(1);
    const url = /url\(([^)]+)\) format\('woff2'\)/.exec(css)![1]!;
    expect(url).toBe(`/api/fonts/preview/lato/lato-latin-700-normal.woff2?token=${encodeURIComponent(server.token)}`);
    expect(css).not.toContain(".woff)");
    const file = await fetch(`${server.url}${url}`);
    expect(file.headers.get("content-type")).toBe("font/woff2");
    expect(Buffer.from(await file.arrayBuffer())).toEqual(WOFF2);
    // second time from the cache
    const before = cdnRequests.length;
    await (await api("/api/fonts/preview?family=Lato&weights=700")).text();
    await (await fetch(`${server.url}${url}`)).arrayBuffer();
    expect(cdnRequests.length).toBe(before);
    expect((await api("/api/fonts/preview?family=Nope")).status).toBe(404);
    expect((await api("/api/fonts/preview/lato/..%2Fx.woff2")).status).toBe(404);
  });

  it("explains failures and leaves nothing half-installed", async () => {
    const missing = await api("/api/fonts", { method: "POST", body: JSON.stringify({ family: "Comic Nope" }) });
    expect(missing.status).toBe(404);
    const broken = await api("/api/fonts", { method: "POST", body: JSON.stringify({ family: "Lato" }) });
    expect(broken.status).toBe(502);
    expect(await broken.text()).toContain("Couldn't download Lato");
    expect(await stat(join(location.dataDir, "assets", "fonts", "lato")).catch(() => undefined)).toBeUndefined();
    expect(await stat(join(location.dataDir, "assets", "fonts", "lato.part")).catch(() => undefined)).toBeUndefined();
  });
});
