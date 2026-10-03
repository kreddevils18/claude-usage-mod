// The last good plan usage reply, kept in one file on disk that every session reads: the terminal,
// the desktop app and any other copy of the mod (an installed one and a --plugin-dir one have
// separate $.store files, but the same HOME). The endpoint answers 429 when it is asked too often,
// and each session asking on its own start and timer is what makes it too often; a session that
// was refused then had no Fable, Extra or resets at all while another one still drew them.
//
// So the sessions take turns, the way a single app would ask on its own:
// - a reply younger than the interval is used as it is, by every session;
// - a session about to ask says so (`askingAt`), and the others wait for its reply for a while;
// - a 429 makes every session wait until its Retry-After time, any other failure for a minute;
// - a session nobody is using asks only once the reply is older than the idle interval.
// Pure; register.tsx does the IO.

export type PlanCache = {
  /** Epoch ms of the last good reply, and its body. */
  at?: number
  text?: string
  /** Epoch ms before which no session should ask again (a 429, or another failure). */
  retryAt?: number
  /** Epoch ms when a session started asking; the others leave it to that session for CLAIM_MS. */
  askingAt?: number
}

export const planCacheFile = (home: string) => `${home}/.claude/claude-usage-mod/plan-cache.json`

/** How long the other sessions leave a request to the session that claimed it. */
export const CLAIM_MS = 30_000
/** How long every session waits after a failure that is not a 429 (no Retry-After to follow). */
export const FAILURE_BACKOFF_MS = 60_000
/** How old the reply may get before a session with no turn since its last request asks again. */
export const IDLE_MS = 30 * 60_000

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Null when the file is not a cache this mod wrote. */
export function parsePlanCache(text: string): PlanCache | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const c = raw as Record<string, unknown>
  const out: PlanCache = {}
  if (num(c.at) && typeof c.text === 'string') {
    out.at = c.at
    out.text = c.text
  }
  if (num(c.retryAt)) out.retryAt = c.retryAt
  if (num(c.askingAt)) out.askingAt = c.askingAt
  return out
}

/**
 * When to ask again after a 429: the Retry-After header (seconds, or an HTTP date) when it is
 * there and sensible, otherwise `fallbackMs` from now.
 */
export function retryAtFrom(headers: Readonly<Record<string, string>>, now: number, fallbackMs: number): number {
  const value = headers['retry-after']?.trim()
  if (value) {
    const seconds = Number(value)
    if (Number.isFinite(seconds) && seconds >= 0) return now + seconds * 1000
    const date = Date.parse(value)
    if (Number.isFinite(date) && date > now) return date
  }
  return now + fallbackMs
}

export type AskPolicy = {
  /** How long a reply stays good for a session in use. */
  intervalMs: number
  /** True when this session has had a turn since it last asked (or has never asked). */
  isActive: boolean
  /** The refresh and debug commands: a recent reply or another session's claim does not stop them. */
  force?: boolean
}

/**
 * Why this session should not ask now, or undefined when it should. A wait for a failure holds even
 * for the commands: asking a limiting endpoint again only makes the wait longer.
 */
export function holdReason(cache: PlanCache | null, now: number, policy: AskPolicy): string | undefined {
  if (cache?.retryAt !== undefined && cache.retryAt > now) return 'waiting'
  if (policy.force || !cache) return undefined
  if (cache.askingAt !== undefined && now - cache.askingAt >= 0 && now - cache.askingAt < CLAIM_MS) return 'another session is asking'
  if (cache.at === undefined) return undefined
  const age = now - cache.at
  if (age < policy.intervalMs) return 'recent'
  if (!policy.isActive && age < IDLE_MS) return 'idle'
  return undefined
}

/** The cache as it stands while this session asks: the old reply, and its claim. */
export const claimed = (cache: PlanCache | null, now: number): PlanCache => ({ ...withoutClaim(cache), askingAt: now })

/** After a failure: the old reply stays, the claim goes, and every session waits until `retryAt`. */
export function failed(cache: PlanCache | null, retryAt: number): PlanCache {
  const held = cache?.retryAt !== undefined && cache.retryAt > retryAt ? cache.retryAt : retryAt
  return { ...withoutClaim(cache), retryAt: held }
}

function withoutClaim(cache: PlanCache | null): PlanCache {
  const out: PlanCache = {}
  if (cache?.at !== undefined && cache.text !== undefined) {
    out.at = cache.at
    out.text = cache.text
  }
  if (cache?.retryAt !== undefined) out.retryAt = cache.retryAt
  return out
}
