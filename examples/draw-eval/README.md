# Draw & describe evaluation

Measures how well AppShape's AI turns a drawn request into a proposal, per model and effort, and
what it costs. Twelve drawn requests on three projects (`src/cases.ts`): crossed-out elements
(two with no message at all), new copy, a new section in an empty spot, one more of a repeated
item, moving a section with an arrow, adding next to an element, a change for phones only,
moving a highlight between cards, and two imported screens.

Each case names the elements it draws on (by name or text: generated screens get new ids on
every run); the harness renders the screen, draws the marks around, over or between them like a
person would, and sends the request exactly as the board does (`designRequest` with the pictures
of `designPictures`). The proposal is scored by:

- **checks**: what a good proposal does ("the badge is gone", "one row of four on desktop", …);
- **outside scope**: elements changed that weren't marked (what a designer would object to);
- **warnings**: where it left the design system (colors that aren't tokens, unknown components);
- cost, time, and whether it needed the repair round.

```sh
pnpm draw:eval -- --dry                                         # free: the fake model, to try the harness
pnpm draw:eval -- --settings opus:medium,sonnet:medium,haiku:medium
pnpm draw:eval -- --settings sonnet:high --cases add-newsletter,features-four
```

Real runs cost money. Every run is added to `runs/spend.json`, and a run stops before a request
could take the total over `--budget` (USD, default 10). The key comes from `ANTHROPIC_API_KEY` or
the repository's `.env` (git-ignored); it is never printed or written. Each run writes
`runs/<time>/report.html` with the pictures sent and the screen after each proposal, side by side.

`pnpm --filter @appshape/draw-eval test` checks the cases without a model: every case finds its
elements, and the screen as it is doesn't pass its checks.
