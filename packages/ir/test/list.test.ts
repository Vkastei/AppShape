import { describe, expect, it } from "vitest";
import { boundKeys, type DesignNode, fillItem } from "../src";

describe("repeated content", () => {
  const template = {
    id: "card",
    type: "box",
    origin: "added",
    children: [
      { id: "icon", type: "icon", origin: "added", icon: "zap", bind: { icon: "icon" } },
      { id: "title", type: "text", origin: "added", text: "Fast", bind: { text: "title" } },
    ],
  } as DesignNode;

  it("fills an item's values into the item design, icons included", () => {
    const filled = fillItem(template, { title: "Safe", icon: "shield-check" }) as Extract<DesignNode, { type: "box" }>;
    expect(filled.children.map((c) => (c.type === "icon" ? c.icon : c.type === "text" ? c.text : ""))).toEqual(["shield-check", "Safe"]);
    expect(boundKeys(template)).toEqual(["icon", "title"]);
  });
});
