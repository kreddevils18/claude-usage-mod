## What changed and why

## How I checked it

- [ ] `claude plugin validate .claude-plugin/plugin.json`
- [ ] `claude plugin test .`
- [ ] `node --test tests/aggregate-usage.test.mjs`
- [ ] For a UI change: covered on `terminal` and `desktop`, at a few widths, and a rendering is pasted below
- [ ] For a pricing change: the pricing page is linked below

## Review checklist

- [ ] No new network request, and nothing sent in a body or query; the *Plan limits* setting still switches the one request off
- [ ] Only counts and times are kept from transcripts: no prompt text, tool output or paths
- [ ] `$.process` still runs only the bundled script
- [ ] No new dependencies, secrets or `.env` files
- [ ] `claude plugin validate` shows no new `calls:` that I have not mentioned here
- [ ] `PRIVACY.md` and the README still say what the code does
