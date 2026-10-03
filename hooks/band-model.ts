// Decides what the band shows, independent of how a surface draws it: the segments, in order,
// each with a tooltip saying what the number is, and which of them survive at a given width.
// The SVG band (desktop) and the Text band (terminal) both draw this same list, and the pane
// reads the same segment builders.
import { formatDuration, formatTokens, formatUsd, groupDigits, untilReset } from './format'
import { severity } from './limits'
import type { Severity } from './limits'
import type { ContextUsage, Limit, SessionTokens, SpendSummary } from '../types'

/** Which color family a limit pill takes. */
export type Tone = 'five' | 'seven' | 'model' | 'extra' | 'context'

export type LimitSegment = {
  type: 'limit'
  tone: Tone
  /** Short name on the pill: "5h", "7d", "Fable", "ctx". */
  label: string
  /** Longer name for the pane: "5-hour limit". */
  name: string
  /** The line under the name in the pane: "resets in 3h52m" or "126.0k of 1M tokens". */
  detail?: string
  percentLeft: number
  severity: Severity
  /** "3h52m"; absent when compact or when the window has no reset time. */
  reset?: string
  /** Drawn without the bar, so every window still fits in a short band. */
  slim?: boolean
  /** True when the reading is from a previous session and no response has refreshed it yet. */
  isStale: boolean
  tip: string
}
export type TokenKind = 'up' | 'down' | 'cache'
export type TokenSegment = { type: 'token'; kind: TokenKind; text: string; tip: string }
export type MoneySegment = { type: 'money'; kind: 'session' | 'today'; text: string; tip: string }
export type Segment = LimitSegment | TokenSegment | MoneySegment

export type BandSnapshot = {
  limits: readonly Limit[]
  context: ContextUsage | null
  sessionUsd: number | null
  tokens: SessionTokens
  spend: SpendSummary | null
  now: number
}

const toneOf = (l: Limit): Tone =>
  l.kind === 'five_hour' ? 'five' : l.kind === 'seven_day' ? 'seven' : l.group === 'model' ? 'model' : 'extra'

const nameOf = (l: Limit): string =>
  l.kind === 'extra_usage' ? 'Extra usage' : l.kind === 'five_hour' ? '5-hour' : l.kind === 'seven_day' ? 'Weekly' : l.group === 'model' ? `${l.label} weekly` : l.label

function limitSegment(l: Limit, now: number, withReset: boolean, slim: boolean): LimitSegment {
  const left = untilReset(l.resetsAt, now)
  const resetText = left !== undefined ? formatDuration(left) : undefined
  const tip =
    (l.kind === 'extra_usage'
      ? `Extra usage: ${l.usedUsd !== undefined && l.limitUsd !== undefined ? `${formatUsd(l.usedUsd)} of ${formatUsd(l.limitUsd)} spent this month, ` : ''}${l.percentLeft}% of the monthly limit left.`
      : `${nameOf(l)} limit: ${l.percentLeft}% left.`) +
    (resetText ? ` Resets in ${resetText}.` : '') +
    (l.isStale ? ' Last seen in an earlier session; it updates with the next response.' : '')
  return {
    type: 'limit',
    tone: toneOf(l),
    label: l.label,
    name: nameOf(l),
    detail: l.kind === 'extra_usage' && l.usedUsd !== undefined && l.limitUsd !== undefined ? `${formatUsd(l.usedUsd)} of ${formatUsd(l.limitUsd)} this month` : resetText ? `resets in ${resetText}` : undefined,
    percentLeft: l.percentLeft,
    severity: severity(l.percentLeft),
    reset: withReset ? resetText : undefined,
    ...(slim ? { slim } : {}),
    isStale: l.isStale === true,
    tip,
  }
}

export const limitSegments = (s: BandSnapshot, withReset: boolean, slim = false): LimitSegment[] => s.limits.map(l => limitSegment(l, s.now, withReset, slim))

/** The context window as a pill that looks like a limit, with no reset. */
export function contextSegment(s: BandSnapshot, slim = false): LimitSegment | undefined {
  const c = s.context
  if (!c || c.percent == null) return undefined
  const percentLeft = Math.max(0, Math.min(100, Math.round(100 - c.percent)))
  const used = c.tokens != null ? `${formatTokens(c.tokens)} of ${formatTokens(c.window)}` : undefined
  return {
    type: 'limit',
    tone: 'context',
    label: 'ctx',
    ...(slim ? { slim } : {}),
    name: 'Context window',
    detail: used ? `${used} tokens used` : undefined,
    percentLeft,
    severity: severity(percentLeft),
    isStale: false,
    tip: `Context window: ${percentLeft}% left${used ? ` (${used} tokens used)` : ''}. When it fills, Claude Code compacts the conversation.`,
  }
}

const hasTokens = (t: SessionTokens) => t.up + t.down + t.cache > 0

export function tokenSegments(s: BandSnapshot): TokenSegment[] {
  if (!hasTokens(s.tokens)) return []
  const t = s.tokens
  return [
    { type: 'token', kind: 'up', text: formatTokens(t.up), tip: `Input tokens this session, not counting cache: ${groupDigits(t.up)}.` },
    { type: 'token', kind: 'down', text: formatTokens(t.down), tip: `Output tokens this session: ${groupDigits(t.down)}.` },
    { type: 'token', kind: 'cache', text: formatTokens(t.cache), tip: `Cache reads and writes this session: ${groupDigits(t.cache)} tokens.` },
  ]
}

export function sessionSegment(s: BandSnapshot): MoneySegment | undefined {
  return s.sessionUsd == null ? undefined : { type: 'money', kind: 'session', text: formatUsd(s.sessionUsd), tip: `Cost of this session so far: ${formatUsd(s.sessionUsd)}.` }
}

export function todaySegment(s: BandSnapshot): MoneySegment | undefined {
  if (!s.spend) return undefined
  const d = s.spend.today
  return { type: 'money', kind: 'today', text: `${formatUsd(d.usd)} today`, tip: `Spend today across all sessions: ${formatUsd(d.usd)}, ${formatTokens(d.tokens)} tokens.` }
}

const defined = <T,>(x: T | undefined): x is T => x !== undefined

/**
 * The band from richest to leanest. This session's tokens and cost are not on it (they live in the
 * pane). Every limit window stays on the band as long as it can: when space runs out the order of
 * loss is today's spend, the reset times, the bars (a window shrinks to icon, name and percent),
 * and only last every window but the tightest.
 */
export function bandTiers(s: BandSnapshot, showSpend: boolean): Segment[][] {
  const today = showSpend ? [todaySegment(s)].filter(defined) : []
  const ctx = [contextSegment(s)].filter(defined)
  const slimCtx = [contextSegment(s, true)].filter(defined)
  const withReset = limitSegments(s, true)
  const compact = limitSegments(s, false)
  const slim = limitSegments(s, false, true)
  const tightest = compact.reduce<LimitSegment | undefined>((min, l) => (min === undefined || l.percentLeft < min.percentLeft ? l : min), undefined)
  const tight: Segment[] = tightest ? [tightest] : ctx

  const tiers: Segment[][] = [
    [...withReset, ...ctx, ...today],
    [...withReset, ...ctx],
    [...compact, ...ctx],
    [...compact],
    [...slim, ...slimCtx],
    [...slim],
    tight,
  ]
  return tiers.filter(t => t.length > 0)
}

/** Rows of segments, each drawn on its own line. */
export type Layout = Segment[][]

/**
 * Packs segments, in order, into at most `maxRows` lines no wider than `room` (as `measure` counts
 * it). Null when they do not fit, or when one segment alone is wider than a line.
 */
export function packRows(tier: readonly Segment[], room: number, measure: (t: readonly Segment[]) => number, maxRows = 2): Layout | null {
  const rows: Segment[][] = [[]]
  for (const seg of tier) {
    const row = rows[rows.length - 1]
    if (measure([...row, seg]) <= room) {
      row.push(seg)
      continue
    }
    if (row.length === 0 || rows.length === maxRows) return null
    rows.push([seg])
    if (measure([seg]) > room) return null
  }
  return rows
}

/**
 * The richest tier that packs into the room, on one line if it can and on two if it must; the
 * leanest tier is the floor, and nothing known gives no rows.
 */
export function pickLayout(tiers: readonly Segment[][], room: number, measure: (t: readonly Segment[]) => number, maxRows = 2): Layout {
  for (const tier of tiers) {
    const rows = packRows(tier, room, measure, maxRows)
    if (rows) return rows
  }
  return tiers.length > 0 ? [[...tiers[tiers.length - 1]]] : []
}
