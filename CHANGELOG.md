# Changelog

## Unreleased

- Fix: the terminal could show no Fable, Extra or Usage resets while the desktop app showed them. Each session asked the plan usage API for itself, at start and every few minutes, and with several sessions open the API answered 429 (too many requests); a session refused that way had nothing to draw. Every session now shares the last good reply through `~/.claude/claude-usage-mod/plan-cache.json`: a reply another session got within the refresh interval is used without asking, a refused request falls back to the shared reply (drawn pale once it is two intervals old), and after a 429 no session asks again before its Retry-After time. `/usage-mod debug` says which of these happened.
- The plan usage API is asked far less often, so the account stays clear of its rate limit:
  - every 15 minutes instead of every 5, with its own *Plan limits refresh minutes* setting (5 at the least). The 5h and 7d windows still come from Claude Code with every response, at no request;
  - sessions opened together ask once: a session about to ask says so in the shared file, and the others wait for its reply for up to 30 seconds;
  - a failure that is not a 429 makes every session wait a minute before asking again;
  - a session with no turn since its last request waits until the shared reply is 30 minutes old;
  - in one session, a second caller (the refresh and debug commands, the timer) waits for the request in flight instead of sending another.

## 0.1.2

- The plan usage request now names Claude Code as its client (`claude-cli/<engine version> (external, cli)`). Anthropic grants rate limit resets by client, and answered a request it did not recognise with `eligible: false`, so the Usage resets row could never show the real count.
- The Usage resets row no longer reads "0 available" when the API says the account is not eligible; it is left out rather than claim a count it does not know.

## 0.1.1

- Fix: the Usage resets row never appeared. The plan usage API returns the rate limit reset grants only when the request asks for them, so the request now does.

## 0.1.0

First release.

- Band above the prompt: 5-hour and weekly limits (% left, reset time), per-model weekly limits such as Fable, the extra-usage limit, the context window and today's spend. Pac-Man progress bars; SVG pills with tooltips on the desktop app, colored text chips in the terminal.
- The band fits its width: it fills up to two lines, then drops today's spend, reset times, the context chip and the bars (slim pills) before it drops any limit.
- Details pane (`/usage-mod` or the Details button): limits, this session's tokens and cost, spend for today, yesterday and 30 days, and a 14-day chart.
- `/usage-mod text`, `/usage-mod refresh` and `/usage-mod debug`.
- Fable (and other model) limits, extra usage in dollars over its monthly cap, and usage resets, from Anthropic's plan usage API asked through Claude Code's credential handle; it also fills 5h and 7d before a session's first response. The pane always has Fable and Extra rows, marked No data when not reported. Switch off with a setting.
- Spend history from your transcripts, read incrementally and priced from `config/pricing.json`.
- The last limit readings and the session's token totals survive a resume, so a fresh session is not blank.
- Updates are smooth: a value is written, and the band redrawn, only when it changed; the band reads only what it shows; countdowns redraw only on a minute where one changes; timers of a module that was reloaded away stop themselves.
- Settings: band on or off, show today's spend, plan limits on or off, desktop tooltips and animation on or off, spend refresh interval.
