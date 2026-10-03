// Draws the Details pane as one SVG card for surfaces that have `Svg`. One visual language
// with the band: tinted rounded rows with the same icons, Pac-Man bars and tooltips; sections
// are spaced evenly and the spend rows are justified, label left and figures right.
// Pure: PaneModel in, markup and size out.
import type { PaneModel } from './pane-model'
import { shortDay } from './format'
import { segmentPill } from './svg-band'
import { ICON, SANS_FAMILY, icon, pacBar, pacBarHeight, text, tipped } from './svg-kit'
import type { IconName } from './svg-icons'
import { BAR_COLOR, TONES } from './theme'
import type { Tone } from './band-model'

const DEFAULT_WIDTH = 440
// Cards run edge to edge of the panel, so there is no horizontal padding; text inside a card
// keeps its own inset. Only the top and bottom of the stack have a little air.
const PAD = 0
const EDGE = 4
const HEAD_X = 2
// Laid out at the panel's real width: set at the start of each paneSvg call.
let W = DEFAULT_WIDTH
let INNER = W
const RADIUS = 14
// Space between rows inside a section, and between sections.
const ROW_GAP = 8
const SECTION_GAP = 22
const LIMIT_ROW = 46
const SPEND_ROW = 34
const PILL_H = 28

const CARD = { bg: '#f6f4ef', edge: '#e3dfd6', ink: '#2b2a26', dim: '#8a8578', well: '#ebe8e1', rule: '#d9d5cb' }
const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace'
const LEAD: Record<Tone, IconName> = { five: 'gauge', extra: 'gauge', seven: 'calendar', model: 'layers', context: 'pie' }
const PAC_R = 6
const STALE_OPACITY = 0.6

const heading = (label: string, y: number) => text(label, HEAD_X, y + 9, CARD.dim, { bold: true, size: 10.5, spacing: 1.4, family: SANS_FAMILY })

function countRow(s: Extract<PaneModel['limits'][number], { type: 'count' }>, y: number): string {
  const p = TONES[s.tone]
  const right = W - PAD - 14
  const mid = y + LIMIT_ROW / 2
  const inner =
    `<rect x="${PAD}" y="${y}" width="${INNER}" height="${LIMIT_ROW}" rx="${RADIUS}" fill="${p.bg}"/>` +
    `<circle cx="${PAD + 24}" cy="${mid}" r="14" fill="#ffffff" fill-opacity="0.65"/>` +
    icon('history', PAD + 24 - ICON / 2, mid - ICON / 2, p.accent) +
    text(s.name, PAD + 48, y + 20, p.ink, { bold: true, size: 13, family: SANS_FAMILY }) +
    text(s.detail, PAD + 48, y + 35, p.ink, { size: 11, opacity: 0.65, family: SANS_FAMILY }) +
    text(s.value, right, mid + 5, p.ink, { bold: true, size: 14, anchor: 'end', family: MONO })
  return tipped(s.tip, inner)
}

function emptyRow(s: Extract<PaneModel['limits'][number], { type: 'empty' }>, y: number): string {
  const p = TONES[s.tone]
  const right = W - PAD - 14
  const barW = Math.max(96, W - 292)
  const barX = right - 52 - barW
  const mid = y + LIMIT_ROW / 2
  const inner =
    `<g opacity="0.8"><rect x="${PAD}" y="${y}" width="${INNER}" height="${LIMIT_ROW}" rx="${RADIUS}" fill="${p.bg}"/>` +
    `<circle cx="${PAD + 24}" cy="${mid}" r="14" fill="#ffffff" fill-opacity="0.65"/>` +
    icon(LEAD[s.tone], PAD + 24 - ICON / 2, mid - ICON / 2, p.accent) +
    text(s.name, PAD + 48, y + 20, p.ink, { bold: true, size: 13, family: SANS_FAMILY }) +
    text(s.detail, PAD + 48, y + 35, p.ink, { size: 11, opacity: 0.65, family: SANS_FAMILY }) +
    `<rect x="${barX}" y="${mid - pacBarHeight(PAC_R) / 2}" width="${barW}" height="${pacBarHeight(PAC_R)}" rx="${pacBarHeight(PAC_R) / 2}" fill="${p.ink}" fill-opacity="0.1"/>` +
    text(s.note, right, mid + 5, p.ink, { size: 12, anchor: 'end', opacity: 0.55, family: MONO }) +
    '</g>'
  return tipped(s.tip, inner)
}

function limitRow(s: Extract<PaneModel['limits'][number], { type: 'limit' }>, y: number): string {
  const p = TONES[s.tone]
  const right = W - PAD - 14
  const barW = Math.max(96, W - 292)
  const barX = right - 52 - barW
  const mid = y + LIMIT_ROW / 2
  const inner =
    `<rect x="${PAD}" y="${y}" width="${INNER}" height="${LIMIT_ROW}" rx="${RADIUS}" fill="${p.bg}"/>` +
    `<circle cx="${PAD + 24}" cy="${mid}" r="14" fill="#ffffff" fill-opacity="0.65"/>` +
    icon(LEAD[s.tone], PAD + 24 - ICON / 2, mid - ICON / 2, p.accent) +
    text(s.name, PAD + 48, y + (s.detail ? 20 : 27), p.ink, { bold: true, size: 13, family: SANS_FAMILY }) +
    (s.detail ? text(s.detail, PAD + 48, y + 35, p.ink, { size: 11, opacity: 0.65, family: SANS_FAMILY }) : '') +
    pacBar(barX, mid - pacBarHeight(PAC_R) / 2, barW, s.percentLeft, BAR_COLOR[s.severity], p.ink, { dots: 22, radius: PAC_R }) +
    text(`${s.percentLeft}%`, right, mid + 5, p.ink, { bold: true, size: 15, anchor: 'end', family: MONO })
  return tipped(s.tip, inner, s.isStale ? STALE_OPACITY : undefined)
}

/** Pills wrapped onto rows that fit the card; returns the markup and its height. */
function pillRows(segments: PaneModel['session'], y: number): { svg: string; height: number } {
  let x = PAD
  let row = 0
  let svg = ''
  for (const seg of segments) {
    const piece = segmentPill(seg, 0)
    if (x > PAD && x + piece.width > W - PAD) {
      x = PAD
      row++
    }
    svg += `<g transform="translate(${x} ${y + row * (PILL_H + ROW_GAP)})">${piece.svg}</g>`
    x += piece.width + ROW_GAP
  }
  return { svg, height: (row + 1) * PILL_H + row * ROW_GAP }
}

function spendBlock(rows: PaneModel['spend'], y: number): { svg: string; height: number } {
  const height = rows.length * SPEND_ROW + 8
  const right = W - PAD - 14
  let svg = `<rect x="${PAD}" y="${y}" width="${INNER}" height="${height}" rx="${RADIUS}" fill="${CARD.well}"/>`
  rows.forEach((r, i) => {
    const top = y + 4 + i * SPEND_ROW
    const base = top + SPEND_ROW / 2 + 4.5
    const line = i > 0 ? `<rect x="${PAD + 14}" y="${top}" width="${INNER - 28}" height="1" fill="${CARD.rule}"/>` : ''
    svg += tipped(
      r.tip,
      line +
        text(r.label, PAD + 14, base, CARD.ink, { size: 13, family: SANS_FAMILY }) +
        text(r.usd, right - 112, base, CARD.ink, { bold: true, size: 13, anchor: 'end', family: MONO }) +
        text(r.tokens, right, base, CARD.dim, { size: 12, anchor: 'end', family: MONO }),
    )
  })
  return { svg, height }
}

function trendBlock(trend: PaneModel['trend'], peak: string | undefined, y: number): { svg: string; height: number } {
  const chartH = 46
  const top = 38
  const height = top + chartH + 24
  const right = W - PAD - 14
  const left = PAD + 14
  const n = trend.length
  const gap = 6
  const barW = (right - left - gap * (n - 1)) / n
  const max = Math.max(1, ...trend.map(t => t.usd))
  let svg =
    `<rect x="${PAD}" y="${y}" width="${INNER}" height="${height}" rx="${RADIUS}" fill="${CARD.well}"/>` +
    text(`Last ${n} days`, left, y + 24, CARD.ink, { size: 13, family: SANS_FAMILY }) +
    (peak ? text(`peak ${peak}`, right, y + 24, CARD.dim, { size: 12, anchor: 'end', family: MONO }) : '')
  trend.forEach((t, i) => {
    const h = Math.max(3, Math.round((t.usd / max) * chartH))
    const x = left + i * (barW + gap)
    const isToday = i === n - 1
    svg += tipped(t.tip, `<rect x="${x.toFixed(1)}" y="${y + top + chartH - h}" width="${barW.toFixed(1)}" height="${h}" rx="3" fill="${isToday ? '#3f8f5b' : '#b9cdbf'}"/>`)
  })
  svg += text(shortDay(trend[0].day), left, y + height - 8, CARD.dim, { size: 10.5, family: SANS_FAMILY })
  svg += text(shortDay(trend[n - 1].day), right, y + height - 8, CARD.dim, { size: 10.5, anchor: 'end', family: SANS_FAMILY })
  return { svg, height }
}

export function paneSvg(m: PaneModel, width = DEFAULT_WIDTH): { source: string; width: number; height: number; alt: string } {
  W = Math.max(300, Math.round(width))
  INNER = W - 2 * PAD
  let y = EDGE
  let body = ''
  const section = (label: string) => {
    body += heading(label, y)
    y += 14 + ROW_GAP
  }

  section('LIMITS')
  if (m.limits.length === 0) {
    body += text('No reading yet; it arrives with the first response.', HEAD_X, y + 12, CARD.dim, { size: 12, family: SANS_FAMILY })
    y += 24
  }
  m.limits.forEach((l, i) => {
    body += l.type === 'empty' ? emptyRow(l, y) : l.type === 'count' ? countRow(l, y) : limitRow(l, y)
    y += LIMIT_ROW + (i < m.limits.length - 1 ? ROW_GAP : 0)
  })

  if (m.session.length > 0) {
    y += SECTION_GAP
    section('THIS SESSION')
    const rows = pillRows(m.session, y)
    body += rows.svg
    y += rows.height
  }

  if (m.spend.length > 0) {
    y += SECTION_GAP
    section('SPEND')
    const block = spendBlock(m.spend, y)
    body += block.svg
    y += block.height
    if (m.trend.length > 1) {
      y += ROW_GAP
      const t = trendBlock(m.trend, m.peak, y)
      body += t.svg
      y += t.height
    }
  }

  if (m.note) {
    y += 14
    body += text(m.note, HEAD_X, y + 8, CARD.dim, { size: 11, family: SANS_FAMILY })
    y += 12
  }

  const height = y + EDGE
  const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${W}" height="${height}">${body}</svg>`
  const alt = [
    ...m.limits.map(l => (l.type === 'empty' ? `${l.name} no data` : l.type === 'count' ? `${l.name} ${l.value}` : `${l.name} ${l.percentLeft}% left`)),
    ...m.session.map(s => (s.type === 'token' ? `${s.kind} tokens ${s.text}` : `session ${s.text}`)),
    ...m.spend.map(r => `${r.label} ${r.usd}`),
  ].join('; ')
  return { source, width: W, height, alt }
}
