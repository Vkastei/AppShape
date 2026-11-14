# Security

## Reporting a vulnerability

Please report security problems privately, not in public issues: use GitHub's **Report a
vulnerability** (Security tab → Advisories) on this repository.

Include what you found, how to reproduce it, and the version (shown on AppShape's start page). If
you like, say how you'd want to be credited.

What happens next:

- We confirm we received it within **3 working days**.
- We tell you within **10 working days** whether we can reproduce it and what we plan to do.
- We fix serious problems as fast as we can, usually within 30 days, release the fix, and then
  publish an advisory together with you. Please give us that time before you talk about it publicly.

There is no bug bounty yet. We won't take legal action against anyone who reports in good faith,
stays within their own accounts and data, and doesn't harm others or their data.

## Supported versions

Only the latest release gets security fixes. The desktop app updates itself; with the CLI, install
the latest release.

## In scope

- The desktop app and its installer and updates
- The local server (`appshape dev`), the board in the browser and its session token
- The CLI and the MCP server for coding agents
- Code that AppShape generates into your app

Out of scope: vulnerabilities in your own app's code, in coding agents or model providers, and in
third-party dependencies that are already publicly known (tell us anyway if AppShape is affected in a
way that isn't obvious).
