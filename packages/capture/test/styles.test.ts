import { describe, expect, it } from "vitest";
import { darkModeOf, processAppCss, schemeQueries } from "../src/styles";

const options = { frameClass: "aps-frame", container: "aps-frame" };

describe("app CSS for the board", () => {
  it("turns prefers-color-scheme into style queries on the board's scheme", () => {
    const css = [
      "@media (prefers-color-scheme: dark) { :root { --bg: #000 } }",
      ".dark\\:bg-x { @media (prefers-color-scheme: dark) { background: red } }",
      "@media screen and (prefers-color-scheme: light) { body { color: #111 } }",
    ].join("\n");
    const out = processAppCss([{ text: css }], "http://localhost:3000/", options).shadow;
    expect(out).toContain("@container style(--aps-scheme: dark) {:host {");
    expect(out).toContain("@container style(--aps-scheme: dark) { background: red }");
    expect(out).toContain("@container style(--aps-scheme: light) {.aps-frame > * {");
    expect(out).not.toContain("prefers-color-scheme");
    expect(schemeQueries(out)).toBe(out);
  });

  it("tells media-based from class-based dark mode", () => {
    expect(darkModeOf("@container style(--aps-scheme: dark) { .dark\\:bg-x { color: red } }")).toBe("media");
    expect(darkModeOf(".dark\\:bg-x:where(.dark, .dark *) { color: red }")).toBe("class");
    expect(darkModeOf(".dark .dark\\:bg-x { color: red }")).toBe("class");
    expect(darkModeOf(".bg-x { color: red }")).toBeUndefined();
  });
});
