# M0 validation: can agents implement AppShape specs?

Milestone M0 asks one question: **is the change format good enough for coding agents to implement
correctly?** This package holds a realistic test case and the tooling to score agent runs.

The test case was written by hand in M0, before the editor and the importer existed. It is still the
benchmark: the specs come from the same spec renderer the MCP server and `appshape spec` use today, so
`pnpm m0:generate` keeps them current (regenerated 2026-10-08 after M1–M7: unchanged).

| What | Where |
|---|---|
| Test app (Vite + React Router 7 + Tailwind v4) | [`fixtures/vite-react-router-tw4`](../../fixtures/vite-react-router-tw4) |
| Hand-written IR of `/pricing` (the kind of IR *Import pages* now produces from the running app) | [`src/pricing.ts`](src/pricing.ts) → [`generated/frames/f_pricing.json`](generated/frames/f_pricing.json) |
| Changesets (ops) | [`src/cs_001.ts`](src/cs_001.ts), [`src/cs_002.ts`](src/cs_002.ts) → [`generated/changesets/`](generated/changesets) |
| **Agent specs** (what agents read) | [`specs/cs_001.md`](specs/cs_001.md), [`specs/cs_002.md`](specs/cs_002.md) (+ `.json`) |
| Format tests (schemas, apply/diff/squash, spec ↔ ops) | [`test/format.test.ts`](test/format.test.ts) |
| Acceptance checks (server-render the app, inspect the DOM) | [`checks/`](checks) |
| Scored agent runs (sandbox, agent, checks, report) | [`scripts/run-agent.ts`](scripts/run-agent.ts) → `runs/` (gitignored) |

The two changesets:

- **cs_001 "Pricing refresh"**: 8 changes to an existing page. They cover a component-scoped
  restyle, an instance-scoped restyle and insert (the agent has to make it data-driven), a text
  change, inserting a section with an existing `Accordion`, a delete, a component-scoped move and a
  responsive relayout (`lg:`).
- **cs_002 "Contact page"**: a new page designed from scratch, with a form behavior annotation, plus
  a navigation link inserted into a shared component.

## Commands

```sh
pnpm m0:generate         # rebuild generated/ and specs/ from src/
pnpm m0:check            # acceptance checks for both changesets against the fixture
pnpm m0:check cs_001     # only one changeset
pnpm --filter @appshape/m0-validation test   # format tests
pnpm m0:run cs_001 --model sonnet            # one scored agent run (see below)
pnpm m0:run cs_001 --agent none              # control run: scores the unchanged app
```

On the unchanged fixture, `m0:check` fails 13 of 14 checks. Only the "scope" guard passes, which
is expected. A reference solution (not committed, so agents can't see it) passes 14 of 14.

## Running an agent

### Automated (recommended)

```sh
pnpm m0:run cs_001 --agent claude --model opus     # Claude Code, headless
pnpm m0:run cs_002 --agent claude --model sonnet
pnpm m0:run cs_001 --agent codex                   # Codex CLI (codex exec --full-auto)
```

Each run:

1. Copies the repository (the working tree, so uncommitted changes count) to a sandbox outside it
   (`%TEMP%/appshape-m0/<run id>`, with its own git baseline commit). Everything in
   `examples/m0-validation` except the specs is left out, so the agent can't read the checks, the
   changeset sources or this README.
2. Installs the app's dependencies with `pnpm install --offline` (falls back to your `.npmrc`).
3. Starts the agent in the sandbox root with the prompt below. Claude Code runs with edits
   accepted, only `pnpm` commands allowed, no web access and no MCP servers. The default timeout is
   45 minutes (`--timeout <minutes>`).
4. Scores the sandbox from here: the acceptance checks (`APPSHAPE_FIXTURE_DIR` points them at the
   sandbox), the app's typecheck, the diff, and files edited outside `src`.

Results land in `runs/<run id>/`: `summary.md` (the scores), `agent-report.md` (the agent's
change-status table), `diff.patch`, `checks.json`, `typecheck.txt`, `prompt.txt`. The sandbox stays
for the manual rubric: run `pnpm --filter @appshape-fixtures/vite-react-router-tw4 dev` in it and try
the page.

### By hand

Use the same baseline for every agent: a commit, or a copy of the working tree. In a copy that
has no `.npmrc` (it is gitignored), install offline from the pnpm store, or copy the `.npmrc` in:

```sh
git worktree add ../aps-m0-<agent>-cs_001 -b m0/<agent>-cs_001 <baseline commit>
cd ../aps-m0-<agent>-cs_001
pnpm install --offline
```

Remove `examples/m0-validation` from the worktree except `specs/`, `package.json` and
`tsconfig.json`, so the agent can't read the checks. Start the agent in the worktree root and give it
this prompt (swap in `cs_002` for the second run):

```text
You are implementing a design changeset exported by AppShape, a design tool.
Read the spec in examples/m0-validation/specs/cs_001.md and implement it in the app at
fixtures/vite-react-router-tw4.

Rules for this test run:
- Only edit files inside fixtures/vite-react-router-tw4/src.
- Do not read anything in examples/m0-validation except the spec file.
- AppShape's MCP tools and CLI are not available. Instead of set_change_status, finish with a
  table: change id | status (applied/failed/skipped) | note. Skip the verify step.
- When you are done, run: pnpm --filter @appshape-fixtures/vite-react-router-tw4 typecheck
```

The run deliberately leaves out AppShape's MCP tools and verify: M0 tests the format itself. The
full loop (MCP, `set_change_status`, `verify_changeset`) is covered by the end-to-end tests.

Then score the worktree from this repository:

```sh
APPSHAPE_FIXTURE_DIR=../aps-m0-<agent>-cs_001/fixtures/vite-react-router-tw4 pnpm m0:check cs_001
cd ../aps-m0-<agent>-cs_001
pnpm --filter @appshape-fixtures/vite-react-router-tw4 typecheck
git diff --stat
pnpm --filter @appshape-fixtures/vite-react-router-tw4 dev   # look at it, try the contact form
```

## Scoring

**Automated:** the number of passing change checks (cs_001: 8, cs_002: 5), plus the scope guard.

**Manual rubric** (1 point each):

| # | cs_001 | cs_002 |
|---|---|---|
| R1 | The highlighted plan comes from data (`plans.ts`), not from an index or name check in JSX | Route registered in `App.tsx`, page in `src/pages/Contact.tsx` |
| R2 | FAQ items live in `src/data/faq.ts` | Submit behavior works in the browser (no reload, form cleared, thank-you text) |
| R3 | Reuses `Badge`, `Accordion` and `Button` instead of new markup | Reuses `Button`, uses `NavLink` for the nav entry |
| R4 | No unrelated edits and no arbitrary values (`git diff --stat` only touches expected files) | Same |
| R5 | The agent's change-status table matches reality | Same |

**Classify every miss** so it feeds back into the format:

- **spec**: the spec was unclear or misleading → fix the wording or the renderer
- **format**: information was missing from the IR or spec → change the schema
- **agent**: the spec was clear and the agent still got it wrong → note it, no format change

## Results

M0 is done when at least 2 different agents pass all automated checks for both changesets with a
rubric score of at least 4/5, and every **spec** or **format** miss has been fixed.

| Date | Agent / model | Changeset | Checks | Rubric | Misses (class) | Notes |
|---|---|---|---|---|---|---|
| 2026-10-08 | Claude Code 2.1.80 / Opus | cs_001 | 8/8 + scope | 5/5 | none | 1.6 min, 21 turns, $0.41. `highlighted` flag in `plans.ts`, FAQ in `faq.ts`; report matches the diff |
| 2026-10-08 | Claude Code 2.1.80 / Sonnet | cs_001 | 8/8 + scope | 5/5 | none | 1.9 min, 21 turns, $0.28. `PricingCard.tsx` byte-identical to the Opus run |
| 2026-10-08 | Claude Code 2.1.80 / Opus | cs_002 | 5/5 | 5/5 | none | 0.8 min, 11 turns, $0.23. Uncontrolled form, `form.reset()`; submit checked in the browser |
| 2026-10-08 | Claude Code 2.1.80 / Sonnet | cs_002 | 5/5 | 5/5 | none | 0.8 min, 13 turns, $0.13. Controlled form; submit checked in the browser |
| 2026-10-08 | Codex CLI 0.161.0 / default model | cs_001 | 8/8 + scope | 4/5 | c7 (spec) | 0.8 min. Moved the button and changed its `mt-8` to `mt-6`: the move didn't say the classes stay. Fixed in the spec renderer |
| 2026-10-08 | Codex CLI 0.161.0 / default model | cs_002 | 5/5 | 5/5 | none | 0.6 min. Uncontrolled form, `role="status"` on the thank-you text; submit checked in the browser |
| 2026-10-08 | Codex CLI 0.161.0 / default model | cs_001 (rerun, fixed spec) | 8/8 + scope | 5/5 | none | 0.6 min. Keeps `mt-8` on the moved button |

**Status: M0 is done (2026-10-08).** Two different agents (Claude Code with Opus and Sonnet, and
Codex) pass every automated check on both changesets with a rubric of at least 4/5, and the one spec
miss is fixed: move changes now say "Classes: unchanged. Only the position changes; keep the
element's classes and spacing as they are." (`packages/protocol/src/markdown.ts`).

Observation, not scored: the contact form's thank-you message is a behavior note without a design,
so its look is up to the agent (Claude styled it, Codex left it plain). States that only exist after
an interaction (confirmations, errors, empty states) could get their own designed frames or variants.

What the runs say about the test itself: the specs include the target code for most changes, so
all agents produced nearly the same diff. The format is clear enough; the benchmark no longer
separates good from weak runs. Harder cases are worth adding: a changeset made in the editor
instead of by hand, an imported real app, and changes without target code (layout only).
