// Plain-text usage lines for /usage-mod: the answer on surfaces that draw nothing
// (VS Code chat panel, `claude -p`) and the fallback while no band is shown.
import { formatDuration, formatTokens, formatUsd, miniBar, untilReset } from './format'
import { severity } from './limits'
import type { ContextUsage, Limit, SpendStatus, SpendSummary } from '../types'

export type UsageSnapshot = {
  limits: readonly Limit[]
  context: ContextUsage | null
  sessionUsd: number | null
  spend: SpendSummary | null
  spendStatus: SpendStatus
  now: number
}

const DOT = { ok: '●', warn: '◐', crit: '○' } as const

function limitLine(l: Limit, now: number): string {
  const reset = untilReset(l.resetsAt, now)
  const resets = reset === undefined ? '' : `  resets in ${formatDuration(reset)}`
  return `${l.label.padEnd(7)} ${DOT[severity(l.percentLeft)]} ${String(l.percentLeft).padStart(3)}% left  ${miniBar(l.percentLeft)}${resets}`
}

const spendLine = (label: string, d: { usd: number; tokens: number }) =>
  `${label.padEnd(10)} ${formatUsd(d.usd)} · ${formatTokens(d.tokens)} tokens`

export function summaryText(s: UsageSnapshot): string {
  const lines: string[] = []
  if (s.limits.length === 0) lines.push('Limits: no reading yet (they arrive with the first API response).')
  else lines.push(...s.limits.map(l => limitLine(l, s.now)))

  if (s.context?.percent != null) lines.push(`Context ${100 - s.context.percent}% left`)
  if (s.sessionUsd != null) lines.push(`Session cost ${formatUsd(s.sessionUsd)}`)

  if (s.spend) {
    lines.push('', spendLine('Today', s.spend.today), spendLine('Yesterday', s.spend.yesterday), spendLine('30 days', s.spend.last30))
    const age = formatDuration(s.now - s.spend.updatedAt)
    const stale = s.spendStatus === 'unavailable' ? ` (cache is ${age} old; the script cannot run in this session)` : ''
    if (stale) lines.push(`Spend history${stale}`)
    if (s.spend.unknownModels.length) lines.push(`Unpriced models: ${s.spend.unknownModels.join(', ')}; add them to config/pricing.json`)
  } else if (s.spendStatus === 'unavailable') {
    lines.push('', 'Spend history: no data. Run `node scripts/aggregate-usage.mjs` once from a terminal.')
  } else {
    lines.push('', 'Spend history: reading transcripts...')
  }
  return lines.join('\n')
}
