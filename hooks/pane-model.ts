// What the Details pane shows, independent of surface: the desktop draws it as one SVG card
// (svg-pane.ts) and the terminal as Text rows (terminal-pane.tsx), both from this model.
// The context window is not a pane section: it lives in the band's ctx chip.
import { limitSegments, sessionSegment, tokenSegments } from './band-model'
import type { BandSnapshot, LimitSegment, MoneySegment, TokenSegment } from './band-model'
import { formatDuration, formatTokens, formatUsd, shortDay } from './format'
import type { ResetGrants, SpendStatus } from '../types'

export type SpendRow = { label: string; usd: string; tokens: string; tip: string }
export type TrendBar = { day: string; usd: number; tip: string }

/** A window the pane always has a row for: drawn as "No data" until the plan reports it. */
export type EmptyLimit = { type: 'empty'; tone: LimitSegment['tone']; name: string; note: string; detail: string; tip: string }

/** A count rather than a bar: the rate-limit resets Anthropic has granted. */
export type CountRow = { type: 'count'; tone: LimitSegment['tone']; name: string; value: string; detail: string; tip: string }

export type PaneModel = {
  /** Rate limits in order; Fable and Extra are always there, as an EmptyLimit when there is no reading. */
  limits: (LimitSegment | EmptyLimit | CountRow)[]
  /** This session's token chips and cost. */
  session: (TokenSegment | MoneySegment)[]
  spend: SpendRow[]
  /** The last 14 days, oldest first. */
  trend: TrendBar[]
  peak?: string
  /** One line under the card: stale cache, no data, or still reading. */
  note?: string
}

export type PaneSnapshot = BandSnapshot & { spendStatus: SpendStatus; resetGrants?: ResetGrants | null }

const defined = <T,>(x: T | undefined): x is T => x !== undefined

function noteFor(s: PaneSnapshot): string | undefined {
  if (s.spend && s.spendStatus === 'unavailable') return `Spend is from ${formatDuration(s.now - s.spend.updatedAt)} ago; the script cannot run in this session.`
  if (s.spend) return s.spend.unknownModels.length ? `No price for ${s.spend.unknownModels.join(', ')}; add it to config/pricing.json.` : undefined
  if (s.spendStatus === 'unavailable') return 'No spend data. Run `node scripts/aggregate-usage.mjs` once from a terminal.'
  return 'Reading transcripts...'
}

// The windows the pane always has a row for, in order. A missing reading reads as "No data" rather
// than as a bug; any other window the plan reports (another model) goes between Fable and Extra.
const SLOTS: { has: (l: LimitSegment) => boolean; name: string; tone: LimitSegment['tone']; detail: string; tip: string }[] = [
  { has: l => l.label === '5h', name: '5-hour', tone: 'five', detail: 'arrives with the first response', tip: '5-hour limit: no data yet; it arrives with the first response of a session.' },
  { has: l => l.label === '7d', name: 'Weekly', tone: 'seven', detail: 'arrives with the first response', tip: 'Weekly limit: no data yet; it arrives with the first response of a session.' },
  { has: l => l.label === 'Fable', name: 'Fable weekly', tone: 'model', detail: 'not reported by your plan', tip: 'Fable weekly: no data. Your plan has not reported one.' },
]
const EXTRA_SLOT = { has: (l: LimitSegment) => l.name === 'Extra usage', name: 'Extra usage', tone: 'extra' as const, detail: 'off, or not reported', tip: 'Extra usage: no data. It is off, or your plan has not reported it.' }

function resetsRow(g: ResetGrants | null | undefined): CountRow | undefined {
  if (!g) return undefined
  const first = g.expiries[0]
  return {
    type: 'count',
    tone: 'extra',
    name: 'Usage resets',
    value: `${g.count} available`,
    detail: first ? `use by ${shortDay(first.slice(0, 10))}` : 'none granted',
    tip: g.count > 0 ? `${g.count} one-off usage-limit reset${g.count === 1 ? '' : 's'} granted by Anthropic.${g.expiries.length ? ` Use ${g.count === 1 ? 'it' : 'them'} by ${g.expiries.map(d => shortDay(d.slice(0, 10))).join(', ')}.` : ''}` : 'No usage-limit resets are available on this account.',
  }
}

function withEmptySlots(limits: LimitSegment[]): (LimitSegment | EmptyLimit)[] {
  const slot = (s: (typeof SLOTS)[number]): LimitSegment | EmptyLimit =>
    limits.find(s.has) ?? { type: 'empty', tone: s.tone, name: s.name, note: 'No data', detail: s.detail, tip: s.tip }
  const claimed = new Set<LimitSegment>([...SLOTS, EXTRA_SLOT].flatMap(s => limits.filter(s.has)))
  const others = limits.filter(l => !claimed.has(l))
  return [...SLOTS.map(slot), ...others, slot(EXTRA_SLOT)]
}

export function paneModel(s: PaneSnapshot): PaneModel {
  const spend: SpendRow[] = s.spend
    ? ([['Today', s.spend.today], ['Yesterday', s.spend.yesterday], ['Last 30 days', s.spend.last30]] as const).map(([label, d]) => ({
        label,
        usd: formatUsd(d.usd),
        tokens: `${formatTokens(d.tokens)} tokens`,
        tip: `${label}: ${formatUsd(d.usd)} and ${formatTokens(d.tokens)} tokens across all sessions.`,
      }))
    : []
  const trend: TrendBar[] = (s.spend?.trend ?? []).map(t => ({ day: t.day, usd: t.usd, tip: `${shortDay(t.day)}: ${formatUsd(t.usd)}` }))
  const peak = trend.length > 0 ? Math.max(...trend.map(t => t.usd)) : 0
  return {
    limits: [...withEmptySlots(limitSegments(s, true)), ...[resetsRow(s.resetGrants)].filter(defined)],
    session: [...tokenSegments(s), sessionSegment(s)].filter(defined),
    spend,
    trend,
    peak: peak > 0 ? formatUsd(peak) : undefined,
    note: noteFor(s),
  }
}
