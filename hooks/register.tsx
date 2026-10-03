// usage-mod (repo claude-usage-mod): usage as chips in Claude Code.
//
// session.start:   registers /usage-mod, seeds the state from $.session.usage() and the spend
//                  cache, and starts two timers: a minute tick (reset countdowns) and the spend refresh.
// session.measure: keeps limits, context and session cost live; the engine pushes it when a
//                  rate-limit window moves a whole point and after each main-thread turn.
// turn.complete:   adds the turn's tokens to this session's totals.
// ui.render:       AbovePrompt draws the one-line band (SVG pills on desktop, Text chips on the
//                  terminal); Pane draws the full view.
// command.run:     /usage-mod opens the pane; /usage-mod text prints it; /usage-mod refresh re-reads transcripts.
//
// Helpers that take `$` stay in this file: the engine follows `$` only inside the registering file.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, Timer } from 'claude-code'

import type { ContextUsage, Limit, PlanInfo, RawLimit, ResetGrants, SessionTokens, SpendStatus, SpendSummary, StoredLimits, StoredTokens } from '../types'
import { bandTiers, pickLayout } from './band-model'
import type { BandSnapshot } from './band-model'
import { formatDuration } from './format'
import { mergeLimits, resetSignature } from './limits'
import { PLAN_USAGE_URL, parsePlanUsage } from './plan-usage'
import { SCRIPT_TIMEOUT_MS, parseSummary, scriptPath, summaryFile } from './spend-cache'
import { summaryText } from './summary-text'
import { bandSvg, bandWidth } from './svg-band'
import { paneModel } from './pane-model'
import { paneSvg } from './svg-pane'
import { cellWidth, chipRow } from './terminal-band'
import { terminalPane } from './terminal-pane'

const COMMAND = 'usage-mod'
const PANE = 'usage-mod'
const DEFAULT_REFRESH_MINUTES = 5
// Pixels per terminal column on a surface that draws the band as SVG; an estimate, kept on the
// narrow side so the band never overflows. The Details button keeps its own room.
const CELL_PX = 7.4
const DETAILS_PX = 90
const DETAILS_CELLS = 12

const limits = atom({ plugin: 'usage-mod', key: 'limits' } as const, [] as Limit[])
const liveLimits = atom({ plugin: 'usage-mod', key: 'liveLimits' } as const, [] as RawLimit[])
const planLimits = atom({ plugin: 'usage-mod', key: 'planLimits' } as const, [] as RawLimit[])
const storedLimits = atom({ plugin: 'usage-mod', key: 'storedLimits' } as const, [] as RawLimit[])
const planInfo = atom({ plugin: 'usage-mod', key: 'planInfo' } as const, null as PlanInfo | null)
const resetGrants = atom({ plugin: 'usage-mod', key: 'resetGrants' } as const, null as ResetGrants | null)
const planRaw = atom({ plugin: 'usage-mod', key: 'planRaw' } as const, null as string | null)
const context = atom({ plugin: 'usage-mod', key: 'context' } as const, null as ContextUsage | null)
const sessionUsd = atom({ plugin: 'usage-mod', key: 'sessionUsd' } as const, null as number | null)
const spend = atom({ plugin: 'usage-mod', key: 'spend' } as const, null as SpendSummary | null)
const spendStatus = atom({ plugin: 'usage-mod', key: 'spendStatus' } as const, 'idle' as SpendStatus)
const tokens = atom({ plugin: 'usage-mod', key: 'tokens' } as const, { up: 0, down: 0, cache: 0 } as SessionTokens)
const tick = atom({ plugin: 'usage-mod', key: 'tick' } as const, 0)
// Names the module that started the timers, so timers of an older module that was reloaded away
// find out and stop instead of running beside the new ones.
const generation = atom({ plugin: 'usage-mod', key: 'generation' } as const, '')

// A write redraws everything that read the value, and the desktop redraws an SVG by reloading its
// frame, which shows as a flicker. So a value is written only when it differs from what is held:
// every write below is `if (changed(await read($, x), next)) await update($, x, () => next)`.
// (The engine reads an atom only where it is named, so this cannot be one generic helper.)
const changed = (held: unknown, next: unknown) => JSON.stringify(held) !== JSON.stringify(next)

/** Runs `fn` every `ms` while this module is the current generation; cancels itself once a newer one exists. */
function every($: EngineInterface, ms: number, gen: string, fn: () => unknown): Timer {
  const timer: Timer = $.clock.every(ms, async () => {
    if ((await read($, generation)) !== gen) {
      timer.cancel()
      return
    }
    await fn()
  })
  return timer
}

type Measure = { rateLimits: readonly SessionRateLimit[]; context: ContextUsage; cost?: { usd: number } }

// The windows last seen, kept across sessions: a fresh or resumed session has no engine reading until
// its first API response, and a blank band for that stretch looks broken. mergeLimits drops the
// windows that have since reset.
async function loadStoredLimits($: EngineInterface): Promise<RawLimit[]> {
  const saved = (await $.store.get('limits')) as Partial<StoredLimits> | undefined
  if (!saved || !Array.isArray(saved.limits)) return []
  return saved.limits.filter(l => typeof l?.kind === 'string' && typeof l.percentUsed === 'number')
}

// One list from three sources: the engine now, the plan usage API, and the previous session.
async function rebuildLimits($: EngineInterface) {
  const from = { live: await read($, liveLimits), plan: await read($, planLimits), stored: await read($, storedLimits) }
  const now = await $.clock.now()
  {
    const next = mergeLimits(from, now)
    if (changed(await read($, limits), next)) await update($, limits, () => next)
  }
}

let lastSavedLimits = ''

async function apply($: EngineInterface, m: Measure) {
  if (m.rateLimits.length > 0) {
    const raw: RawLimit[] = m.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt }))
    {
      const next = raw
      if (changed(await read($, liveLimits), next)) await update($, liveLimits, () => next)
    }
    const json = JSON.stringify(raw)
    if (json !== lastSavedLimits) {
      lastSavedLimits = json
      const saved: StoredLimits = { savedAt: await $.clock.now(), limits: raw }
      await $.store.set('limits', saved)
    }
  }
  await rebuildLimits($)
  {
    const next = m.context
    if (changed(await read($, context), next)) await update($, context, () => next)
  }
  {
    const next = m.cost?.usd ?? null
    if (changed(await read($, sessionUsd), next)) await update($, sessionUsd, () => next)
  }
}

/**
 * Asks the plan usage API for every window of the plan, through the engine's credential handle: the
 * token itself never reaches this mod. Only a signed-in (bearer) session can ask; an API key, a
 * gateway or no login gets nothing and the engine's own two windows stand.
 */
async function fetchPlanLimits($: EngineInterface) {
  const at = await $.clock.now()
  const note = (outcome: string, keys: string[] = []) => update($, planInfo, () => ({ at, outcome, keys }))
  try {
    const auth = await $.session.authorize()
    if (!auth || auth.kind !== 'bearer') return note('no signed-in session')
    const res = await $.http.fetch(PLAN_USAGE_URL, { auth: auth.handle, headers: { 'anthropic-beta': 'oauth-2025-04-20', accept: 'application/json' } })
    if (!res.ok) return note(`http ${res.status}`)
    {
      const next = res.text
      if (changed(await read($, planRaw), next)) await update($, planRaw, () => next)
    }
    const parsed = parsePlanUsage(res.text, at)
    if (!parsed) return note('not json')
    {
      const next = parsed.limits
      if (changed(await read($, planLimits), next)) await update($, planLimits, () => next)
    }
    {
      const next = parsed.resetGrants ?? null
      if (changed(await read($, resetGrants), next)) await update($, resetGrants, () => next)
    }
    await note('ok', parsed.keys)
    await rebuildLimits($)
  } catch {
    await note('request failed')
  }
}

// Reading `tick` subscribes a drawing to the countdown. It moves only when a displayed countdown changes.
async function snapshot($: EngineInterface): Promise<BandSnapshot & { spendStatus: SpendStatus; context: ContextUsage | null; resetGrants: ResetGrants | null }> {
  await read($, tick)
  return {
    resetGrants: await read($, resetGrants),
    limits: await read($, limits),
    context: await read($, context),
    sessionUsd: await read($, sessionUsd),
    tokens: await read($, tokens),
    spend: await read($, spend),
    spendStatus: await read($, spendStatus),
    now: await $.clock.now(),
  }
}

// The band shows limits, context and today's spend, nothing else: it reads only those, so a new
// token total or a refreshing spend status does not redraw it.
async function bandSnapshot($: EngineInterface): Promise<BandSnapshot> {
  await read($, tick)
  return {
    limits: await read($, limits),
    context: await read($, context),
    sessionUsd: null,
    tokens: { up: 0, down: 0, cache: 0 },
    spend: await read($, spend),
    now: await $.clock.now(),
  }
}

/** The last summary on disk, or null when the script has never run or the file is unreadable. */
async function readSpend($: EngineInterface): Promise<SpendSummary | null> {
  const home = await $.env.get('HOME')
  if (!home) return null
  try {
    return parseSummary(await $.fs.read(summaryFile(home)))
  } catch {
    return null
  }
}

/** Runs the aggregation script; null when it cannot run here (no $.process, no node) or fails. */
async function runSpendScript($: EngineInterface): Promise<SpendSummary | null> {
  try {
    const run = await $.process.run(['node', scriptPath($.plugin.root)], { timeoutMs: SCRIPT_TIMEOUT_MS })
    return run.exitCode === 0 ? parseSummary(run.stdout) : null
  } catch {
    return null
  }
}

let isRefreshing = false

// One script run at a time; a failed run falls back to the file on disk, which a CLI session
// or a scheduled run may have refreshed, and counts as fine while that file is recent. The figures
// on screen stay until the new ones are in: there is no "refreshing" state to flash through.
async function refresh($: EngineInterface, refreshMs: number) {
  if (isRefreshing) return
  isRefreshing = true
  try {
    const fresh = await runSpendScript($)
    if (fresh) {
      {
        const next = fresh
        if (changed(await read($, spend), next)) await update($, spend, () => next)
      }
      {
        const next = 'ok'
        if (changed(await read($, spendStatus), next)) await update($, spendStatus, () => next)
      }
      return
    }
    const cached = await readSpend($)
    if (cached && changed(await read($, spend), cached)) await update($, spend, () => cached)
    const isRecent = cached !== null && (await $.clock.now()) - cached.updatedAt < refreshMs * 2
    {
      const next = isRecent ? 'ok' : 'unavailable'
      if (changed(await read($, spendStatus), next)) await update($, spendStatus, () => next)
    }
  } finally {
    isRefreshing = false
  }
}

let isBooted = false

// Everything a session needs started: the command, the first readings, and the timers. It runs on
// session.start, but also from the first measure or command, because a reload through
// /reload-plugins drops the old timers without firing session.start again.
async function boot($: EngineInterface, refreshMs: number, wantsPlanLimits: boolean) {
  if (isBooted) return
  isBooted = true
  await $.command.register({
    name: COMMAND,
    description: 'Open the usage pane. /usage-mod text prints it, /usage-mod refresh re-reads transcripts.',
    argumentHint: '[text|refresh|debug]',
  })

  const gen = `${await $.clock.now()}-${Math.floor(Math.random() * 1e9)}`
  await update($, generation, () => gen)
  const stored = await loadStoredLimits($)
  {
    const next = stored
    if (changed(await read($, storedLimits), next)) await update($, storedLimits, () => next)
  }
  await apply($, await $.session.usage())
  await update($, tick, () => 0)
  const savedTokens = (await $.store.get('tokens')) as Partial<StoredTokens> | undefined
  if (savedTokens?.sessionId === (await $.session.id())) {
    {
      const next = { up: Number(savedTokens.up) || 0, down: Number(savedTokens.down) || 0, cache: Number(savedTokens.cache) || 0 }
      if (changed(await read($, tokens), next)) await update($, tokens, () => next)
    }
  }
  const cached = await readSpend($)
  if (cached && changed(await read($, spend), cached)) await update($, spend, () => cached)

  // The countdowns show minutes, so the band is redrawn only on a minute where one of them changes.
  let lastSignature = ''
  every($, 60_000, gen, async () => {
    const now = await $.clock.now()
    const signature = resetSignature(await read($, limits), now)
    if (signature === lastSignature) return
    lastSignature = signature
    await update($, tick, () => now)
  })
  every($, refreshMs, gen, () => refresh($, refreshMs))
  void refresh($, refreshMs)
  if (wantsPlanLimits) {
    every($, refreshMs, gen, () => fetchPlanLimits($))
    void fetchPlanLimits($)
  }
}

export const register: Register = (on, options) => {
  const refreshMinutes = Number(options.refreshMinutes)
  const refreshMs = (refreshMinutes >= 1 ? refreshMinutes : DEFAULT_REFRESH_MINUTES) * 60_000
  const isBandOn = options.view !== 'off'
  const showSpend = options.showSpend !== false
  const wantsPlanLimits = options.planLimits !== false
  const isInteractive = options.interactive !== false

  on('session.start', async ($, e, next) => {
    await boot($, refreshMs, wantsPlanLimits)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await boot($, refreshMs, wantsPlanLimits)
    await apply($, e)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const u = e.usage
    if (u) {
      await update($, tokens, t => ({
        up: t.up + u.input_tokens,
        down: t.down + u.output_tokens,
        cache: t.cache + u.cache_read_input_tokens + u.cache_creation_input_tokens,
      }))
      const totals: StoredTokens = { ...(await read($, tokens)), sessionId: await $.session.id() }
      await $.store.set('tokens', totals)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!isBandOn || e.props.hasSurvey) return next(e)
    const tiers = bandTiers(await bandSnapshot($), showSpend)
    if (tiers.length === 0) return next(e)

    const els = $.ui.resolve(e)
    const { Box, Button, Svg } = els
    const details = <Button key="details" label="Details" plain onPress={() => $.ui.open({ id: PANE, title: 'Usage' })} />
    if (e.surface === 'terminal') {
      const rows = pickLayout(tiers, e.props.bodyColumns - DETAILS_CELLS, cellWidth)
      return (
        <Box flexDirection="column">
          {rows.map((row, i) => (
            <Box key={`row-${i}`} columnGap={1}>
              {chipRow(els, row)}
              {i === 0 ? details : null}
            </Box>
          ))}
        </Box>
      )
    }
    const rows = pickLayout(tiers, e.props.bodyColumns * CELL_PX - DETAILS_PX, bandWidth)
    return (
      <Box flexDirection="column" rowGap={1}>
        {rows.map((row, i) => {
          const band = bandSvg(row)
          return (
            <Box key={`row-${i}`} columnGap={2} alignItems="center">
              <Svg source={band.source} alt={band.alt} width={band.width} height={band.height} isInteractive={isInteractive} />
              {i === 0 ? details : null}
            </Box>
          )
        })}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Button, Svg } = els
    const model = paneModel(await snapshot($))
    const refreshButton = <Button key="refresh" label="Refresh spend" onPress={() => refresh($, refreshMs)} />
    if (e.surface === 'terminal') {
      return (
        <Box flexDirection="column" gap={1}>
          {terminalPane(els, model)}
          {refreshButton}
        </Box>
      )
    }
    // The card is laid out at the panel's own width, so its blocks run edge to edge.
    const card = paneSvg(model, Math.max(280, Math.floor(e.props.bodyColumns * CELL_PX)))
    return (
      <Box flexDirection="column" gap={1}>
        <Svg source={card.source} alt={card.alt} width={card.width} height={card.height} isInteractive={isInteractive} />
        {refreshButton}
      </Box>
    )
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim()
    await boot($, refreshMs, wantsPlanLimits)
    if (arg === 'refresh') {
      await refresh($, refreshMs)
      if (wantsPlanLimits) await fetchPlanLimits($)
    }
    if (arg === 'debug') {
      // Always asks again: the saved reply must be the one this command's figures come from.
      if (wantsPlanLimits) await fetchPlanLimits($)
      const info = await read($, planInfo)
      const at = info ? formatDuration((await $.clock.now()) - info.at) : undefined
      // The raw reply is saved so a bug report can show exactly what the API sent; it holds usage
      // figures and nothing of the transcripts. Delete the file when you are done with it.
      const raw = await read($, planRaw)
      const home = await $.env.get('HOME')
      const file = raw && home ? `${home}/.claude/claude-usage-mod/plan-usage.json` : undefined
      if (raw && file) await $.fs.write(file, raw)
      return {
        text: !wantsPlanLimits
          ? 'Plan limits are switched off in the settings.'
          : info
            ? `Plan usage fetch ${at} ago: ${info.outcome}${info.keys.length ? `. Fields: ${info.keys.join(', ')}` : ''}${file ? `. Raw reply saved to ${file}` : info.outcome === 'ok' ? '. The raw reply could not be saved' : ''}`
            : 'Plan usage has not been fetched yet.',
      }
    }
    if (arg === 'text' || arg === 'refresh') return { text: summaryText(await snapshot($)) }
    const opened = await $.ui.open({ id: PANE, title: 'Usage' })
    return { text: opened.isPlaced ? 'Usage pane opened.' : summaryText(await snapshot($)) }
  })
}
