import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, join } from "node:path";

const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

/** Serves a built app (`dist/`, with the SPA fallback); the server is added to `servers` (close them afterwards). */
export async function serveApp(dir: string, servers: Server[]): Promise<string> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const file = extname(url.pathname) ? join(dir, "dist", url.pathname) : join(dir, "dist", "index.html");
    const content = await readFile(file).catch(() => undefined);
    if (content) res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(content);
    else res.writeHead(404).end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
