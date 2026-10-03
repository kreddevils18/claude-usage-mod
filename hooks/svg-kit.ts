// Drawing primitives shared by the band and the pane SVGs: text, icons, the dithered bar,
// and tooltip wrappers. Pure string builders, no engine.
import { ICONS } from './svg-icons'
import type { IconName } from './svg-icons'

export const FONT = 12
// Monospace at 12px is about 7.2px per character; text is sized from that.
export const CHAR = 7.2
export const FONT_FAMILY = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace'
// Single quotes inside: the value sits in a double-quoted attribute.
export const SANS_FAMILY = "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif"
export const ICON = 14

export const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export const textWidth = (t: string) => Math.ceil(t.length * CHAR)

export type Piece = { svg: string; width: number }

/** A line icon drawn at (x, y), `size` px, in `color`. */
export const icon = (name: IconName, x: number, y: number, color: string, size = ICON): string =>
  `<g transform="translate(${x} ${y}) scale(${size / 16})" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</g>`

type TextOpts = { bold?: boolean; size?: number; anchor?: 'start' | 'middle' | 'end'; opacity?: number; family?: string; spacing?: number }

export function text(t: string, x: number, y: number, color: string, o: TextOpts = {}): string {
  const attrs =
    `font-family="${o.family ?? FONT_FAMILY}" font-size="${o.size ?? FONT}" fill="${color}"` +
    (o.bold ? ' font-weight="700"' : '') +
    (o.anchor && o.anchor !== 'start' ? ` text-anchor="${o.anchor}"` : '') +
    (o.opacity !== undefined ? ` fill-opacity="${o.opacity}"` : '') +
    (o.spacing ? ` letter-spacing="${o.spacing}"` : '')
  return `<text x="${x}" y="${y}" ${attrs}>${esc(t)}</text>`
}

/** Wraps markup in a group whose `<title>` is the hover tooltip (drawn when the SVG is interactive). */
export const tipped = (tip: string, inner: string, opacity?: number): string =>
  `<g${opacity !== undefined ? ` opacity="${opacity}"` : ''}><title>${esc(tip)}</title>${inner}</g>`

const PAC_COLOR = '#f6c744'
const PAC_EDGE = '#8a6500'
// Half-angle of the mouth in radians, open and shut; the chomp animates between them.
const MOUTH_OPEN = 0.62
const MOUTH_SHUT = 0.05

/** Pac-Man facing right: a pie with a wedge cut out, as one path so its mouth can be animated. */
const pacPath = (cx: number, cy: number, r: number, half: number): string => {
  const dx = (r * Math.cos(half)).toFixed(2)
  const dy = (r * Math.sin(half)).toFixed(2)
  return `M${cx} ${cy}L${(cx + Number(dx)).toFixed(2)} ${(cy - Number(dy)).toFixed(2)}A${r} ${r} 0 1 0 ${(cx + Number(dx)).toFixed(2)} ${(cy + Number(dy)).toFixed(2)}Z`
}

export type PacBarOpts = { dots: number; radius: number }

/**
 * A usage bar as Pac-Man eating dots. Pac-Man sits at how much is used; the dots ahead of it are
 * what is left (`percentLeft`), colored by state. The mouth chomps when the SVG is interactive (SMIL needs the frame).
 */
export function pacBar(x: number, y: number, w: number, percentLeft: number, dotColor: string, ink: string, o: PacBarOpts): string {
  const r = o.radius
  const h = r * 2 + 2
  const span = w - 2 * r
  const used = 1 - Math.max(0, Math.min(100, percentLeft)) / 100
  const cx = r + used * span
  const cy = h / 2
  let dots = ''
  let nextBlinks = true
  for (let i = 0; i < o.dots; i++) {
    const dx = r + ((i + 0.5) * span) / o.dots
    if (dx <= cx) continue
    const blink = nextBlinks ? '<animate attributeName="opacity" values="1;0.25;1" dur="0.9s" repeatCount="indefinite"/>' : ''
    nextBlinks = false
    dots += `<circle cx="${dx.toFixed(1)}" cy="${cy}" r="1.5">${blink}</circle>`
  }
  const open = pacPath(cx, cy, r, MOUTH_OPEN)
  const shut = pacPath(cx, cy, r, MOUTH_SHUT)
  return (
    `<g transform="translate(${x} ${y})">` +
    `<rect width="${w}" height="${h}" rx="${h / 2}" fill="${ink}" fill-opacity="0.12"/>` +
    `<g fill="${dotColor}">${dots}</g>` +
    `<path d="${open}" fill="${PAC_COLOR}" stroke="${PAC_EDGE}" stroke-width="0.8" stroke-linejoin="round">` +
    `<animate attributeName="d" values="${open};${shut};${open}" dur="0.5s" repeatCount="indefinite"/></path>` +
    `<circle cx="${(cx + r * 0.1).toFixed(1)}" cy="${(cy - r * 0.5).toFixed(1)}" r="0.9" fill="${PAC_EDGE}"/>` +
    `</g>`
  )
}

/** Height of the Pac-Man bar for a given radius, so callers can center it in a row. */
export const pacBarHeight = (radius: number): number => radius * 2 + 2
