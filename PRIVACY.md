# Privacy

What the claude-usage-mod mod for Claude Code does with data. Last changed on 3 October 2026 (added the plan usage request).

## One network request, and it is optional

The mod sends no analytics and runs no server. Its single network request asks Anthropic's plan usage API (`https://api.anthropic.com/api/oauth/usage`, the call Claude Code's own `/usage` makes) for your plan's limit windows, so it can show the Fable and extra-usage limits. It runs when a session starts and again every few minutes.

- The request has no body and no query. It carries your sign-in only through Claude Code's credential handle: the engine attaches the credential and only to a first-party host, so **the mod never sees your token**.
- What comes back is percentages and reset times for each window, the extra-usage dollars and cap, and the count and deadlines of your rate limit resets. They are held in memory and the plugin store, nothing else.
- Nothing is sent to anyone but Anthropic. Switch the call off with the *Plan limits from Anthropic* setting and the mod makes no network request at all.
- The endpoint is not a documented API; if it changes or refuses, the mod shows only the windows Claude Code reports.

Everything else below stays on your disk.

## What it reads

- **From Claude Code, while a session runs:** the 5-hour and weekly limit readings (percent used and reset time), the context window's fill, and the session's cost.
- **From the plan usage API:** the same kind of reading for every other window of your plan (per-model weekly limits, extra usage). These are the figures Claude Code's own status line has. It also reads the token counts of each completed turn.
- **From your transcripts** (`~/.claude/projects/**/*.jsonl`, by a Node script the mod runs): for each response, its timestamp, the model name, the four token counts, and the tail of the message id and request id. The ids are used only to count a response once.
- **From your environment:** the `HOME` variable, to find `~/.claude`.

The script parses the transcript lines that carry usage numbers, so the text of your prompts and Claude's replies passes through its memory while it runs. It keeps none of it: nothing but the fields above is read out of a record, and a test checks that prompt text, project paths and transcript file names never reach the files below.

## What it keeps

All on your disk, under your user account:

| Where | What |
| --- | --- |
| `~/.claude/claude-usage-mod/usage.json` | Spend for today, yesterday and 30 days, a 14-day trend, and the names of any models it has no price for |
| `~/.claude/claude-usage-mod/usage-state.json` | Per-day totals, how far into each transcript it has read (keyed by a hash of the file's path, not the path), and the partial ids used to count a response once |
| `~/.claude/claude-usage-mod/plan-usage.json` | Only if you run `/usage-mod debug`: the plan usage API's last reply as received, for bug reports. It holds usage figures, not transcripts; delete it when done |
| `~/.claude/claude-usage-mod/usage.lock` | A lock that lasts only while the script runs |
| Claude Code's plugin store | The last limit readings the engine reported, and this session's token totals with the session id |

Nothing here includes a prompt, a reply, a tool call, a file's contents or a project path. Model names are kept, so a custom model name you use would appear in `usage.json`.

## What it runs

The only program it starts is `node scripts/aggregate-usage.mjs` from the plugin's own folder, with fixed arguments and no shell.

## Deleting it

Uninstall the plugin (`claude plugin uninstall usage-mod@claude-usage-mod`) and delete `~/.claude/claude-usage-mod`. The plugin store entry goes with the plugin.
