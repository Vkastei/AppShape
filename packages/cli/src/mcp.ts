import { CodeService, generateApp, STACKS } from "@appshape/codegen";
import { defaultTokens } from "@appshape/dialect-tailwind";
import { componentSources, findNode } from "@appshape/ir";
import { MCP_SERVER_NAME, mcpTools } from "@appshape/protocol";
import type { DataLocation } from "@appshape/store";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { launchBrowser, markupImage, VerifyService } from "@appshape/capture";
import { formatVerification, listChangesets, loadProject, readSpec, setChangesetStatus, setChangeStatus, verifyChangesetAt } from "./agent";
import { isWaiting, listRequests, proposeDesign, readRequest, submitReview } from "./requests";

/**
 * The `appshape` MCP server (stdio): the tools of the M0 contract. `verify_changeset` starts the
 * app's dev server on first use and keeps it running for the next verification. stdout is the
 * protocol; logs go to stderr.
 */
export async function runMcpServer(location: DataLocation): Promise<void> {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: "0.4.0" });
  const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
  const failure = (error: unknown) => ({ content: [{ type: "text" as const, text: (error as Error).message }], isError: true });
  const tool = <T>(handler: (args: T) => Promise<unknown>) => async (args: T) => {
    try {
      return text(await handler(args));
    } catch (error) {
      return failure(error);
    }
  };

  server.registerTool(
    "list_changesets",
    { description: mcpTools.list_changesets.description, inputSchema: mcpTools.list_changesets.input.shape },
    tool(async ({ status }) => ({ changesets: await listChangesets(location, status) })),
  );
  server.registerTool(
    "get_changeset",
    { description: mcpTools.get_changeset.description, inputSchema: mcpTools.get_changeset.input.shape },
    tool(async ({ changesetId, format }) => (format === "json" ? JSON.parse(await readSpec(location, changesetId, "json")) : await readSpec(location, changesetId, "markdown"))),
  );
  server.registerTool(
    "get_frame",
    {
      description: "Get a screen or component as designed: 'jsx' is the code AppShape generates for it (React + Tailwind); 'json' is the design IR.",
      inputSchema: mcpTools.get_frame.input.shape,
    },
    tool(async ({ frameId, format, nodeId }) => {
      const { project } = await loadProject(location);
      // by id, or by the screen's name (agents read names in the spec)
      const frame = project.frames.find((f) => f.id === frameId) ?? project.frames.find((f) => f.name.toLowerCase() === frameId.trim().toLowerCase());
      if (!frame) throw new Error(`Unknown frame ${frameId}. Screens: ${project.frames.map((f) => `${f.name} (${f.id})`).join(", ")}`);
      const summary = { id: frame.id, name: frame.name, kind: frame.kind, platform: frame.platform, target: frame.target };
      if (format === "json") {
        const tree = nodeId ? findNode(frame.current, nodeId)?.node : frame.current;
        if (!tree) throw new Error(`Unknown node ${nodeId}`);
        return { frame: summary, tree };
      }
      const status = await new CodeService(location.appRoot, location.dataDir).status();
      const layout = status.layout ?? { stack: "vite-react-router" as const, srcDir: true, tailwind: 4 as const };
      const generated = generateApp({ project, layout, defaults: await defaultTokens() });
      const file = [...generated.files.values()].find((f) => f.frameId === frameId);
      if (!file) throw new Error(`${frame.name} is not generated as code (${generated.skipped.find((s) => s.frameId === frameId)?.reason ?? frame.kind}); use format 'json'.`);
      const span = nodeId ? file.nodes[nodeId] : undefined;
      return `// ${file.path} (${STACKS[layout.stack].label})\n${span ? file.content.slice(span.start, span.end) : file.content}`;
    }),
  );
  server.registerTool(
    "get_tokens",
    { description: mcpTools.get_tokens.description, inputSchema: mcpTools.get_tokens.input.shape },
    tool(async () => {
      const { project } = await loadProject(location);
      return { styleDialect: project.tokens.source, tokens: project.tokens };
    }),
  );
  server.registerTool(
    "list_components",
    { description: "List the components designed in AppShape (and detected in the app) to reuse instead of writing new markup.", inputSchema: mcpTools.list_components.input.shape },
    tool(async () => {
      const { project } = await loadProject(location);
      const designed = [...componentSources(project.frames).values()].map((s) => ({ id: s.id, name: s.name, kind: "user", platform: "web", props: s.def.props.map((p) => p.name) }));
      return { components: [...designed, ...project.components.map((c) => ({ id: c.id, name: c.name, kind: c.kind, platform: c.platform, source: c.source }))] };
    }),
  );
  server.registerTool(
    "get_component",
    { description: mcpTools.get_component.description, inputSchema: mcpTools.get_component.input.shape },
    tool(async ({ componentId }) => {
      const { project } = await loadProject(location);
      const source = componentSources(project.frames).get(componentId);
      if (source) return { component: { id: source.id, name: source.name, kind: "user", description: source.def.description, props: source.def.props, tree: source.root } };
      const catalog = project.components.find((c) => c.id === componentId);
      if (!catalog) throw new Error(`Unknown component ${componentId}`);
      return { component: catalog };
    }),
  );
  server.registerTool(
    "set_changeset_status",
    { description: mcpTools.set_changeset_status.description, inputSchema: mcpTools.set_changeset_status.input.shape },
    tool(async ({ changesetId, status, note }) => ({ changeset: await setChangesetStatus(location, changesetId, status, note) })),
  );
  server.registerTool(
    "set_change_status",
    { description: mcpTools.set_change_status.description, inputSchema: mcpTools.set_change_status.input.shape },
    tool(async ({ changesetId, changeId, status, note }) => ({ changeset: await setChangeStatus(location, changesetId, changeId, status, note) })),
  );

  let verifier: VerifyService | undefined;
  const closeVerifier = () => void verifier?.close();
  process.once("exit", closeVerifier);
  process.stdin.once("close", closeVerifier);
  server.registerTool(
    "verify_changeset",
    { description: mcpTools.verify_changeset.description, inputSchema: mcpTools.verify_changeset.input.shape },
    tool(async ({ changesetId, changeIds, url }) => {
      verifier ??= new VerifyService(location.appRoot, location.dataDir);
      const result = await verifyChangesetAt(location, verifier, changesetId, {
        ...(url && { url }),
        ...(changeIds?.length && { changeIds }),
        log: (line) => console.error(`[appshape] ${line}`),
      });
      const { project } = await loadProject(location);
      return `${formatVerification(result, project)}\n\n${JSON.stringify(result.report, null, 2)}`;
    }),
  );

  // ---- Draw & describe: design requests
  server.registerTool(
    "list_design_requests",
    { description: mcpTools.list_design_requests.description, inputSchema: mcpTools.list_design_requests.input.shape },
    tool(async ({ waiting }) => ({ requests: (await listRequests(location)).filter((r) => !waiting || isWaiting(r)) })),
  );
  // the picture of the drawing needs a browser: one, started on first use
  let browser: ReturnType<typeof launchBrowser> | undefined;
  process.once("exit", () => void browser?.then((b) => b.close()).catch(() => {}));
  server.registerTool(
    "get_design_request",
    { description: mcpTools.get_design_request.description, inputSchema: mcpTools.get_design_request.input.shape },
    async ({ requestId }) => {
      try {
        const { request, brief } = await readRequest(location, requestId);
        const { project } = await loadProject(location);
        // without a browser the brief goes alone (it has the drawing in words)
        const image = await (async () => markupImage({ project, request, appRoot: location.appRoot, dataDir: location.dataDir, browser: await (browser ??= launchBrowser()) }))().catch(() => undefined);
        return {
          content: [
            { type: "text" as const, text: brief },
            ...(image ? [{ type: "image" as const, data: Buffer.from(image).toString("base64"), mimeType: "image/png" }] : []),
          ],
        };
      } catch (error) {
        return failure(error);
      }
    },
  );
  server.registerTool(
    "submit_review",
    { description: mcpTools.submit_review.description, inputSchema: mcpTools.submit_review.input.shape },
    tool(async ({ requestId, summary, findings }) => {
      const result = await submitReview(location, requestId, { ...(summary && { summary }), findings }, "agent");
      return { ...result, next: "The person sees the findings on the AppShape board and picks which to fix." };
    }),
  );
  server.registerTool(
    "propose_design",
    { description: mcpTools.propose_design.description, inputSchema: mcpTools.propose_design.input.shape },
    tool(async ({ requestId, jsx, variants, notes }) => {
      if (Boolean(jsx) === Boolean(variants)) throw new Error("Send either jsx (one design) or variants (two or three).");
      const result = await proposeDesign(location, requestId, variants ?? jsx!, "agent", notes ?? []);
      return { ...result, next: `The person reviews ${variants ? "the variants" : "the proposal"} on the AppShape board (${variants ? "picks one, then accepts" : "accept"}, try again or discard). Nothing changes in the design before that.` };
    }),
  );
  server.registerPrompt(
    "design_request",
    { description: "Design an AppShape request: read the drawing and the message, change the screen's JSX, propose it for review.", argsSchema: { requestId: z.string() } },
    ({ requestId }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Design the AppShape request ${requestId}. Get it with get_design_request and look at the picture. Change the screen's JSX the way the drawing and the message ask, and nothing else: keep the data-id of every element you keep, use the project's components and design tokens. Then call propose_design with the whole screen (when the request asks for variants: with all of them in \`variants\`; when its job is a review: call submit_review with your findings instead, and change nothing). If AppShape can't read it, fix the JSX and propose again. Finally tell me the proposal is ready to review on the board.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "implement_changeset",
    { description: "Implement an AppShape changeset end to end: read the spec, implement, report.", argsSchema: { changesetId: z.string() } },
    ({ changesetId }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Implement the AppShape changeset ${changesetId}. Get its spec with the appshape get_changeset tool, set it to in_progress, work through every task (report each with set_change_status), then set the changeset to applied. Then call verify_changeset: fix what fails (the details say what the app renders instead) and verify again until it is verified.`,
          },
        },
      ],
    }),
  );

  await server.connect(new StdioServerTransport());
  console.error(`[appshape] MCP server for ${location.dataDir}`);
}
