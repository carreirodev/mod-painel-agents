// The pane's colours and the way it writes times and counts, shared by the
// agent cards and the plan blocks inside them

export const INK = '#0b0b0b' // text over a colored badge
export const FRAME = '#64748b'
export const HEADING = '#e2e8f0'
export const CLOCK = '#67e8f9'
export const LABEL = '#6b7280'
export const VALUE = '#e5e7eb'
export const FADED = '#4b5563'

const pad = (n: number) => String(n).padStart(2, '0')

// 75_000 -> "1:15", 3_725_000 -> "1:02:05"
export function stopwatch(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds % 60)}` : `${minutes}:${pad(seconds % 60)}`
}

export function clockOf(now: number): string {
  const date = new Date(now)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
