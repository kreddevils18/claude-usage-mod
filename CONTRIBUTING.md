# Contributing

Thanks for helping. `usage-mod` (repo `claude-usage-mod`) is a small [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview): a plugin whose hooks draw your usage as colored chips above the prompt and in a Details pane. Bug reports, pricing updates and fixes are all welcome.

## Ways to contribute

| You want to... | Start here |
| --- | --- |
| Fix a wrong price or add a new model | Edit `config/pricing.json` (see [Update pricing](#update-pricing)). The smallest and most useful PR. |
| Report a bug | Open an issue with the [details below](#report-a-bug). |
| Fix a bug or add a feature | Open an issue first for anything larger than a small fix, so we agree on scope before you write code. |
| Change how it looks | Read [Look and feel](#look-and-feel) first. |
| Improve the docs | README, this file and `PRIVACY.md` are plain Markdown; PRs welcome. |

Out of scope: other providers than Claude, and anything that sends your data anywhere. See [Ground rules](#ground-rules).

## Set up

You need Claude Code **2.1.287 or later** (`claude --version`; mods need that version) and Node.js for the aggregation script and its tests. The script uses only Node's built-ins and was developed on Node 25.

```sh
git clone https://github.com/kreddevils18/claude-usage-mod
cd claude-usage-mod
claude --plugin-dir .
```

`--plugin-dir` loads the mod for that session only, and an interactive session watches the folder: saving a file reloads the hooks module. Run with `claude --debug` while developing; a hook that fails is skipped and the reason goes to the debug log, and a tree the engine refuses to draw is logged as `ui.render (...): a hook returned a tree that does not validate`.

For editor types, run `/plugin-types` in a session. It writes the engine's type declarations under `.claude/types` (git-ignored here).

### Layout

```text
.claude-plugin/    plugin.json (name, version, settings) and marketplace.json
hooks/
  register.tsx       every hook and everything that touches `$`; hooks.json points here
  band-model.ts      what the band shows, tooltips included, and which tier fits a width
  pane-model.ts      what the Details pane shows
  limits.ts          rate-limit windows: naming, ordering, merging three sources
  plan-usage.ts      parses the plan usage API's JSON into limit windows
  spend-cache.ts     reads the spend summary the script writes
  svg-band.ts, svg-pane.ts, svg-kit.ts, svg-icons.ts   the desktop drawing (SVG)
  terminal-band.tsx, terminal-pane.tsx                 the terminal drawing (Text)
  theme.ts           the colors
  format.ts, summary-text.ts   formatting and the /usage-mod text view
scripts/           aggregate-usage.mjs: scans transcripts into a small summary
config/            pricing.json: $ per million tokens, per model
tests/             usage-mod.test.ts (claude plugin test) and aggregate-usage.test.mjs (node --test)
types/             index.d.ts: the mod's $.state contract
assets/            the README's preview images
```

**Why `$` stays in `register.tsx`:** the engine follows `$` only inside the file that registers the hooks, never across an import. So every helper that calls `$.something` lives there, and everything else is a pure function you can test without an engine.

**How the two halves fit:** the Node script is the only thing that reads `~/.claude/projects/**/*.jsonl`, and it writes `~/.claude/claude-usage-mod/usage.json`. The mod reads that small file with `$.fs`. It reads limits and session cost live from `$.session.usage()`, and the Fable and extra-usage limits from the plan usage API. Why a script: `$.fs.read` caps at 4 MiB with no ranged reads.

## Check your work

Run these before opening a pull request:

```sh
claude plugin validate .claude-plugin/plugin.json
claude plugin test .
node --test tests/aggregate-usage.test.mjs
```

`claude plugin validate` reads the manifest and the module source the way the engine will, and lists the events the mod hooks and the calls it makes. `claude plugin test` runs `tests/usage-mod.test.ts` against the engine itself. A change to what is drawn must be covered on both the `terminal` and `desktop` surfaces and at a few widths (see the width tests for the pattern).

CI runs the script's tests and checks the JSON files on every push. It does not run the two `claude` commands, so they are yours to run.

## Look and feel

- **One color per metric** (see `hooks/theme.ts`): 5h green, 7d purple, a model limit pink-violet, extra usage gray, context cyan, input red, output green, cache blue, cost gold. The chip keeps its color whatever the value.
- **State is the dots, not the chip:** the dots of a bar are green with plenty left, yellow under 35% and red under 15%.
- Chips carry their own ink on an opaque tint, so they read the same on light and dark themes. Check both.
- Every chip needs a tooltip (`tip`) that says what the number is. Keep strings short: they are drawn in narrow terminals, and wide (CJK) characters count double.
- The band shows what you glance at; anything that needs reading goes in the pane. This session's tokens and cost are in the pane, not on the band.

For a UI change, paste a rendering in the PR. `assets/band.svg` and `assets/pane.svg` come from the mod's own SVG builders with sample numbers; regenerate them when you change what they show.

## Update pricing

`config/pricing.json` maps a regular expression on the model id to prices in USD per million tokens. First match wins, so put specific rules above general ones.

1. Take the prices from Anthropic's [pricing page](https://docs.claude.com/en/docs/about-claude/pricing). Do not guess; link the page in the PR.
2. Add or edit one rule: `match`, `input`, `output`, `cacheRead`. Cache writes are priced as multiples of `input` (`cacheWrite5mX` 1.25 and `cacheWrite1hX` 2 by default); override them only when the page says otherwise.
3. Run `node scripts/aggregate-usage.mjs --out-dir /tmp/usage-check` and confirm `unknownModels` in the output is empty for your own history.

## Ground rules

A mod runs code inside Claude Code with the same access Claude Code has, and this one reads your transcripts. Every pull request is read, not just merged. Reviewers check:

- **Only one network request exists:** the plan usage call in `register.tsx` (`$.http.fetch` with the credential handle from `$.session.authorize()`, to `api.anthropic.com`). A change must not add another request, send anything in a body or query, or touch a credential: the mod only passes Claude Code's opaque handle. The *Plan limits* setting must keep switching it off. If you think a new request is needed, open an issue first.
- **The mod keeps only counts and times.** The script keeps token counts, timestamps, model names and partial ids from transcripts. It must not store prompt text, tool output or file paths; a test enforces it, and [PRIVACY.md](PRIVACY.md) must stay true.
- **`$.process` runs the bundled script only,** with a fixed argument list and no shell. No user-supplied strings in argv.
- **No new dependencies.** The script uses Node built-ins; the mod uses the engine's API.
- `claude plugin validate` shows no new `calls:` you did not mention in the PR.
- No secrets, tokens or `.env` files in the diff.

## Code style

- Files are `kebab-case` with descriptive names, and stay under about 200 lines; split by concern when they grow. `register.tsx` is the exception it has to be (see above).
- Match the surrounding code: comment density, naming, idiom. Comments say why, not what.
- Do not put issue numbers, phase numbers or review labels in code comments, test names or commit messages. Say what the code guarantees.
- Pure helpers (formatting, math, models) live apart from the hooks so they test without an engine.

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/): `fix(pricing): correct opus-5-5 cache read`, `feat(band): drop reset times under 70 columns`.
- One logical change per PR. Say what changed, why, and how you checked it.
- Fill in the checks above. A PR that fails `claude plugin validate` or `claude plugin test` will not be reviewed until it passes.
- By contributing you agree your work is released under the [MIT License](LICENSE).

## Report a bug

Include:

- `claude --version` and your OS.
- Where it runs: terminal or the desktop app's Code tab, and the width.
- What you expected and what you saw, with a screenshot.
- The output of `/usage-mod text` and, for a missing Fable or Extra chip, `/usage-mod debug` (it lists field names, no values).
- For a wrong spend figure: the output of `node scripts/aggregate-usage.mjs --out-dir /tmp/usage-check`, with the figure you compared it with. Remove anything private first.
- The line from `claude --debug` if a hook failed (`usage-mod: ...`).

## Release (maintainer)

1. Bump `version` in `.claude-plugin/plugin.json`. Claude Code detects updates by that version, so a change without a bump does not reach users.
2. Update `CHANGELOG.md`.
3. Merge to `main` and tag `vX.Y.Z`.
4. Users update with:

   ```text
   /plugin marketplace update claude-usage-mod
   ```
