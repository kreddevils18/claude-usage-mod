// Pure side of the spend cache. Spend history comes from scripts/aggregate-usage.mjs, which
// writes a small usage.json; register.tsx reads that file with $.fs and runs the script with
// $.process. Those calls live there because the engine follows `$` only inside the file that
// registers the hooks, never across an import.
//
// Where $.process is missing (it is CLI only) or node is not on PATH, a refresh fails and the
// last file stays on screen: any CLI session, or a cron/launchd run of the script, keeps the
// same file fresh for every surface.
import type { SpendDay, SpendSummary } from '../types'

export const SCRIPT_TIMEOUT_MS = 120_000

export const summaryFile = (home: string) => `${home}/.claude/claude-usage-mod/usage.json`

export const scriptPath = (pluginRoot: string) => `${pluginRoot}/scripts/aggregate-usage.mjs`

const isDay = (v: unknown): v is SpendDay =>
  typeof v === 'object' && v !== null && typeof (v as SpendDay).usd === 'number' && typeof (v as SpendDay).tokens === 'number'

/** Validates what the script wrote; anything malformed is null so the UI shows "no data" rather than NaN. */
export function parseSummary(text: string): SpendSummary | null {
  let raw: Partial<SpendSummary>
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  if (typeof raw.updatedAt !== 'number' || !isDay(raw.today) || !isDay(raw.yesterday) || !isDay(raw.last30)) return null
  const trend = Array.isArray(raw.trend)
    ? raw.trend.filter(t => typeof t?.day === 'string' && typeof t?.usd === 'number')
    : []
  const unknownModels = Array.isArray(raw.unknownModels) ? raw.unknownModels.filter(m => typeof m === 'string') : []
  return { updatedAt: raw.updatedAt, today: raw.today, yesterday: raw.yesterday, last30: raw.last30, trend, unknownModels }
}
