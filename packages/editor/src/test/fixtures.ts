import { applyBoardOps, type BoardItem, DEFAULT_REDACTION, IR_VERSION, type Project } from "@appshape/ir";

export { applyBoardOps, type BoardItem };

export function emptyProjectFixture(items: BoardItem[]): Project {
  return {
    irVersion: IR_VERSION,
    name: "Test",
    adapters: [],
    tokens: { source: "manual", groups: {} },
    components: [],
    board: { items },
    frames: [
      {
        id: "f",
        name: "Frame",
        kind: "new",
        platform: "web",
        target: { adapter: "react-vite" },
        viewports: [{ id: "desktop", width: 400 }],
        current: { id: "root", type: "box", origin: "added", children: [] },
      },
    ],
    changesets: [],
    redaction: DEFAULT_REDACTION,
  };
}
