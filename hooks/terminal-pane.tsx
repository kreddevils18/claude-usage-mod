// The Details pane for the terminal, from the same PaneModel the desktop draws as an SVG card:
// sections spaced by one blank row, and every label/figure pair justified to the pane's edges.
import type { BoxProps, ElementConstructor, RenderElement, TextProps } from 'claude-code'

import { chipRow } from './terminal-band'
import { sparkline } from './format'
import type { PaneModel } from './pane-model'

type Els = { Box: ElementConstructor<BoxProps>; Text: ElementConstructor<TextProps> }

function Row({ Box, Text }: Els, key: string, label: string, value: string, o: { bold?: boolean; dim?: boolean } = {}): RenderElement {
  return (
    <Box key={key} width="100%" justifyContent="space-between">
      <Text dimColor={o.dim}>{label}</Text>
      <Text bold={o.bold}>{value}</Text>
    </Box>
  )
}

function Section({ Box, Text }: Els, title: string, children: RenderElement[]): RenderElement {
  return (
    <Box key={title} flexDirection="column">
      <Text bold dimColor>{title}</Text>
      {children}
    </Box>
  )
}

export function terminalPane(els: Els, m: PaneModel): RenderElement {
  const { Box, Text } = els
  const sections: RenderElement[] = []

  sections.push(
    Section(els, 'LIMITS', [
      chipRow(els, m.limits.filter((l): l is Extract<typeof l, { type: 'limit' }> => l.type === 'limit')),
      ...m.limits.flatMap(l => (l.type === 'empty' ? [Row(els, l.name, l.name, l.note, { dim: true })] : l.type === 'count' ? [Row(els, l.name, l.name, l.value, { bold: true })] : [])),
    ]),
  )
  if (m.session.length > 0) sections.push(Section(els, 'THIS SESSION', [chipRow(els, m.session)]))

  if (m.spend.length > 0) {
    const rows = m.spend.map(r => Row(els, r.label, r.label, `${r.usd}   ${r.tokens}`))
    if (m.trend.length > 1) {
      rows.push(Row(els, 'trend', `Last ${m.trend.length} days`, `${sparkline(m.trend.map(d => d.usd))}${m.peak ? `  peak ${m.peak}` : ''}`, { dim: true }))
    }
    sections.push(Section(els, 'SPEND', rows))
  }

  return (
    <Box flexDirection="column" gap={1}>
      {sections}
      {m.note ? <Text dimColor>{m.note}</Text> : null}
    </Box>
  )
}
