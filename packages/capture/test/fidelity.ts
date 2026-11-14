import { type DesignNode, isContainer } from "@appshape/ir";
import type { Browser } from "playwright-core";
import { type BoardInput, openBoardPage } from "../src/board";

/**
 * Renders an imported frame the way the board does and compares every element's box with where it
 * was in the app. Used by tests and `scripts/compare.ts`.
 */

export interface FidelityInput extends BoardInput {
  /** Captured boxes per node id (page coordinates). */
  rects: ReadonlyMap<string, readonly number[]>;
}

export interface FidelityResult {
  total: number;
  matching: number;
  mismatches: Array<{ id: string; expected: number[]; actual: number[] }>;
  screenshot?: Buffer;
}

export async function compareFrame(browser: Browser, input: FidelityInput, options: { screenshot?: boolean; tolerance?: number } = {}): Promise<FidelityResult> {
  const page = await openBoardPage(browser, input);
  try {
    const measured = (await page.evaluate(`(() => {
      const out = {};
      const root = document.getElementById("host").shadowRoot;
      for (const el of root.querySelectorAll("[data-aps]")) {
        const r = el.getBoundingClientRect();
        out[el.getAttribute("data-aps")] = [r.x + scrollX, r.y + scrollY, r.width, r.height];
      }
      return out;
    })()`)) as Record<string, number[]>;
    const tolerance = options.tolerance ?? 2;
    const mismatches: FidelityResult["mismatches"] = [];
    let total = 0;
    const visit = (node: DesignNode) => {
      const expected = input.rects.get(node.id);
      const actual = measured[node.id];
      if (expected && actual && (expected[2]! > 0 || expected[3]! > 0)) {
        total++;
        if (expected.some((v, i) => Math.abs(v - actual[i]!) > tolerance)) {
          mismatches.push({ id: node.id, expected: expected.map((v) => Math.round(v)), actual: actual.map((v) => Math.round(v)) });
        }
      }
      if (isContainer(node)) for (const child of node.children) visit(child);
    };
    visit(input.root);
    const screenshot = options.screenshot ? await page.screenshot({ fullPage: true }) : undefined;
    return { total, matching: total - mismatches.length, mismatches, ...(screenshot && { screenshot }) };
  } finally {
    await page.close();
  }
}
