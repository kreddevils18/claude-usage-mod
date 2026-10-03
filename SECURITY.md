# Security

A mod runs code inside Claude Code with your permissions, and this one reads your transcripts, so reports about what it reads, keeps or runs matter.

## Report a problem

Please report it privately through [GitHub's private vulnerability reporting](https://github.com/kreddevils18/claude-usage-mod/security/advisories/new) on this repository, and do not open a public issue. Say what you found, how to reproduce it, and which version (`version` in `.claude-plugin/plugin.json`).

## What counts

- The mod sending anything off your machine other than the one plan usage request described in [PRIVACY.md](PRIVACY.md), or the mod handling your credential instead of passing Claude Code's opaque handle.
- Prompt text, tool output, file contents or project paths reaching the files listed in [PRIVACY.md](PRIVACY.md).
- The mod running anything other than `node scripts/aggregate-usage.mjs`, or running it with input you can influence.
- The script reading or writing outside `~/.claude`.

## What to expect

A reply within a week. A fix is released by bumping `version`, so users get it with `/plugin marketplace update claude-usage-mod`.
