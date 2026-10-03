# Changelog

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
