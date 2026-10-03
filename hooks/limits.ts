// Turns the engine's rate-limit windows into the Limit rows the mod draws.
import type { SessionRateLimit } from 'claude-code'

import { formatDuration } from './format'
import type { Limit, LimitGroup, RawLimit } from '../types'

export type Severity = 'ok' | 'warn' | 'crit'

// Percent left under which a limit turns yellow and red.
const WARN_BELOW = 35
const CRIT_BELOW = 15

export function severity(percentLeft: number): Severity {
  if (percentLeft < CRIT_BELOW) return 'crit'
  if (percentLeft < WARN_BELOW) return 'warn'
  return 'ok'
}

// The plan API names some limits by internal codename; show what they are.
const MODEL_NAMES: Record<string, string> = { omelette: 'Design', oauth_apps: 'Apps', cowork: 'Cowork' }

const title = (words: string) => words.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

function describe(kind: string): { label: string; group: LimitGroup; order: number } {
  if (kind === 'five_hour') return { label: '5h', group: 'limits', order: 0 }
  if (kind === 'seven_day') return { label: '7d', group: 'limits', order: 1 }
  // A per-model weekly window, e.g. seven_day_opus: drawn under its own group and name.
  const model = /^seven_day_(.+)$/.exec(kind)
  if (model) return { label: MODEL_NAMES[model[1]] ?? title(model[1]), group: 'model', order: 2 }
  if (kind === 'extra_usage') return { label: 'Extra', group: 'extra', order: 4 }
  return { label: title(kind), group: 'extra', order: 3 }
}

/** Windows ordered 5h, 7d, per-model, then anything else; empty while no API response reported one. */
type Reading = SessionRateLimit & Pick<RawLimit, 'label' | 'usedUsd' | 'limitUsd'>

export function toLimits(raw: readonly Reading[], stale: boolean | ReadonlySet<string> = false): Limit[] {
  const isStale = (kind: string) => (typeof stale === 'boolean' ? stale : stale.has(kind))
  return raw
    .map(r => {
      const { label, group, order } = describe(r.kind)
      const percentLeft = Math.max(0, Math.min(100, Math.round(100 - r.percentUsed)))
      const money = r.limitUsd !== undefined ? { usedUsd: r.usedUsd ?? 0, limitUsd: r.limitUsd } : {}
      return { order, limit: { kind: r.kind, label: r.label ?? label, group, percentLeft, resetsAt: r.resetsAt, ...money, ...(isStale(r.kind) ? { isStale: true } : {}) } satisfies Limit }
    })
    .sort((a, b) => a.order - b.order)
    .map(x => x.limit)
}

/** The window with the least left: what a very narrow band shows alone. */
export function tightest(limits: readonly Limit[]): Limit | undefined {
  return limits.reduce<Limit | undefined>((min, l) => (min === undefined || l.percentLeft < min.percentLeft ? l : min), undefined)
}

/**
 * One list of windows from three sources, freshest first: what the engine reports now, what the plan
 * usage API returned, and what the previous session saw. A window a fresher source has is not taken
 * from an older one; a window whose reset time has passed is dropped, because its percent means
 * nothing now (the engine's own reading is always current). Only the stored windows are stale.
 */
export function mergeLimits(from: { live: readonly RawLimit[]; plan: readonly RawLimit[]; stored: readonly RawLimit[] }, now: number): Limit[] {
  const isCurrent = (r: RawLimit) => !r.resetsAt || Date.parse(r.resetsAt) > now
  const byKind = new Map<string, RawLimit>()
  const stale = new Set<string>()
  for (const r of from.stored.filter(isCurrent)) {
    byKind.set(r.kind, r)
    stale.add(r.kind)
  }
  for (const r of [...from.plan.filter(isCurrent), ...from.live]) {
    byKind.set(r.kind, r)
    stale.delete(r.kind)
  }
  return toLimits([...byKind.values()], stale)
}

/** What the countdowns would read right now; it changes only when the band's text would. */
export function resetSignature(limits: readonly Limit[], now: number): string {
  return limits.map(l => (l.resetsAt ? formatDuration(Date.parse(l.resetsAt) - now) : '')).join('|')
}
