# Contributing

Thanks for your interest in AppShape! Issues, discussions and pull requests are all welcome.

## Issues and ideas

- **Bugs:** say what you did, what you expected and what happened, plus your OS, the AppShape version
  (on the start page) and your app's stack (Vite or Next.js, Tailwind v3 or v4). A small app that
  shows the problem helps most.
- **Ideas and feedback:** open a discussion. Feedback on the design format
  ([`packages/ir`](packages/ir/src)) and on what coding agents read
  ([`packages/protocol`](packages/protocol/src), the [agent specs](examples/m0-validation/specs)) is
  especially useful.
- **Security problems:** not in public issues; see [SECURITY.md](SECURITY.md).

## Pull requests

For anything bigger than a small fix, open an issue first so we can agree on the approach.

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm --filter @appshape/e2e e2e   # when you change the board, the server or the CLI (needs Edge or Chrome)
```

- Keep changes focused, and add or update tests with them.
- A feature is done when it works in every layer it touches: the format (`ir`), the board
  (`render`, `editor`), the generated code and import (`codegen`, `dialect-tailwind`), the spec for
  agents (`protocol`), and the check in the running app (`capture`).
- Match the style of the surrounding code: TypeScript, small modules, comments that explain *why*.
- Run `pnpm check:public` before you push: it looks for secrets, private registries and
  `.npmrc` files.

## Contributor License Agreement

Before your first pull request can be merged, you sign a Contributor License Agreement (CLA); a bot
asks you once, in the pull request. You keep the copyright to your contribution. The CLA does two
things:

- Your contribution is published under the license of the package you change:
  [AGPL-3.0](LICENSE) for the app, and MIT for the packages that go into users' projects (`ir`,
  `protocol`, `adapter-sdk`, `dialect-tailwind`, `kit`; see the `LICENSE` file in each).
- You also allow the maintainer to offer it under other licenses, for example a commercial license
  next to the AGPL. This keeps AppShape sustainable; the open-source version stays available under
  its open-source license.
