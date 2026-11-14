import { renderSpecMarkdown, type SpecDocument } from "@appshape/protocol";
import { serializeProject } from "@appshape/store";
import * as cs001 from "./cs_001";
import * as cs002 from "./cs_002";
import { buildDemoProject } from "./demo";
import { components, pricingFrame, tokens } from "./pricing";

/** Where the generated demo project goes (a `.appshape` directory), relative to this package. */
export const DEMO_PROJECT = "generated/demo-project";

export function buildModel() {
  const pricing = pricingFrame();
  const changesets = [cs001.changeset, cs002.changeset];
  const specs: SpecDocument[] = [cs001.spec(pricing), cs002.spec(pricing)];
  return { pricing, changesets, specs, tokens, components };
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** Files written by `pnpm m0:generate`, keyed by path relative to this package. */
export function buildArtifacts(): Map<string, string> {
  const { pricing, changesets, specs } = buildModel();
  const files = new Map<string, string>();
  files.set("generated/frames/f_pricing.json", json(pricing));
  files.set("generated/tokens.json", json(tokens));
  files.set("generated/components.json", json(components));
  for (const cs of changesets) files.set(`generated/changesets/${cs.id}.json`, json(cs));
  for (const doc of specs) {
    files.set(`specs/${doc.changeset.id}.json`, json(doc));
    files.set(`specs/${doc.changeset.id}.md`, renderSpecMarkdown(doc));
  }
  // The demo project as generated, for tests (the copy in the fixture is yours to change).
  for (const [path, content] of serializeProject(buildDemoProject())) files.set(`${DEMO_PROJECT}/${path}`, content);
  return files;
}
