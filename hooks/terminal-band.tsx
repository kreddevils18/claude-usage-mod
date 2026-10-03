// Draws a Segment[] with Box and Text, which every surface has: colored chips with a mini bar.
// The terminal uses it for the band; the pane uses it on every surface.
import type { BoxProps, ElementConstructor, RenderElement, TextProps } from 'claude-code'

import type { LimitSegment, Segment } from './band-model'
import { pacText } from './format'
import { BAR_COLOR, TONES } from './theme'

type Els = { Box: ElementConstructor<BoxProps>; Text: ElementConstructor<TextProps> }

const LEAD = { five: '◔', seven: '▦', model: '≡', extra: '◔', context: '◑' } as const

// Pac-Man's yellow reads poorly on a pale chip, so the terminal draws it in its darker edge color.
const PAC_INK = '#b8860b'

function limitChip({ Text }: Els, s: LimitSegment): RenderElement {
  const p = TONES[s.tone]
  const bar = pacText(s.percentLeft)
  return (
    <Text key={`limit-${s.label}`} backgroundColor={p.bg} color={p.ink}>
      {' '}
      <Text color={p.accent}>{LEAD[s.tone]}</Text> {s.label}{' '}
      {s.slim ? null : (
        <Text>
          <Text color={BAR_COLOR[s.severity]}>{bar.before}</Text>
          <Text color={PAC_INK} bold>{bar.pac}</Text>
          <Text color={BAR_COLOR[s.severity]}>{bar.after}</Text>{' '}
        </Text>
      )}
      <Text bold>{s.percentLeft}%</Text>
      {s.reset ? <Text color={p.accent}> ↻ {s.reset}</Text> : null}{' '}
    </Text>
  )
}

function plainChip({ Text }: Els, key: string, tone: keyof typeof TONES, glyph: string, text: string): RenderElement {
  const p = TONES[tone]
  return (
    <Text key={key} backgroundColor={p.bg} color={p.ink}>
      {' '}
      <Text color={p.accent}>{glyph}</Text>
      {text}{' '}
    </Text>
  )
}

const TOKEN_GLYPH = { up: '↑', down: '↓', cache: '◈' } as const

function chipOf(els: Els, s: Segment): RenderElement {
  if (s.type === 'limit') return limitChip(els, s)
  if (s.type === 'token') return plainChip(els, s.kind, s.kind, TOKEN_GLYPH[s.kind], s.text)
  return s.kind === 'session' ? plainChip(els, 'session', 'session', '$', s.text.replace('$', '')) : plainChip(els, 'today', 'today', '↗', s.text)
}

/** One row of chips separated by a space; wraps when the row is wider than the band. */
export function chipRow(els: Els, segments: readonly Segment[]): RenderElement {
  const { Box } = els
  return (
    <Box flexWrap="wrap" columnGap={1}>
      {segments.map(s => chipOf(els, s))}
    </Box>
  )
}

/** Terminal cells one chip takes: its text plus the padding and glyph around it. */
function chipCells(s: Segment): number {
  if (s.type === 'limit') return 4 + s.label.length + 1 + (s.slim ? 0 : 11) + String(s.percentLeft).length + 1 + (s.reset ? 3 + s.reset.length : 0) + 1
  return s.text.length + 3
}

/** Terminal cells the chips take, with the one-cell gaps, to pick the richest tier that fits. */
export function cellWidth(segments: readonly Segment[]): number {
  return segments.reduce((sum, s) => sum + chipCells(s), 0) + Math.max(0, segments.length - 1)
}
