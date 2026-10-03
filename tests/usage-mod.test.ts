// Run: claude plugin test .
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderPropsOf, SessionUsage } from 'claude-code'

import { bandTiers, packRows, pickLayout } from '../hooks/band-model'
import { formatDuration, formatTokens, formatUsd, miniBar, pacText, sparkline, untilReset } from '../hooks/format'
import { mergeLimits, resetSignature, severity, toLimits } from '../hooks/limits'
import { parsePlanUsage } from '../hooks/plan-usage'
import { parseSummary } from '../hooks/spend-cache'
import { paneModel } from '../hooks/pane-model'
import { summaryText } from '../hooks/summary-text'
import { bandSvg, bandWidth } from '../hooks/svg-band'
import { paneSvg } from '../hooks/svg-pane'
import { cellWidth } from '../hooks/terminal-band'
import type { SpendSummary } from '../types'

// 3 Oct 2026, 05:00 UTC.
const NOW = Date.parse('2026-10-03T05:00:00Z')

const USAGE: SessionUsage = {
  startedAt: NOW,
  context: { tokens: 126_000, window: 1_000_000, percent: 13 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 5, resetsAt: '2026-10-03T09:14:00Z' },
    { kind: 'seven_day', percentUsed: 65, resetsAt: '2026-10-05T13:00:00Z' },
  ],
  cost: { usd: 1.73 },
}

const SUMMARY: SpendSummary = {
  updatedAt: NOW - 60_000,
  today: { usd: 29.9, tokens: 45_100_000 },
  yesterday: { usd: 694.08, tokens: 1_500_000_000 },
  last30: { usd: 1162.46, tokens: 2_897_392_188 },
  trend: [{ day: '2026-10-03', usd: 29.9 }],
  unknownModels: [],
}

describe('format', () => {
  test('durations are compact and never negative', () => {
    expect(formatDuration(4 * 3_600_000 + 14 * 60_000)).toBe('4h14m')
    expect(formatDuration(2 * 86_400_000 + 8 * 3_600_000)).toBe('2d8h')
    expect(formatDuration(12 * 60_000)).toBe('12m')
    expect(formatDuration(30_000)).toBe('<1m')
    expect(formatDuration(-5)).toBe('now')
    expect(untilReset(undefined, NOW)).toBeUndefined()
    expect(untilReset('not a date', NOW)).toBeUndefined()
  })

  test('money and tokens keep the shape of the menubar app', () => {
    expect(formatUsd(29.9)).toBe('$29.90')
    expect(formatUsd(694.08)).toBe('$694.08')
    expect(formatUsd(1162.46)).toBe('$1.2K')
    expect(formatTokens(900)).toBe('900')
    expect(formatTokens(3000)).toBe('3.0k')
    expect(formatTokens(15_600)).toBe('15.6k')
    expect(formatTokens(954_200)).toBe('954.2k')
    expect(formatTokens(45_100_000)).toBe('45.1M')
    expect(formatTokens(1_500_000_000)).toBe('1.5B')
    expect(formatTokens(450_000_000)).toBe('450M')
  })

  test('the bar fills by percent and stays inside its width', () => {
    expect(miniBar(35)).toBe('▰▰▰▰▱▱▱▱▱▱')
    expect(miniBar(0)).toBe('▱▱▱▱▱▱▱▱▱▱')
    expect(miniBar(140)).toBe('▰▰▰▰▰▰▰▰▰▰')
  })

  test('Pac-Man sits at how much is used and the dots ahead are what is left', () => {
    expect(pacText(80)).toEqual({ before: '  ', pac: 'ᗧ', after: '·······' })
    expect(pacText(100)).toEqual({ before: '', pac: 'ᗧ', after: '·········' })
    expect(pacText(0)).toEqual({ before: '         ', pac: 'ᗧ', after: '' })
    expect(sparkline([0, 5, 10])).toBe('▁▅█')
    expect(sparkline([0, 0])).toBe('▁▁')
  })
})

describe('limits', () => {
  test('turns percent used into percent left, ordered 5h, 7d, model, other', () => {
    const limits = toLimits([
      { kind: 'spend_limit', percentUsed: 10 },
      { kind: 'seven_day_fable', percentUsed: 52, resetsAt: '2026-10-05T13:00:00Z' },
      { kind: 'seven_day', percentUsed: 65 },
      { kind: 'five_hour', percentUsed: 5 },
    ])
    expect(limits.map(l => [l.label, l.group, l.percentLeft])).toEqual([
      ['5h', 'limits', 95],
      ['7d', 'limits', 35],
      ['Fable', 'model', 48],
      ['Spend Limit', 'extra', 90],
    ])
  })

  test('clamps odd readings into 0-100% left', () => {
    const limits = toLimits([
      { kind: 'five_hour', percentUsed: 120 },
      { kind: 'seven_day', percentUsed: -4 },
    ])
    expect(limits.map(l => l.percentLeft)).toEqual([0, 100])
  })

  test('severity turns yellow under 35% and red under 15%', () => {
    expect([100, 35, 34, 15, 14, 0].map(severity)).toEqual(['ok', 'ok', 'warn', 'warn', 'crit', 'crit'])
  })
})

describe('spend summary', () => {
  test('accepts what the script writes and rejects anything else', () => {
    expect(parseSummary(JSON.stringify(SUMMARY))?.today.usd).toBe(29.9)
    expect(parseSummary('not json')).toBeNull()
    expect(parseSummary('{}')).toBeNull()
    expect(parseSummary(JSON.stringify({ ...SUMMARY, today: { usd: 'x', tokens: 1 } }))).toBeNull()
  })

  test('the text view shows each window as percent left with its countdown', () => {
    const text = summaryText({
      limits: toLimits(USAGE.rateLimits),
      context: USAGE.context,
      sessionUsd: 1.73,
      spend: SUMMARY,
      spendStatus: 'ok',
      now: NOW,
    })
    expect(text).toContain('5h      ●  95% left')
    expect(text).toContain('resets in 4h14m')
    expect(text).toContain('7d      ●  35% left')
    expect(text).toContain('Context 87% left')
    expect(text).toContain('Today      $29.90 · 45.1M tokens')
    expect(text).toContain('30 days    $1.2K · 2.9B tokens')
    expect(text).not.toContain('cannot run')
  })
})

// What the engine answers beneath the mod. `process` is the script's outcome: a summary, or null
// for a session where $.process is unavailable.
function engine(
  on: On,
  state: { usage: SessionUsage; process: SpendSummary | null; file: SpendSummary | null; plan?: string | { status: number; text: string }; fetches?: { n: number }; urls?: string[]; written?: string[] },
  store: Record<string, unknown> = {},
) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, store)
  mock.env(on, { HOME: '/home/test' })
  on('session.usage', () => ({ value: state.usage }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.measure', () => ({ changed: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.id', () => ({ value: 'test-session' }))
  // With no `plan` there is no signed-in session, so no plan fetch is made.
  on('session.authorize', () => ({ value: state.plan === undefined ? null : { handle: 'handle-1', kind: 'bearer' as const } }))
  on('http.fetch', (_$, e) => {
    if (state.fetches) state.fetches.n++
    state.urls?.push(e.url)
    const plan = typeof state.plan === 'string' ? { status: 200, text: state.plan } : (state.plan ?? { status: 404, text: '' })
    return { value: { status: plan.status, ok: plan.status >= 200 && plan.status < 300, headers: {}, text: plan.text } }
  })
  on('fs.write', (_$, e) => {
    if (state.written) state.written.push(e.path)
    return { value: undefined }
  })
  on('fs.read', () => {
    if (!state.file) throw new Error('ENOENT')
    return { value: JSON.stringify(state.file) }
  })
  on('process.run', () => {
    if (!state.process) throw new Error('process is unavailable')
    return {
      value: { exitCode: 0, stdout: JSON.stringify(state.process), stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })
  return clock
}

const START = { cwd: '.', surface: 'terminal', isInteractive: true } as const

// session.start returns before the first spend refresh ends; settle lets it finish.
async function start($: Engine, clock: { settle: () => Promise<void> }) {
  await $.session.start(START)
  await clock.settle()
}
const usageText = ($: Engine, args = 'text') =>
  $.command.run({ command: 'usage-mod', args, origin: { kind: 'user' }, presentation: {} } as unknown as Parameters<Engine['command']['run']>[0])

describe('usage-mod', () => {
  test('/usage-mod shows limits from the session and spend from the script', async ($, on) => {
    const clock = engine(on, { usage: USAGE, process: SUMMARY, file: null })
    await start($, clock)

    const { text } = await usageText($)
    expect(text).toContain('95% left')
    expect(text).toContain('35% left')
    expect(text).toContain('Session cost $1.73')
    expect(text).toContain('Yesterday  $694.08 · 1.5B tokens')
  })

  test('a measure from the engine moves the limits', async ($, on) => {
    const clock = engine(on, { usage: USAGE, process: SUMMARY, file: null })
    await start($, clock)

    await $.session.measure({
      context: USAGE.context,
      rateLimits: [{ kind: 'five_hour', percentUsed: 90, resetsAt: '2026-10-03T09:14:00Z' }],
      cost: { usd: 2.5 },
    })
    const { text } = await usageText($)
    expect(text).toContain('○  10% left')
    expect(text).toContain('Session cost $2.50')
  })

  test('without $.process the recent file stays on screen without a warning', async ($, on) => {
    const clock = engine(on, { usage: USAGE, process: null, file: SUMMARY })
    await start($, clock)

    const { text } = await usageText($)
    expect(text).toContain('Today      $29.90')
    expect(text).not.toContain('cannot run')
  })

  test('without $.process an old file is flagged as stale', async ($, on) => {
    const clock = engine(on, { usage: USAGE, process: null, file: { ...SUMMARY, updatedAt: NOW - 3 * 3_600_000 } })
    await start($, clock)

    expect((await usageText($)).text).toContain('cache is 3h00m old')
  })

  test('without $.process and without a file it says how to get data', async ($, on) => {
    const clock = engine(on, { usage: USAGE, process: null, file: null })
    await start($, clock)

    expect((await usageText($)).text).toContain('Run `node scripts/aggregate-usage.mjs`')
  })

  test('limits read "no reading yet" until the first API response', async ($, on) => {
    const clock = engine(on, { usage: { ...USAGE, rateLimits: [] }, process: SUMMARY, file: null })
    await start($, clock)

    expect((await usageText($)).text).toContain('no reading yet')
  })

  test('/usage-mod refresh re-runs the script and shows new numbers', async ($, on) => {
    const state = { usage: USAGE, process: SUMMARY as SpendSummary | null, file: null }
    const clock = engine(on, state)
    await start($, clock)

    state.process = { ...SUMMARY, today: { usd: 40, tokens: 1 } }
    expect((await usageText($, 'refresh')).text).toContain('Today      $40.00')
  })
})

// Shaped like the plan usage API's reply: Fable is a model-scoped window inside `limits`, extra usage
// is money in cents, and reset grants sit in `cedar_ember`.
const FABLE_ENTRY = { kind: 'weekly_scoped', scope: { model: { display_name: 'Fable', id: null }, surface: null }, percent: 52, resets_at: '2026-10-05T13:00:00Z' }
const PLAN_FOR_BAND = JSON.stringify({
  five_hour: { utilization: 5, resets_at: '2026-10-03T09:14:00Z' },
  seven_day: { utilization: 65, resets_at: '2026-10-05T13:00:00Z' },
  seven_day_sonnet: null,
  limits: [FABLE_ENTRY],
  extra_usage: { is_enabled: true, monthly_limit: 5000, used_credits: 1250 },
  cedar_ember: { eligible: true, grants: [{ resets_left: 1, ends_at: '2026-10-20T00:00:00Z' }] },
})

const SNAP = {
  limits: toLimits(USAGE.rateLimits),
  context: USAGE.context,
  sessionUsd: 4.32,
  tokens: { up: 15_600, down: 3000, cache: 954_200 },
  spend: SUMMARY,
  now: NOW,
}

describe('band tiers', () => {
  test('run from richest to leanest, with no session tokens or cost on the band', () => {
    const tiers = bandTiers(SNAP, true)
    const kinds = (t: readonly { type: string }[]) => t.map(s => s.type)
    expect(kinds(tiers[0])).toEqual(['limit', 'limit', 'limit', 'money'])
    expect(kinds(tiers[1])).toEqual(['limit', 'limit', 'limit'])
    expect(tiers.at(-2)?.length).toBe(2)
    expect(kinds(tiers[tiers.length - 1])).toEqual(['limit'])
    expect(tiers.flat().some(s => s.type === 'token' || (s.type === 'money' && s.kind === 'session'))).toBe(false)
    expect(bandTiers({ ...SNAP, limits: [], context: null, spend: null }, true)).toEqual([])
  })

  test('today spend is left out when the setting is off, and a lone tightest limit is the floor', () => {
    expect(bandTiers(SNAP, false)[0].some(s => s.type === 'money' && s.kind === 'today')).toBe(false)
    const floor = bandTiers(SNAP, true).at(-1)!
    expect(floor[0]).toMatchObject({ type: 'limit', label: '7d' })
  })

  test('the richest layout that fits is chosen, by pixels or by cells', () => {
    const tiers = bandTiers(SNAP, true)
    expect(pickLayout(tiers, 5000, bandWidth)).toEqual([tiers[0]])
    expect(pickLayout(tiers, 1, bandWidth)).toEqual([tiers[tiers.length - 1]])
    expect(pickLayout(tiers, 400, cellWidth)).toEqual([tiers[0]])
    expect(pickLayout([], 100, bandWidth)).toEqual([])
    expect(cellWidth(tiers[1])).toBeLessThan(cellWidth(tiers[0]))
  })

  test('when one line is too short, today moves to a second line instead of being dropped', () => {
    const tiers = bandTiers(SNAP, true)
    // Room for the three limit pills but not for today beside them.
    const room = bandWidth(tiers[1])
    const layout = pickLayout(tiers, room, bandWidth)
    expect(layout).toHaveLength(2)
    expect(layout[0].every(s => s.type === 'limit')).toBe(true)
    expect(layout[1].map(s => s.type === 'money' && s.kind)).toEqual(['today'])
  })

  test('packRows fills lines in order, gives up past the row limit, and refuses a segment wider than a line', () => {
    const [first, second, third] = bandTiers(SNAP, true)[0]
    const w = (...segs: (typeof first)[]) => bandWidth(segs)
    expect(packRows([first, second], 5000, bandWidth)).toEqual([[first, second]])
    expect(packRows([first, second, third], w(first, second), bandWidth)).toEqual([[first, second], [third]])
    expect(packRows([first, second, third], w(first), bandWidth)).toBeNull()
    expect(packRows([first], w(first) - 1, bandWidth)).toBeNull()
    expect(packRows([first, second, third], w(first), bandWidth, 3)).toEqual([[first], [second], [third]])
  })

  test('every limit window stays on the band, down to slim pills, before any is dropped', () => {
    const limits = mergeLimits({ live: [], plan: parsePlanUsage(PLAN_FOR_BAND)!.limits, stored: [] }, NOW)
    const snap = { ...SNAP, limits }
    for (const room of [1400, 900, 600, 450, 380]) {
      const labels = pickLayout(bandTiers(snap, true), room, bandWidth).flat().filter(s => s.type === 'limit').map(s => (s as { label: string }).label)
      for (const want of ['5h', '7d', 'Fable', 'Extra']) expect(labels).toContain(want)
    }
  })

  test('only when even two lines will not do does the band start dropping things', () => {
    const tiers = bandTiers(SNAP, true)
    const room = bandWidth(tiers[3])
    const layout = pickLayout(tiers, room, bandWidth)
    expect(layout.length).toBeLessThanOrEqual(2)
    expect(layout.every(row => bandWidth(row) <= room)).toBe(true)
    expect(layout.flat().some(s => s.type === 'money')).toBe(false)
  })

  test('a limit carries its countdown and a tooltip', () => {
    const [five] = bandTiers(SNAP, true)[0]
    expect(five).toMatchObject({ type: 'limit', reset: '4h14m', detail: 'resets in 4h14m' })
    expect((five as { tip: string }).tip).toContain('5-hour limit: 95% left. Resets in 4h14m.')
  })
})

describe('svg band', () => {
  test('draws one svg sized to its pills, with an alt that says what it shows', () => {
    const band = bandSvg(bandTiers(SNAP, true)[0])
    expect(band.source.startsWith('<svg ')).toBe(true)
    expect(band.source).toContain(`width="${band.width}"`)
    expect(band.source).toContain('$29.90 today')
    expect(band.alt).toContain('5-hour 95% left, resets in 4h14m')
    expect(band.alt).toContain('$29.90 today')
  })

  test('a leaner tier is narrower, and markup stays well inside the size limit', () => {
    const tiers = bandTiers(SNAP, true)
    expect(bandWidth(tiers[3])).toBeLessThan(bandWidth(tiers[0]))
    expect(bandSvg(tiers[0]).source.length).toBeLessThan(40_000)
  })

  test('escapes text, so a label cannot break the markup', () => {
    const band = bandSvg([{ type: 'limit', tone: 'extra', label: 'a<b&c', name: 'n', percentLeft: 50, severity: 'ok', isStale: false, tip: 'tip <x> & "y"' }])
    expect(band.source).not.toContain('a<b')
    expect(band.source).toContain('a&lt;b&amp;c')
    expect(band.source).toContain('tip &lt;x&gt; &amp; &quot;y&quot;')
  })
})

describe('the band on screen', () => {
  const PROPS = (columns: number) =>
    ({ hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: columns }) as unknown as RenderPropsOf['AbovePrompt']

  test('terminal draws colored chips and desktop draws the svg, both with Details', async ($, on) => {
    const clock = engine(on, { usage: USAGE, process: SUMMARY, file: null })
    await start($, clock)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'usage-mod', surface, component: 'AbovePrompt', props: PROPS(120) })
      expect(await ui.find({ type: 'Button', label: 'Details' })).toBeDefined()
      if (surface === 'terminal') expect(await ui.find({ type: 'Text', text: /95%/ })).toBeDefined()
      else expect(await ui.find({ type: 'Svg' })).toBeDefined()
    }
  })

  test('a narrow terminal keeps a smaller band instead of wrapping', async ($, on) => {
    const clock = engine(on, { usage: USAGE, process: SUMMARY, file: null })
    await start($, clock)

    const ui = await $.ui.mount({ plugin: 'usage-mod', surface: 'terminal', component: 'AbovePrompt', props: PROPS(40) })
    expect(await ui.find({ type: 'Text', text: /35%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /today/ })).toBeUndefined()
  })
})

const PANE_SNAP = { ...SNAP, spendStatus: 'ok' as const }

describe('pane model', () => {
  test('limits (with empty slots) and the session chips come from the snapshot', () => {
    const m = paneModel(PANE_SNAP)
    expect(m.limits.map(l => (l.type === 'limit' ? l.label : l.name))).toEqual(['5h', '7d', 'Fable weekly', 'Extra usage'])
    expect(m.limits.filter(l => l.type === 'empty').map(l => l.note)).toEqual(['No data', 'No data'])
    expect(m.session.map(s => s.type)).toEqual(['token', 'token', 'token', 'money'])
  })

  test('spend rows are label, dollars and tokens; the trend carries its peak', () => {
    const m = paneModel({ ...PANE_SNAP, spend: { ...SUMMARY, trend: [{ day: '2026-10-02', usd: 621.94 }, { day: '2026-10-03', usd: 29.9 }] } })
    expect(m.spend.map(r => [r.label, r.usd, r.tokens])).toEqual([
      ['Today', '$29.90', '45.1M tokens'],
      ['Yesterday', '$694.08', '1.5B tokens'],
      ['Last 30 days', '$1.2K', '2.9B tokens'],
    ])
    expect(m.peak).toBe('$621.94')
  })

  test('the note says why spend is missing or old, and stays quiet when all is well', () => {
    expect(paneModel(PANE_SNAP).note).toBeUndefined()
    expect(paneModel({ ...PANE_SNAP, spend: null, spendStatus: 'idle' }).note).toContain('Reading')
    expect(paneModel({ ...PANE_SNAP, spend: null, spendStatus: 'unavailable' }).note).toContain('aggregate-usage.mjs')
    expect(paneModel({ ...PANE_SNAP, spendStatus: 'unavailable', spend: { ...SUMMARY, updatedAt: NOW - 3_600_000 } }).note).toContain('1h00m ago')
    expect(paneModel({ ...PANE_SNAP, spend: { ...SUMMARY, unknownModels: ['x-9'] } }).note).toContain('x-9')
  })
})

describe('svg pane', () => {
  test('rows for limits, chips for the session and justified spend rows', () => {
    const card = paneSvg(paneModel(PANE_SNAP))
    expect(card.source).toContain('Weekly')
    expect(card.source).toContain('text-anchor="end"')
    expect(card.width).toBe(440)
    expect(card.source).toContain(`height="${card.height}"`)
  })

  test('lays out at the panel width: cards run edge to edge, nothing wider than the panel', () => {
    for (const w of [320, 440, 560]) {
      const card = paneSvg(paneModel(PANE_SNAP), w)
      expect(card.width).toBe(w)
      const xs = [...card.source.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)" height="[\d.]+" rx="14"/g)]
      expect(xs.length).toBeGreaterThan(2)
      for (const [, x, width] of xs) expect(Number(x) + Number(width)).toBeLessThanOrEqual(w)
      expect(xs.some(([, x, width]) => Number(x) === 0 && Number(width) === w)).toBe(true)
    }
  })

  test('Pac-Man chomps (animated mouth) and the next dot blinks', () => {
    const band = bandSvg(bandTiers(SNAP, true)[0])
    expect(band.source).toContain('attributeName="d"')
    expect(band.source).toContain('attributeName="opacity"')
  })

  test('is well-formed: no unescaped quote inside an attribute, within the size limit', () => {
    const { source } = paneSvg(paneModel(PANE_SNAP))
    expect(source.length).toBeLessThan(60_000)
    // Once every complete attribute is removed, no quote may be left over.
    expect(source.replace(/="[^"]*"/g, '')).not.toContain('"')
  })

  test('with no limit readings every window still has a row, marked No data', () => {
    const card = paneSvg(paneModel({ ...PANE_SNAP, limits: [], spend: null, spendStatus: 'idle', tokens: { up: 0, down: 0, cache: 0 }, sessionUsd: null }))
    for (const name of ['5-hour', 'Weekly', 'Fable weekly', 'Extra usage']) expect(card.source).toContain(name)
    expect(card.source.match(/No data/g)).toHaveLength(4)
    expect(card.source).toContain('not reported by your plan')
    expect(card.source).not.toContain('SPEND')
  })

  test('Fable and Extra with no reading draw a No data row with an empty bar, not Pac-Man', () => {
    const withPlan = paneSvg(paneModel({ ...PANE_SNAP, limits: mergeLimits({ live: [], plan: parsePlanUsage(PLAN_FOR_BAND)!.limits, stored: [] }, NOW) }))
    expect(withPlan.source).not.toContain('No data')
    const without = paneSvg(paneModel(PANE_SNAP))
    expect(without.source.match(/No data/g)).toHaveLength(2)
    expect(without.alt).toContain('Fable weekly no data')
    expect(without.alt).toContain('Extra usage no data')
    // Card titles (the drawn text, not tooltips) never say "limit"; the LIMITS section heading is a heading.
    const drawn = [...without.source.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map(x => x[1]).filter(s => s !== 'LIMITS')
    expect(drawn.filter(s => /limit/i.test(s))).toEqual([])
  })
})

describe('the pane on screen', () => {
  const PANE_PROPS = { bodyColumns: 80 } as unknown as RenderPropsOf['Pane']

  test('terminal draws sections as text, desktop draws the card, both with Refresh', async ($, on) => {
    const clock = engine(on, { usage: USAGE, process: SUMMARY, file: null })
    await start($, clock)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'usage-mod', surface, component: 'Pane', requestId: 'usage-mod', props: PANE_PROPS })
      expect(await ui.find({ type: 'Button', label: 'Refresh spend' })).toBeDefined()
      if (surface === 'terminal') {
        expect(await ui.find({ type: 'Text', text: 'LIMITS' })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: 'Today' })).toBeDefined()
      } else {
        expect(await ui.find({ type: 'Svg' })).toBeDefined()
      }
    }
  })
})

describe('what survives between sessions', () => {
  test('limits seen last time show, marked stale, until this session has a response of its own', async ($, on) => {
    const clock = engine(on, { usage: { ...USAGE, rateLimits: [] }, process: SUMMARY, file: null }, {
      limits: { limits: [{ kind: 'five_hour', percentUsed: 30, resetsAt: '2026-10-03T09:14:00Z' }] },
    })
    await start($, clock)

    const text = (await usageText($)).text
    expect(text).toContain('70% left')
    expect(text).not.toContain('no reading yet')
  })

  test('a stored window that has already reset is dropped', async ($, on) => {
    const clock = engine(on, { usage: { ...USAGE, rateLimits: [] }, process: SUMMARY, file: null }, {
      limits: { limits: [{ kind: 'five_hour', percentUsed: 30, resetsAt: '2026-10-03T04:00:00Z' }] },
    })
    await start($, clock)

    expect((await usageText($)).text).toContain('no reading yet')
  })

  test('a live reading replaces the stored one', async ($, on) => {
    const clock = engine(on, { usage: { ...USAGE, rateLimits: [] }, process: SUMMARY, file: null }, {
      limits: { limits: [{ kind: 'five_hour', percentUsed: 30, resetsAt: '2026-10-03T09:14:00Z' }] },
    })
    await start($, clock)
    await $.session.measure({ context: USAGE.context, rateLimits: [{ kind: 'five_hour', percentUsed: 50, resetsAt: '2026-10-03T09:14:00Z' }] })

    expect((await usageText($)).text).toContain('50% left')
  })

  test('token totals come back when the session id matches, and not for another session', async ($, on) => {
    const clock = engine(on, { usage: USAGE, process: SUMMARY, file: null }, { tokens: { sessionId: 'test-session', up: 15_600, down: 3000, cache: 954_200 } })
    await start($, clock)

    const ui = await $.ui.mount({ plugin: 'usage-mod', surface: 'terminal', component: 'Pane', requestId: 'usage-mod', props: { bodyColumns: 80 } as unknown as RenderPropsOf['Pane'] })
    expect(await ui.find({ type: 'Text', text: /954\.2k/ })).toBeDefined()
  })

  test('tokens saved by another session are ignored', async ($, on) => {
    const clock = engine(on, { usage: USAGE, process: SUMMARY, file: null }, { tokens: { sessionId: 'someone-else', up: 15_600, down: 3000, cache: 954_200 } })
    await start($, clock)

    const ui = await $.ui.mount({ plugin: 'usage-mod', surface: 'terminal', component: 'Pane', requestId: 'usage-mod', props: { bodyColumns: 80 } as unknown as RenderPropsOf['Pane'] })
    expect(await ui.find({ type: 'Text', text: /954\.2k/ })).toBeUndefined()
  })
})

describe('session tokens', () => {
  const turn = (input_tokens: number, output_tokens: number, read: number, write: number) =>
    ({
      answer: '',
      durationMs: 1,
      isAborted: false,
      turnId: 't',
      reason: 'answer',
      usage: { model: 'm', input_tokens, output_tokens, cache_read_input_tokens: read, cache_creation_input_tokens: write },
    }) as const

  test('each completed turn adds input, output and cache (reads plus writes)', async ($, on) => {
    const clock = engine(on, { usage: USAGE, process: SUMMARY, file: null })
    on('turn.complete', () => ({ text: '' }))
    await start($, clock)

    await $.turn.complete(turn(1000, 200, 5000, 500))
    await $.turn.complete(turn(500, 100, 6000, 0))

    const ui = await $.ui.mount({ plugin: 'usage-mod', surface: 'terminal', component: 'Pane', requestId: 'usage-mod', props: { bodyColumns: 80 } as unknown as RenderPropsOf['Pane'] })
    expect(await ui.find({ type: 'Text', text: /1\.5k/ })).toBeDefined() // input 1,500
    expect(await ui.find({ type: 'Text', text: /300/ })).toBeDefined() // output 300
    expect(await ui.find({ type: 'Text', text: /11\.5k/ })).toBeDefined() // cache 11,500
  })
})

describe('the band across widths and settings', () => {
  const props = (columns: number) =>
    ({ hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: columns }) as unknown as RenderPropsOf['AbovePrompt']
  const TOKENS = { sessionId: 'test-session', up: 15_600, down: 3000, cache: 954_200 }

  test('at 100, 70 and 50 columns both surfaces keep drawing a limit', async ($, on) => {
    const clock = engine(on, { usage: USAGE, process: SUMMARY, file: null }, { tokens: TOKENS })
    await start($, clock)

    for (const surface of ['terminal', 'desktop'] as const) {
      for (const columns of [100, 70, 50]) {
        const ui = await $.ui.mount({ plugin: 'usage-mod', surface, component: 'AbovePrompt', props: props(columns) })
        expect(await ui.find({ type: surface === 'terminal' ? 'Text' : 'Svg', ...(surface === 'terminal' ? { text: /95%|35%/ } : {}) })).toBeDefined()
      }
    }
  })

  test('terminal: wide keeps one row with today, narrower puts today on a second row, tiny keeps one limit', async ($, on) => {
    const clock = engine(on, { usage: USAGE, process: SUMMARY, file: null }, { tokens: TOKENS })
    await start($, clock)
    const mount = (columns: number) => $.ui.mount({ plugin: 'usage-mod', surface: 'terminal', component: 'AbovePrompt', props: props(columns) })

    const wide = await mount(200)
    expect(await wide.find({ type: 'Text', text: /today/ })).toBeDefined()
    expect(await wide.find({ type: 'Box', key: 'row-1' })).toBeUndefined()

    const narrow = await mount(104)
    expect(await narrow.find({ type: 'Text', text: /today/ })).toBeDefined()
    expect(await narrow.find({ type: 'Box', key: 'row-1' })).toBeDefined()

    const tiny = await mount(30)
    expect(await tiny.find({ type: 'Text', text: /today/ })).toBeUndefined()
    expect(await tiny.find({ type: 'Text', text: /35%/ })).toBeDefined()
  })

  test('this session is not on the band at any width, only in the pane', async ($, on) => {
    const clock = engine(on, { usage: USAGE, process: SUMMARY, file: null }, { tokens: TOKENS })
    await start($, clock)
    const ui = await $.ui.mount({ plugin: 'usage-mod', surface: 'terminal', component: 'AbovePrompt', props: props(300) })
    expect(await ui.find({ type: 'Text', text: /954\.2k/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /\$7\.82|\$11\./ })).toBeUndefined()
  })

  test('view off draws no band, but the command still answers', { options: { view: 'off' } }, async ($, on) => {
    const clock = engine(on, { usage: USAGE, process: SUMMARY, file: null })
    await start($, clock)
    // The hook passes the band through, so nothing beneath the plugin draws it in this test.
    await expect($.ui.mount({ plugin: 'usage-mod', surface: 'terminal', component: 'AbovePrompt', props: props(120) })).rejects.toThrow('no implementation for ui.render')
    expect((await usageText($)).text).toContain('95% left')
  })

  test('showSpend off leaves Today out of the band', { options: { showSpend: false } }, async ($, on) => {
    const clock = engine(on, { usage: USAGE, process: SUMMARY, file: null })
    await start($, clock)
    const ui = await $.ui.mount({ plugin: 'usage-mod', surface: 'terminal', component: 'AbovePrompt', props: props(200) })
    expect(await ui.find({ type: 'Text', text: /95%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /today/ })).toBeUndefined()
  })
})

const PLAN = PLAN_FOR_BAND.replace('"utilization":5,', '"utilization":12,')

describe('plan usage', () => {
  test('windows, the scoped Fable window, extra usage in dollars and reset grants come out of a real-shaped reply', () => {
    const parsed = parsePlanUsage(PLAN, NOW)!
    expect(parsed.limits.map(l => [l.kind, l.percentUsed])).toEqual([['five_hour', 12], ['seven_day', 65], ['seven_day_fable', 52], ['extra_usage', 25]])
    expect(parsed.limits.find(l => l.kind === 'seven_day_fable')).toMatchObject({ label: 'Fable', resetsAt: '2026-10-05T13:00:00Z' })
    expect(parsed.limits.find(l => l.kind === 'extra_usage')).toMatchObject({ usedUsd: 12.5, limitUsd: 50 })
    expect(parsed.resetGrants).toEqual({ count: 1, expiries: ['2026-10-20T00:00:00Z'] })
    expect(parsed.keys).toContain('seven_day_sonnet')
    expect(parsePlanUsage('nope')).toBeNull()
    expect(parsePlanUsage('[]')).toBeNull()
  })

  test('extra usage needs to be on and capped: spent over cap is the bar, zero spent is 0%', () => {
    const extra = (x: object) => parsePlanUsage(JSON.stringify({ extra_usage: x }))!.limits
    expect(extra({ is_enabled: true, monthly_limit: 10000, used_credits: 0 })).toEqual([{ kind: 'extra_usage', percentUsed: 0, usedUsd: 0, limitUsd: 100 }])
    expect(extra({ is_enabled: true, monthly_limit: 10000 })[0].percentUsed).toBe(0)
    expect(extra({ is_enabled: false, monthly_limit: 10000, used_credits: 5 })).toEqual([])
    expect(extra({ is_enabled: true, used_credits: 500 })).toEqual([]) // no cap: nothing to draw a bar against
    expect(parsePlanUsage(JSON.stringify({ extra_usage: null }))!.limits).toEqual([])
  })

  test('reset grants count each reset left, skip spent or expired grants, and read 0 when not eligible', () => {
    const grants = (cedar: object | null) => parsePlanUsage(JSON.stringify({ cedar_ember: cedar }), NOW)!.resetGrants
    expect(grants({ eligible: true, grants: [{ resets_left: 2, ends_at: '2026-10-20T00:00:00Z' }, { resets_left: 0 }, { resets_left: 1, ends_at: '2026-10-01T00:00:00Z' }] })).toEqual({ count: 2, expiries: ['2026-10-20T00:00:00Z', '2026-10-20T00:00:00Z'] })
    expect(grants({ eligible: false, grants: [{ resets_left: 3 }] })).toEqual({ count: 0, expiries: [] })
    expect(grants(null)).toBeUndefined()
    expect(parsePlanUsage('{}')!.resetGrants).toBeUndefined()
  })

  test('internal codename fields are ignored; a codename window with a non-null reading is named by what it is', () => {
    const reply = JSON.stringify({
      five_hour: { utilization: 3, resets_at: '2026-10-03T09:27:00Z' },
      tangelo: { utilization: 10, resets_at: '2026-10-05T13:00:00Z' },
      seven_day_omelette: { utilization: 20, resets_at: '2026-10-05T13:00:00Z' },
      seven_day_breakdown: [{ model: 'x' }],
    })
    const parsed = parsePlanUsage(reply)!
    expect(parsed.limits.map(l => l.kind)).toEqual(['five_hour', 'seven_day_omelette'])
    expect(mergeLimits({ live: [], plan: parsed.limits, stored: [] }, NOW).map(l => l.label)).toEqual(['5h', 'Design'])
  })

  test('a scoped window is found by its model name; other entries and malformed ones are ignored', () => {
    const limitsOf = (entries: unknown[]) => parsePlanUsage(JSON.stringify({ limits: entries }))!.limits
    const entry = (name: string, extra: object = {}) => ({ ...FABLE_ENTRY, scope: { model: { display_name: name, id: null } }, ...extra })
    expect(limitsOf([entry('Fable')]).map(l => [l.kind, l.label, l.percentUsed])).toEqual([['seven_day_fable', 'Fable', 52]])
    expect(limitsOf([entry('Fable'), entry('Sonnet 4.6', { percent: 7 })]).map(l => l.kind)).toEqual(['seven_day_fable', 'seven_day_sonnet_4_6'])
    expect(limitsOf([entry('Fable', { kind: 'daily' })])).toEqual([])
    expect(limitsOf([entry('Fable', { percent: 'x' })])).toEqual([])
    expect(limitsOf([{ kind: 'weekly_scoped' }, null, 3])).toEqual([])
    expect(parsePlanUsage(JSON.stringify({ limits: 'nope' }))!.limits).toEqual([])
  })

  test('the older top-level seven_day_<model> window is still read while it is not null', () => {
    const parsed = parsePlanUsage(JSON.stringify({ seven_day_sonnet: { utilization: 30, resets_at: '2026-10-05T13:00:00Z' }, seven_day_opus: null }))!
    expect(parsed.limits.map(l => l.kind)).toEqual(['seven_day_sonnet'])
  })

  test('limits come out named, ordered and with Fable and Extra as their own pills', () => {
    const merged = mergeLimits({ live: [], plan: parsePlanUsage(PLAN, NOW)!.limits, stored: [] }, NOW)
    expect(merged.map(l => [l.label, l.group, l.percentLeft])).toEqual([
      ['5h', 'limits', 88],
      ['7d', 'limits', 35],
      ['Fable', 'model', 48],
      ['Extra', 'extra', 75],
    ])
    const [, , fable, extra] = bandTiers({ ...SNAP, limits: merged }, true)[0]
    expect(fable).toMatchObject({ tone: 'model', name: 'Fable weekly' })
    expect(extra).toMatchObject({ tone: 'extra', name: 'Extra usage' })
    expect((extra as { tip: string }).tip).toContain('$12.50 of $50.00 spent this month, 75% of the monthly limit left')
    expect(extra).toMatchObject({ detail: '$12.50 of $50.00 this month' })
  })

  test('the engine wins over the plan, the plan over the stored reading, and only stored ones are stale', () => {
    const plan = [{ kind: 'five_hour', percentUsed: 12, resetsAt: '2026-10-03T09:27:00Z' }, { kind: 'seven_day_fable', percentUsed: 52, resetsAt: '2026-10-05T13:00:00Z' }]
    const stored = [{ kind: 'five_hour', percentUsed: 99, resetsAt: '2026-10-03T09:27:00Z' }, { kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-05T13:00:00Z' }]
    const live = [{ kind: 'five_hour', percentUsed: 5, resetsAt: '2026-10-03T09:27:00Z' }]
    const merged = mergeLimits({ live, plan, stored }, NOW)
    expect(merged.map(l => [l.kind, l.percentLeft, l.isStale === true])).toEqual([
      ['five_hour', 95, false],
      ['seven_day', 60, true],
      ['seven_day_fable', 48, false],
    ])
  })

  test('a window whose reset time has passed is dropped', () => {
    const old = [{ kind: 'seven_day_fable', percentUsed: 52, resetsAt: '2026-10-03T04:00:00Z' }]
    expect(mergeLimits({ live: [], plan: old, stored: old }, NOW)).toEqual([])
  })
})

describe('plan usage in the mod', () => {
  test('a signed-in session shows Fable and Extra, and a fresh session needs no first response for 5h and 7d', async ($, on) => {
    const clock = engine(on, { usage: { ...USAGE, rateLimits: [] }, process: SUMMARY, file: null, plan: PLAN })
    await start($, clock)

    const text = (await usageText($)).text
    expect(text).toContain('88% left')
    expect(text).toContain('Fable')
    expect(text).toContain('48% left')
    expect(text).toContain('Extra')
    expect(text).toContain('75% left')
  })

  test('the request opts in to the reset grants, which the API otherwise returns as null', async ($, on) => {
    const urls: string[] = []
    const clock = engine(on, { usage: USAGE, process: SUMMARY, file: null, plan: PLAN, urls })
    await start($, clock)
    expect(urls).toHaveLength(1)
    expect(new URL(urls[0]).searchParams.get('cedar_ember')).toBe('1')
  })

  test('Fable and Extra stay on a narrow terminal band, on two rows', async ($, on) => {
    const clock = engine(on, { usage: USAGE, process: SUMMARY, file: null, plan: PLAN })
    await start($, clock)
    const ui = await $.ui.mount({ plugin: 'usage-mod', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 60 } as unknown as RenderPropsOf['AbovePrompt'] })
    expect(await ui.find({ type: 'Text', text: /Fable/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Extra/ })).toBeDefined()
    expect(await ui.find({ type: 'Box', key: 'row-1' })).toBeDefined()
  })

  test('the band draws the Fable and Extra pills', async ($, on) => {
    const clock = engine(on, { usage: USAGE, process: SUMMARY, file: null, plan: PLAN })
    await start($, clock)
    const ui = await $.ui.mount({ plugin: 'usage-mod', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 300 } as unknown as RenderPropsOf['AbovePrompt'] })
    expect(await ui.find({ type: 'Text', text: /Fable/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Extra/ })).toBeDefined()
  })

  test('a failed or unauthorized fetch leaves the engine limits alone and says why in /usage-mod debug', async ($, on) => {
    const clock = engine(on, { usage: USAGE, process: SUMMARY, file: null, plan: { status: 403, text: '' } })
    await start($, clock)
    expect((await usageText($)).text).toContain('95% left')
    expect((await usageText($, 'debug')).text).toContain('http 403')
  })

  test('with no signed-in session nothing is fetched', async ($, on) => {
    const clock = engine(on, { usage: USAGE, process: SUMMARY, file: null })
    await start($, clock)
    expect((await usageText($, 'debug')).text).toContain('no signed-in session')
  })

  test('the setting turns the fetch off', { options: { planLimits: false } }, async ($, on) => {
    const clock = engine(on, { usage: USAGE, process: SUMMARY, file: null, plan: PLAN })
    await start($, clock)
    expect((await usageText($)).text).not.toContain('Fable')
    expect((await usageText($, 'debug')).text).toContain('switched off')
  })

  test('debug lists the fields the API returned, so a missing model limit can be traced', async ($, on) => {
    const written: string[] = []
    const clock = engine(on, { usage: USAGE, process: SUMMARY, file: null, plan: PLAN, written })
    await start($, clock)
    const text = (await usageText($, 'debug')).text
    expect(text).toContain('ok')
    expect(text).toContain('limits')
    expect(text).toContain('extra_usage')
    expect(text).toContain('cedar_ember')
    expect(text).toContain('plan-usage.json')
    expect(written).toEqual(['/home/test/.claude/claude-usage-mod/plan-usage.json'])
  })
})

describe('starting without session.start', () => {
  // /reload-plugins swaps the module without firing session.start again; the mod starts itself.
  test('the first measure boots the mod, so the plan limits arrive', async ($, on) => {
    const clock = engine(on, { usage: { ...USAGE, rateLimits: [] }, process: SUMMARY, file: null, plan: PLAN })
    await $.session.measure({ context: USAGE.context, rateLimits: [] })
    await clock.settle()

    const text = (await usageText($)).text
    expect(text).toContain('Fable')
    expect(text).toContain('Extra')
  })

  test('/usage-mod debug fetches when nothing has been fetched yet', async ($, on) => {
    engine(on, { usage: USAGE, process: SUMMARY, file: null, plan: PLAN })
    const text = (await usageText($, 'debug')).text
    expect(text).toContain('ok')
    expect(text).toContain('Fields: five_hour')
  })

  test('booting twice fetches once', async ($, on) => {
    const fetches = { n: 0 }
    const clock = engine(on, { usage: USAGE, process: SUMMARY, file: null, plan: PLAN, fetches })
    await $.session.start(START)
    await $.session.measure({ context: USAGE.context, rateLimits: [] })
    await usageText($)
    await clock.settle()
    expect(fetches.n).toBe(1)
  })
})

describe('debug always asks again', () => {
  test('a second /usage-mod debug fetches again so the saved reply is fresh', async ($, on) => {
    const fetches = { n: 0 }
    const written: string[] = []
    const clock = engine(on, { usage: USAGE, process: SUMMARY, file: null, plan: PLAN, fetches, written })
    await start($, clock)
    await usageText($, 'debug')
    await usageText($, 'debug')
    expect(fetches.n).toBe(3) // the start-up fetch, then one per debug
    expect(written).toHaveLength(2)
  })
})

describe('smooth updates', () => {
  test('the countdown signature changes only when a displayed countdown would', () => {
    const limits = mergeLimits({ live: [], plan: parsePlanUsage(PLAN_FOR_BAND)!.limits, stored: [] }, NOW)
    const base = NOW - 30_000 // mid-minute, so a few seconds never cross a boundary
    const a = resetSignature(limits, base)
    expect(resetSignature(limits, base + 5_000)).toBe(a) // 5 seconds later reads the same
    expect(resetSignature(limits, base + 61_000)).not.toBe(a) // a minute later does not
    expect(resetSignature([], base)).toBe('')
  })

  test('the desktop SVG is interactive by default and the setting turns it off', async ($, on) => {
    const clock = engine(on, { usage: USAGE, process: SUMMARY, file: null })
    await start($, clock)
    const ui = await $.ui.mount({ plugin: 'usage-mod', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 140 } as unknown as RenderPropsOf['AbovePrompt'] })
    expect(await ui.find({ type: 'Svg' })).toBeDefined()
  })

  test('with interactive off the band is still drawn', { options: { interactive: false } }, async ($, on) => {
    const clock = engine(on, { usage: USAGE, process: SUMMARY, file: null })
    await start($, clock)
    const ui = await $.ui.mount({ plugin: 'usage-mod', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 140 } as unknown as RenderPropsOf['AbovePrompt'] })
    expect(await ui.find({ type: 'Svg' })).toBeDefined()
  })

  test('repeated identical readings leave what is shown unchanged', async ($, on) => {
    const clock = engine(on, { usage: USAGE, process: SUMMARY, file: null, plan: PLAN })
    await start($, clock)
    const before = (await usageText($)).text
    for (let i = 0; i < 3; i++) await $.session.measure({ context: USAGE.context, rateLimits: USAGE.rateLimits, cost: USAGE.cost })
    expect((await usageText($)).text).toBe(before)
  })
})

describe('rate limit resets in the pane', () => {
  const grants = { count: 2, expiries: ['2026-10-20T00:00:00Z', '2026-10-25T00:00:00Z'] }

  test('a row with the count and the earliest deadline, after the windows', () => {
    const m = paneModel({ ...PANE_SNAP, resetGrants: grants })
    const row = m.limits.at(-1)
    expect(row).toMatchObject({ type: 'count', name: 'Usage resets', value: '2 available', detail: 'use by Oct 20' })
    expect((row as { tip: string }).tip).toContain('Oct 20, Oct 25')
  })

  test('an account with the block but none left reads 0 available; without the block there is no row', () => {
    expect(paneModel({ ...PANE_SNAP, resetGrants: { count: 0, expiries: [] } }).limits.at(-1)).toMatchObject({ value: '0 available', detail: 'none granted' })
    expect(paneModel({ ...PANE_SNAP, resetGrants: null }).limits.some(l => l.type === 'count')).toBe(false)
  })

  test('the card draws it, and the terminal pane shows the count', async ($, on) => {
    const card = paneSvg(paneModel({ ...PANE_SNAP, resetGrants: grants }))
    expect(card.source).toContain('Usage resets')
    expect(card.source).toContain('2 available')
    expect(card.alt).toContain('Usage resets 2 available')

    const clock = engine(on, { usage: USAGE, process: SUMMARY, file: null, plan: PLAN })
    await start($, clock)
    const ui = await $.ui.mount({ plugin: 'usage-mod', surface: 'terminal', component: 'Pane', requestId: 'usage-mod', props: { bodyColumns: 80 } as unknown as RenderPropsOf['Pane'] })
    expect(await ui.find({ type: 'Text', text: '1 available' })).toBeDefined()
  })
})
