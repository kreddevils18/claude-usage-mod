// Colors shared by the SVG band (desktop) and the Text band (terminal).
// Each metric has an opaque tint with its own ink, so a pill reads the same on light and dark themes.
import type { Severity } from './limits'
import type { Tone } from './band-model'

type Palette = { bg: string; ink: string; accent: string }

export const TONES: Record<Tone | 'up' | 'down' | 'cache' | 'session' | 'today', Palette> = {
  five: { bg: '#dcebe0', ink: '#25402f', accent: '#3f8f5b' },
  seven: { bg: '#e4defa', ink: '#35286a', accent: '#7357d4' },
  model: { bg: '#f0dcf5', ink: '#4a2a63', accent: '#a24fc9' },
  extra: { bg: '#e5e7eb', ink: '#374151', accent: '#6b7280' },
  context: { bg: '#d9ecf2', ink: '#1e3d4a', accent: '#2b8aa8' },
  up: { bg: '#f7dcd5', ink: '#7a2a1e', accent: '#d4553d' },
  down: { bg: '#dcebdf', ink: '#25402f', accent: '#3f8f5b' },
  cache: { bg: '#dde3f7', ink: '#27346b', accent: '#4a63d4' },
  session: { bg: '#efe5cc', ink: '#5a4310', accent: '#b8860b' },
  today: { bg: '#ebe7df', ink: '#4a4437', accent: '#8a7f66' },
}

/** The bar and dot take the state's color, never the tone's, so green/yellow/red keep one meaning. */
export const BAR_COLOR: Record<Severity, string> = { ok: '#4f9d69', warn: '#d9a21b', crit: '#d9534f' }
