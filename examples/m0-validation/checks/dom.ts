import { AppRoutes } from "@fixture/src/App";
import { parseHTML } from "linkedom";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";

/** Server-renders a route of the fixture app and returns a queryable document. */
export function render(path: string): Document {
  const html = renderToString(createElement(MemoryRouter, { initialEntries: [path] }, createElement(AppRoutes)));
  return parseHTML(`<!doctype html><html><body>${html}</body></html>`).document as unknown as Document;
}

export const textOf = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

export function all(root: ParentNode, selector: string): Element[] {
  return [...root.querySelectorAll(selector)];
}

export function byText(root: ParentNode, selector: string, text: string | RegExp): Element[] {
  return all(root, selector).filter((el) => (typeof text === "string" ? textOf(el) === text : text.test(textOf(el))));
}

export function one(root: ParentNode, selector: string, text: string | RegExp): Element {
  const found = byText(root, selector, text);
  if (found.length !== 1) throw new Error(`expected one ${selector} with text ${text}, found ${found.length}`);
  return found[0]!;
}

export const classes = (el: Element) => new Set((el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean));

/** Document order comparison. */
export function before(doc: Document, a: Element, b: Element): boolean {
  const order = all(doc, "*");
  return order.indexOf(a) < order.indexOf(b);
}

export function ancestors(el: Element): Element[] {
  const result: Element[] = [];
  for (let parent = el.parentElement; parent; parent = parent.parentElement) result.push(parent);
  return result;
}

export function commonAncestor(elements: Element[]): Element {
  const [first, ...rest] = elements;
  const candidate = ancestors(first!).find((a) => rest.every((el) => ancestors(el).includes(a)));
  if (!candidate) throw new Error("no common ancestor");
  return candidate;
}

/** The direct child of `container` that contains `el`. */
export function childContaining(container: Element, el: Element): Element {
  const child = [...container.children].find((c) => c === el || c.contains(el));
  if (!child) throw new Error("element is not inside container");
  return child;
}
