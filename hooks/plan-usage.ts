// The plan usage API (what Claude Code's own /usage reads) returns every window of the plan, which
// the engine's `$.session.usage()` does not: the per-model weekly windows such as Fable, the
// extra-usage spend, and the one-off rate-limit resets. This turns its JSON into the same RawLimit
// rows the engine reports, so one merge handles both. Pure; register.tsx makes the request.
//
// The shape was learned from the open-source OpenUsage app (MIT, robinebers/openusage), whose
// Claude provider reads the same reply:
//   five_hour, seven_day            { utilization (0-100 used), resets_at }
//   limits[]                        { kind: "weekly_scoped", scope: { model: { display_name } },
//                                     percent (0-100 used), resets_at }   <- Fable lives here
//   extra_usage                     { is_enabled, used_credits (cents), monthly_limit (cents) }
//   cedar_ember                     { eligible, grants: [{ resets_left, ends_at }] }
// The old top-level seven_day_<model> windows now come back null, but are read when they are not.
import type { RawLimit, ResetGrants } from '../types'

export const PLAN_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const obj = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined)

const WINDOW_KEY = /^(five_hour|seven_day(_.+)?)$/
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

/** A window object: `utilization` is percent used. */
function windowOf(value: unknown): { percentUsed: number; resetsAt?: string } | null {
  const w = obj(value)
  if (!w || !num(w.utilization)) return null
  return { percentUsed: w.utilization, resetsAt: str(w.resets_at) }
}

/** Model-scoped weekly windows from the `limits` array, named by their model's display name. */
function scopedWindows(limits: unknown): RawLimit[] {
  if (!Array.isArray(limits)) return []
  const out: RawLimit[] = []
  for (const entry of limits) {
    const e = obj(entry)
    const name = str(obj(obj(e?.scope)?.model)?.display_name)
    if (!e || e.kind !== 'weekly_scoped' || !name || !num(e.percent)) continue
    out.push({ kind: `seven_day_${slug(name)}`, label: name, percentUsed: e.percent, resetsAt: str(e.resets_at) })
  }
  return out
}

/**
 * Extra usage is money, in cents: spent so far against a monthly cap. With a cap it is a bar (spent
 * over cap); switched off, or on with no cap, there is nothing to draw. (An uncapped spend has no
 * "left" to show.)
 */
function extraUsage(value: unknown): RawLimit | null {
  const x = obj(value)
  if (!x || x.is_enabled !== true) return null
  const cap = x.monthly_limit
  if (!num(cap) || cap <= 0) return null
  const used = num(x.used_credits) ? x.used_credits : 0
  return { kind: 'extra_usage', percentUsed: (used / cap) * 100, usedUsd: used / 100, limitUsd: cap / 100 }
}

/** The reset grants still usable: each reset left counts once, and carries the deadline it must be used by. */
function resetGrants(value: unknown, now: number): ResetGrants | undefined {
  const g = obj(value)
  if (!g) return undefined
  const expiries: string[] = []
  let count = 0
  if (g.eligible === true && Array.isArray(g.grants)) {
    for (const grant of g.grants) {
      const item = obj(grant)
      if (!item || !num(item.resets_left) || item.resets_left < 1) continue
      const endsAt = str(item.ends_at)
      if (endsAt && Date.parse(endsAt) <= now) continue
      const n = Math.floor(item.resets_left)
      count += n
      if (endsAt) expiries.push(...Array<string>(n).fill(endsAt))
    }
  }
  return { count, expiries: expiries.sort() }
}

/**
 * Null when the text is not a JSON object. Otherwise the plan's windows (five_hour, seven_day, the
 * `limits` array's model windows, any non-null seven_day_<model>, extra usage), the reset grants when
 * the account has that block, and the reply's field names for `/usage-mod debug`. Internal
 * feature-flag fields with codenames are ignored.
 */
export function parsePlanUsage(text: string, now = Date.now()): { limits: RawLimit[]; keys: string[]; resetGrants?: ResetGrants } | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  const reply = obj(raw)
  if (!reply) return null
  const limits: RawLimit[] = []
  for (const [kind, value] of Object.entries(reply)) {
    if (!WINDOW_KEY.test(kind)) continue
    const w = windowOf(value)
    if (w) limits.push({ kind, ...w })
  }
  for (const scoped of scopedWindows(reply.limits)) {
    if (!limits.some(l => l.kind === scoped.kind)) limits.push(scoped)
  }
  const extra = extraUsage(reply.extra_usage)
  if (extra) limits.push(extra)
  return { limits, keys: Object.keys(reply), resetGrants: resetGrants(reply.cedar_ember, now) }
}
