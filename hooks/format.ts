// Pure formatting helpers shared by the band, the pane and the /usage-mod text.

/** "4h14m", "2d8h", "12m"; under a minute "<1m". Negative or missing input gives "now". */
export function formatDuration(ms: number): string {
  if (!(ms > 0)) return 'now'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '<1m'
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return `${days}d${hours}h`
  if (hours > 0) return `${hours}h${String(minutes % 60).padStart(2, '0')}m`
  return `${minutes}m`
}

/** Milliseconds until an ISO reset time, or undefined when there is none. */
export function untilReset(resetsAt: string | undefined, now: number): number | undefined {
  if (!resetsAt) return undefined
  const at = Date.parse(resetsAt)
  return Number.isNaN(at) ? undefined : at - now
}

/** "$29.90", "$694.08", "$1.2K", "$3.4M". */
export function formatUsd(usd: number): string {
  if (usd >= 1_000_000) return `$${trim(usd / 1_000_000)}M`
  if (usd >= 1000) return `$${trim(usd / 1000)}K`
  return `$${usd.toFixed(2)}`
}

/** "900", "3.0k", "954.2k", "45.1M", "1.5B": thousands keep one decimal like the reference chips. */
export function formatTokens(tokens: number): string {
  if (tokens >= 1e9) return `${trim(tokens / 1e9)}B`
  if (tokens >= 1e6) return `${trim(tokens / 1e6)}M`
  if (tokens >= 1e3) return `${(tokens / 1e3).toFixed(1)}k`
  return String(Math.round(tokens))
}

// One decimal under 100, none above, so "45.1M" and "450M" stay short.
function trim(n: number): string {
  return n >= 100 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, '')
}

/** A small bar, `width` cells, filled by `percent` (0-100): "▰▰▰▱▱▱▱▱▱▱". */
export function miniBar(percent: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))
  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
}

/**
 * Pac-Man bar for a terminal, `width` cells: Pac-Man sits at how much is used, dots ahead are what is
 * left and eaten cells are blank. Returned in three parts so the caller can color the dots and
 * Pac-Man apart.
 */
export function pacText(percentLeft: number, width = 10): { before: string; pac: string; after: string } {
  const k = Math.max(0, Math.min(width - 1, Math.round((1 - percentLeft / 100) * (width - 1))))
  return { before: ' '.repeat(k), pac: 'ᗧ', after: '·'.repeat(width - 1 - k) }
}

const SPARK = '▁▂▃▄▅▆▇█'

/** One block per value, scaled to the largest: "▁▂▇▃". All zeros draw the lowest block. */
export function sparkline(values: readonly number[]): string {
  const max = Math.max(0, ...values)
  return values.map(v => SPARK[max === 0 ? 0 : Math.min(SPARK.length - 1, Math.round((v / max) * (SPARK.length - 1)))]).join('')
}

/** 15600 -> "15,600". Written by hand: the module environment has no Intl to rely on. */
export function groupDigits(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-10-03" -> "Oct 3"; anything else comes back unchanged. */
export function shortDay(day: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(day)
  return m ? `${MONTHS[Number(m[1]) - 1] ?? m[1]} ${Number(m[2])}` : day
}
