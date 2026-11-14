import { describe, expect, it } from "vitest";
import {
  type Changeset,
  ChangesetSchema,
  DesignNodeSchema,
  FrameSchema,
  isTokenRef,
  OpSchema,
  parseTokenRef,
  resolveToken,
  transition,
  TransitionError,
} from "../src";
import { box, frame, text } from "./helpers";

describe("tokens", () => {
  it("parses token references", () => {
    expect(parseTokenRef("$color.primary-600")).toEqual({ group: "color", name: "primary-600" });
    expect(parseTokenRef("$spacing.1.5")).toEqual({ group: "spacing", name: "1.5" });
    expect(isTokenRef("$colour.red")).toBe(false);
    expect(resolveToken({ source: "tailwind-v4", groups: { radius: { xl: "0.75rem" } } }, "$radius.xl")).toBe("0.75rem");
  });
});

describe("schemas", () => {
  it("accepts a mobile frame with an instance", () => {
    const parsed = FrameSchema.safeParse({
      ...frame(
        "settings",
        box("screen", [
          {
            id: "row",
            type: "instance",
            origin: "added",
            componentId: "cmp_list_row",
            props: { title: "Notifications", toggle: true },
            children: [],
          },
          { id: "save", type: "button", origin: "added", children: [text("save_label", "Save", { origin: "added" })] },
        ]),
        "new",
      ),
      platform: "mobile",
      target: { adapter: "expo", route: "/settings", file: "app/(tabs)/settings.tsx" },
      viewports: [{ id: "iphone-15", width: 393, height: 852, device: "iphone-15" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects duplicate ids and missing baselines", () => {
    const dup = frame("f", box("r", [box("x"), box("x")]));
    expect(FrameSchema.safeParse(dup).success).toBe(false);
    const { baseline: _, ...noBaseline } = frame("f", box("r"));
    expect(FrameSchema.safeParse(noBaseline).success).toBe(false);
  });

  it("rejects unknown fields (strict objects)", () => {
    expect(DesignNodeSchema.safeParse({ ...box("r"), colour: "red" }).success).toBe(false);
    expect(
      OpSchema.safeParse({ id: "o", frameId: "f", op: "restyle", nodeId: "n", style: { colour: "red" } }).success,
    ).toBe(false);
  });
});

describe("changesets", () => {
  const draft: Changeset = {
    id: "cs_1",
    title: "Pricing refresh",
    status: "draft",
    ops: [{ id: "o1", frameId: "f", op: "retext", nodeId: "t", text: "Hi" }],
    history: [{ status: "draft", at: "2026-10-05T10:00:00.000Z", by: "user" }],
    createdAt: "2026-10-05T10:00:00.000Z",
    updatedAt: "2026-10-05T10:00:00.000Z",
  };

  it("requires numbered changes once ready", () => {
    const ready = transition(draft, "ready", "user", { at: "2026-10-05T11:00:00.000Z" });
    expect(ChangesetSchema.safeParse(ready).success).toBe(false);
    expect(ChangesetSchema.safeParse({ ...ready, changes: [{ id: "c1", opIds: ["o1"] }] }).success).toBe(true);
  });

  it("enforces the lifecycle", () => {
    expect(() => transition(draft, "verified", "agent")).toThrow(TransitionError);
    const next = transition(transition(draft, "ready", "user"), "in_progress", "agent");
    expect(next.history.map((h) => h.status)).toEqual(["draft", "ready", "in_progress"]);
  });
});
