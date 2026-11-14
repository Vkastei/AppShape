import { applyOps, type Board, DEFAULT_REDACTION, type Frame, IR_VERSION, type Project } from "@appshape/ir";
import { buildModel } from "./artifacts";
import * as cs001 from "./cs_001";
import * as cs002 from "./cs_002";

/**
 * The demo project: the M0 example as a real project, mid-design. Pricing is imported
 * (baseline = captured, current = after cs_001 and the cs_002 nav link), Contact is a new frame,
 * and both changesets are ready for an agent. Generated into `generated/demo-project/`; the
 * fixture's `.appshape/` starts as a copy and is then yours to change.
 */

export const demoBoard: Board = {
  items: [
    { type: "text", id: "b_title", x: -80, y: -300, text: "Acme web: design board", size: 40 },
    { type: "section", id: "b_section_pricing", name: "Pricing refresh", x: -80, y: -160, w: 1950, h: 3300 },
    { type: "frame", id: "b_pricing_desktop", frameId: "f_pricing", x: 0, y: 0, viewportId: "desktop" },
    { type: "frame", id: "b_pricing_mobile", frameId: "f_pricing", x: 1400, y: 0, viewportId: "mobile" },
    { type: "frame", id: "b_contact_desktop", frameId: "f_contact", x: 2000, y: 0, viewportId: "desktop" },
    {
      type: "note",
      id: "b_note_pricing",
      x: -440,
      y: 0,
      w: 300,
      h: 200,
      color: "yellow",
      text: "cs_001 is ready for the agent.\nCheck the Pro highlight on mobile.",
      attachedTo: { frameId: "f_pricing" },
    },
    {
      type: "arrow",
      id: "b_arrow_contact",
      kind: "flow",
      from: { itemId: "b_pricing_desktop" },
      to: { itemId: "b_contact_desktop" },
      label: "Navbar → Contact",
    },
  ],
};

export function buildDemoProject(): Project {
  const { pricing, changesets, tokens, components } = buildModel();
  const frames = applyOps(new Map<string, Frame>([[pricing.id, pricing]]), [...cs001.ops, ...cs002.ops]);
  return {
    irVersion: IR_VERSION,
    name: "Acme web (fixture)",
    adapters: [
      {
        id: "react-vite",
        platform: "web",
        root: ".",
        styleDialect: "tailwind-v4",
        devCommand: "pnpm dev",
        devUrl: "http://localhost:5173",
      },
    ],
    tokens,
    components,
    board: demoBoard,
    frames: [frames.get("f_pricing")!, frames.get("f_contact")!],
    changesets,
    redaction: DEFAULT_REDACTION,
  };
}
