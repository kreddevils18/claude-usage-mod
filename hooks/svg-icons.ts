// Line icons on a 16x16 grid, drawn here so the band needs no icon font or asset.
// Each value is the inner markup of an <svg>; the caller sets stroke color and width.
export const ICONS = {
  gauge: '<path d="M2.5 11.5a5.5 5.5 0 1 1 11 0"/><path d="M8 11.5l2.6-3.6"/>',
  clock: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/>',
  history: '<path d="M2.5 8a5.5 5.5 0 1 0 1.8-4.1"/><path d="M2.3 2.6v2.7h2.7"/><path d="M8 5.2V8l1.8 1.2"/>',
  calendar: '<rect x="2.5" y="3.5" width="11" height="10" rx="2"/><path d="M2.5 6.8h11M5.5 2v3M10.5 2v3"/>',
  upload: '<path d="M3 10.5V12a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 12v-1.5"/><path d="M8 10V2.8M5.2 5.4 8 2.6l2.8 2.8"/>',
  download: '<path d="M3 10.5V12a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 12v-1.5"/><path d="M8 2.8V10M5.2 7.6 8 10.4l2.8-2.8"/>',
  layers: '<path d="M8 2 14 5.2 8 8.4 2 5.2z"/><path d="M2 8.2l6 3.2 6-3.2M2 11l6 3.2 6-3.2"/>',
  coin: '<circle cx="8" cy="8" r="5.8"/><path d="M8 4.6v6.8M9.9 6.3C9.5 5.6 8.8 5.4 8 5.4c-1 0-1.8.5-1.8 1.3s.8 1.1 1.8 1.3 1.8.5 1.8 1.4S9 10.8 8 10.8c-.9 0-1.6-.3-2-1"/>',
  pie: '<circle cx="8" cy="8" r="5.5"/><path d="M8 2.5V8h5.5"/>',
  trend: '<path d="M2 11.5 6 7.5l2.6 2.6L14 4.8"/><path d="M10.4 4.5H14v3.6"/>',
} as const

export type IconName = keyof typeof ICONS
