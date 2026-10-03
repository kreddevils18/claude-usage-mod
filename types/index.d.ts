// The mod's $.state contract: every value the hooks keep with `atom` is declared here.

export type LimitGroup = 'limits' | 'model' | 'extra'

/** One rate-limit window as the band and pane draw it. `percentLeft` is 0-100. */
export type Limit = {
  kind: string
  label: string
  group: LimitGroup
  percentLeft: number
  resetsAt?: string
  /** Read from the last session's saved value because this session has had no API response yet. */
  isStale?: boolean
}

/** One rate-limit window as a source reports it, before it is turned into a `Limit`. */
export type RawLimit = {
  kind: string
  percentUsed: number
  resetsAt?: string
  /** A name to show instead of one made from `kind` (a model's display name). */
  label?: string
  /** Extra usage only: dollars spent this month, and the monthly cap. */
  usedUsd?: number
  limitUsd?: number
}

/** One-off usage-limit resets Anthropic has granted: how many are left and the deadlines to use them by. */
export type ResetGrants = { count: number; expiries: string[] }

export type ContextUsage = {
  percent: number | null
  tokens?: number
  window: number
}

export type SpendDay = { usd: number; tokens: number }

/** What scripts/aggregate-usage.mjs writes to usage.json. */
export type SpendSummary = {
  updatedAt: number
  today: SpendDay
  yesterday: SpendDay
  last30: SpendDay
  trend: { day: string; usd: number }[]
  unknownModels: string[]
}

/** Tokens this session has used, summed from each completed turn. `cache` is reads plus writes. */
export type SessionTokens = { up: number; down: number; cache: number }

/** The outcome of a plan usage fetch: what happened, and the names of the fields it returned. */
export type PlanInfo = { at: number; outcome: string; keys: string[] }

/** The rate-limit windows last seen, kept across sessions so a fresh session is not blank until its first response. */
export type StoredLimits = {
  savedAt: number
  limits: { kind: string; percentUsed: number; resetsAt?: string }[]
}

/** This session's token totals, kept so a resume does not start them from zero. */
export type StoredTokens = SessionTokens & { sessionId: string }

/** `unavailable`: the script could not run here (no `$.process`, no node); the last cache stays on screen. */
export type SpendStatus = 'idle' | 'refreshing' | 'ok' | 'unavailable'

declare module 'claude-code' {
  interface PluginState {
    'usage-mod': {
      limits: Limit[]
      /** What the engine last reported this session. */
      liveLimits: RawLimit[]
      /** Fetched from the plan usage API: it also carries per-model and extra-usage windows. */
      planLimits: RawLimit[]
      /** Read from the previous session's store; shown pale until something fresher arrives. */
      storedLimits: RawLimit[]
      /** What the last plan fetch came to, for `/usage-mod debug`. */
      planInfo: PlanInfo | null
      /** The plan usage API's last reply, kept in memory so `/usage-mod debug` can save it. */
      planRaw: string | null
      resetGrants: ResetGrants | null
      context: ContextUsage | null
      sessionUsd: number | null
      spend: SpendSummary | null
      spendStatus: SpendStatus
      tokens: SessionTokens
      /** Epoch ms, moved once a minute so reset countdowns redraw. */
      tick: number
      /** Names the module that started the timers. */
      generation: string
    }
  }
}
