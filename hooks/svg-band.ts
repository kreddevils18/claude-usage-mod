// Draws the band as one SVG for surfaces that have `Svg` (desktop, vscode, mobile): rounded
// pills with line icons, a Pac-Man progress bar, and a tint per metric.
// Every pill carries a <title>, which the interactive SVG shows as a hover tooltip.
// Pure: Segment[] in, markup and size out.
import type { LimitSegment, Segment, TokenKind } from './band-model'
import { ICON, icon, pacBar, pacBarHeight, text, textWidth, tipped } from './svg-kit'
import type { Piece } from './svg-kit'
import type { IconName } from './svg-icons'
import { BAR_COLOR, TONES } from './theme'

const HEIGHT = 28
const PAD = 10
const GAP = 8
const BAR_W = 64
const PAC_R = 5.5
const PAC_DOTS = 9
const TEXT_Y = HEIGHT / 2 + 4
const ICON_Y = (HEIGHT - ICON) / 2
// A reading carried over from an earlier session is drawn paler until a response refreshes it.
const STALE_OPACITY = 0.6

const pill = (x: number, width: number, bg: string, inner: string): string =>
  `<g transform="translate(${x} 0)"><rect width="${width}" height="${HEIGHT}" rx="${HEIGHT / 2}" fill="${bg}"/>${inner}</g>`

const LEAD: Record<LimitSegment['tone'], IconName> = { five: 'gauge', extra: 'gauge', seven: 'calendar', model: 'layers', context: 'pie' }

function limitPill(s: LimitSegment, x: number): Piece {
  const p = TONES[s.tone]
  const pct = `${s.percentLeft}%`
  let cur = PAD
  let inner = icon(LEAD[s.tone], cur, ICON_Y, p.accent)
  cur += ICON + 5
  inner += text(s.label, cur, TEXT_Y, p.ink)
  cur += textWidth(s.label) + 6
  if (!s.slim) {
    inner += pacBar(cur, (HEIGHT - pacBarHeight(PAC_R)) / 2, BAR_W, s.percentLeft, BAR_COLOR[s.severity], p.ink, { dots: PAC_DOTS, radius: PAC_R })
    cur += BAR_W + 6
  }
  inner += text(pct, cur, TEXT_Y, p.ink, { bold: true })
  cur += textWidth(pct)
  if (s.reset) {
    cur += 7
    inner += `<rect x="${cur}" y="7" width="1" height="${HEIGHT - 14}" fill="${p.ink}" fill-opacity="0.2"/>`
    cur += 8
    inner += icon(s.tone === 'five' ? 'clock' : 'history', cur, ICON_Y, p.accent)
    cur += ICON + 4
    inner += text(s.reset, cur, TEXT_Y, p.ink)
    cur += textWidth(s.reset)
  }
  const width = cur + PAD
  return { svg: tipped(s.tip, pill(x, width, p.bg, inner), s.isStale ? STALE_OPACITY : undefined), width }
}

type ChipTone = keyof typeof TONES

function chipPill(x: number, tone: ChipTone, name: IconName, label: string, tip: string): Piece {
  const p = TONES[tone]
  const width = PAD + ICON + 5 + textWidth(label) + PAD
  const inner = icon(name, PAD, ICON_Y, p.accent) + text(label, PAD + ICON + 5, TEXT_Y, p.ink)
  return { svg: tipped(tip, pill(x, width, p.bg, inner)), width }
}

const TOKEN_STYLE: Record<TokenKind, { tone: ChipTone; icon: IconName }> = {
  up: { tone: 'up', icon: 'upload' },
  down: { tone: 'down', icon: 'download' },
  cache: { tone: 'cache', icon: 'layers' },
}

/** One segment as a pill at `x`, so the pane can place the same pills on its own rows. */
export function segmentPill(s: Segment, x: number): Piece {
  if (s.type === 'limit') return limitPill(s, x)
  if (s.type === 'token') return chipPill(x, TOKEN_STYLE[s.kind].tone, TOKEN_STYLE[s.kind].icon, s.text, s.tip)
  return s.kind === 'session' ? chipPill(x, 'session', 'coin', s.text, s.tip) : chipPill(x, 'today', 'trend', s.text, s.tip)
}

const describeSegments = (segments: readonly Segment[]): string =>
  segments
    .map(s =>
      s.type === 'limit'
        ? `${s.name} ${s.percentLeft}% left${s.reset ? `, resets in ${s.reset}` : ''}`
        : s.type === 'token'
          ? `${{ up: 'input', down: 'output', cache: 'cache' }[s.kind]} tokens ${s.text}`
          : s.text,
    )
    .join('; ')

/** The whole band as one SVG document, with its pixel size. */
export function bandSvg(segments: readonly Segment[]): { source: string; width: number; height: number; alt: string } {
  let x = 0
  let body = ''
  for (const seg of segments) {
    const piece = segmentPill(seg, x)
    body += piece.svg
    x += piece.width + GAP
  }
  const width = Math.max(1, x - GAP)
  const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${HEIGHT}" width="${width}" height="${HEIGHT}">${body}</svg>`
  return { source, width, height: HEIGHT, alt: describeSegments(segments) }
}

/** Pixel width the band would take, to pick the richest tier that fits. */
export const bandWidth = (segments: readonly Segment[]): number => bandSvg(segments).width
