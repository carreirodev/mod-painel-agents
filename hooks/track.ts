// A plan's bar as terminal cells for a Raster: a track whose fill is braille
// dots, sparse at the start and dense at the head, with a wave of light running
// from the head towards the start and cells flickering; stage lines and step
// dots on it; and a pill riding the head. Drawn as plan-progress 1.4.2 draws its
// terminal track (trackCells), in the pane's colours. Pure: no $

import type { Plan, PlanState } from '../types'
import { atHead, percentOf } from './plan'

// The colours of the mockup the issue approved, one per plan state
export const PLAN_COLORS: Record<PlanState, string> = {
  running: '#22c55e',
  needs_input: '#f59e0b',
  error: '#ef4444',
  done: '#14b8a6',
}
const PILL_INK = '#0b0b0b'
// The terminal's background the track is mixed from: a dark terminal, as the pane's own colours assume
const TERM_BG = [24, 24, 27]
// The terminal's default colour, for a cell left to the terminal (the capsule's ends)
const DEFAULT = 0x01000000

// ---------- cells a Raster takes ----------

// A Raster cell takes one printable BMP character exactly one column wide; any
// other refuses the whole tree. NOT_ONE lists the printable BMP characters whose
// width is not one, as base-36 "start-extra" ranges (from plan-progress)
const NOT_ONE =
  '4t,lc-33,w3-6,13l-18,14v,14x-1,150-1,153,16o-5,174-a,17g,18r-k,19s,1cm-7,1cv-5,1d3-1,1d6-3,1e7,1e9,1f4-q,1ie-a,1kb-8,1kt,1li-3,1ln-8,1lx-2,1m1-4,1nd-2,1p3-8,1qi-1k,1tm-2,1tq-f,1u9-6,1uq-1,1vk-2,1x6-2,1xa-f,1xt-6,1ya-1,1z2,1z4-2,20q-2,20u-f,21d-6,21u-1,228-1,22d,22o-2,24a-2,24e-f,24x-6,25e-1,262-8,27u-2,27y-f,28h-6,28y-1,29s-2,2be-2,2bi-f,2c1-6,2ci-1,2dc-2,2dg,2ey-2,2f2-f,2fl-6,2g2-1,2gw-2,2ii-2,2im-f,2j5-6,2jm-1,2kg-2,2m2-2,2m6-f,2n6-1,2o1,2q2,2qa-2,2qe,2sx,2t0-6,2tj-7,2wh,2wk-8,2x4-6,2zc-1,305,307,309,31t-d,328-4,32e-1,32l-a,32x-z,346,371-3,376-5,37d-1,37h-1,388-1,38e-2,38x-3,39e,39h-1,39p,3a5,3cw-73,3tp-2,4k2-2,4ky-1,4lu-1,4mq-1,4ok-1,4on-6,4p2,4p5-a,4pp,4qz-4,4ud-1,4vd,4yo-2,4yv-1,4z6,4zd-2,55j-1,55n,57a,57c-6,57k,57m,57p-7,583-9,58f,59s-2b,5dg,5di-4,5do,5du,5ez-8,5fk-1,5gi-3,5go-1,5gr-2,5ie,5ig-1,5il,5in-2,5kc-7,5km-1,5ow-2,5p0-c,5pe-6,5pp,5pw,5q0-1,5vk-1r,6bv-4,6cq-4,6e8-f,6hc-1b,6xm-1,6y1-1,73d-3,73k,73n,7i5-1,7is-1,7jk-7,7k8-b,7lr,7m2-5,7mb,7mp,7my-1,7nh-1,7no-1,7ny,7o4,7oq,7oy-1,7p1,7p6,7p9,7ph,7pm-1,7qg,7rg,7ri,7rn-2,7rr,7th-2,7u8,7un,8ij-1,8k0,8k5,8vj-2,8zj,928-v,96o-p,97f-2g,9a8-5x,9gw-26,9j5-2d,9ll-2u,9ol-16,9pt-2l,9sg-2d,9v3-1b,9wg-13,9xs-mkc,wi8-1i,wvj-3,wvo-9,wwu-1,wz4-1,x6q,x6u,x6z,x7p-1,x7w,xc4-1,xcw-h,xdr,xeu-7,xfr-a,xgg-s,xhc-2,xir,xiu-3,xj0-1,xk5,xm1-5,xm9-1,xmd-1,xmr,xn0,xoc,xps,xpu-2,xpz-1,xq6-1,xq9,xrg-1,xrq,xyd,xyg,xyl,xz4-8mb,16ls-27,1d6o-e7,1dlq,1e68-p,1e74-1e,1e8k-i,1e94-3,1edb,1edd-2n,1ejk-6'
const notOne = NOT_ONE.split(',').map(r => {
  const [a = '0', n] = r.split('-')
  const from = parseInt(a, 36)
  return [from, from + (n ? parseInt(n, 36) : 0)] as const
})
function isNotOne(cp: number) {
  let lo = 0
  let hi = notOne.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const [from, to] = notOne[mid] ?? [0, 0]
    if (cp < from) hi = mid - 1
    else if (cp > to) lo = mid + 1
    else return true
  }
  return false
}
// Marks and format characters take no cell and go; anything else that cannot
// fill exactly one cell is drawn as a middle dot
const cellChar = (ch: string) => {
  if (/\p{M}|\p{Cf}/u.test(ch)) return ''
  const cp = ch.codePointAt(0) ?? 63
  const isControl = cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)
  return isControl || cp > 0xffff || (cp >= 0xd800 && cp <= 0xdfff) || isNotOne(cp) ? '·' : ch
}
// An emoji sequence is one picture, found a grapheme cluster at a time
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const clusters = (s: string): string[] => Array.from(segmenter.segment(s), x => x.segment)
const isEmojiCluster = (c: string) =>
  /⃣|\p{Regional_Indicator}/u.test(c) ||
  (/\p{Extended_Pictographic}/u.test(c) && (/[️‍\u{1F3FB}-\u{1F3FF}]/u.test(c) || (c.codePointAt(0) ?? 0) > 0xffff))
const cellText = (s: string) =>
  clusters(s)
    .map(c => (isEmojiCluster(c) ? '·' : [...c].map(cellChar).join('')))
    .join('')
const cellsOf = (s: string) => [...cellText(s)].length
const fit = (s: string, w: number) => {
  const chars = [...cellText(s)]
  if (chars.length <= w) return chars.join('')
  return w <= 1 ? '…'.slice(0, w) : chars.slice(0, w - 1).join('').trimEnd() + '…'
}

type Cell = [number, number, number]

class Grid {
  cells: Cell[]
  constructor(readonly columns: number) {
    this.cells = Array.from({ length: columns }, (): Cell => [32, DEFAULT, DEFAULT])
  }
  set(x: number, ch: string | number, fg: number, bg: number) {
    if (x < 0 || x >= this.columns) return
    this.cells[x] = [typeof ch === 'number' ? ch : (ch.codePointAt(0) ?? 32), fg, bg]
  }
  text(x: number, s: string, fg: number, bg: number) {
    let i = 0
    for (const ch of cellText(s)) {
      this.set(x + i, ch, fg, bg)
      i++
    }
    return i
  }
  encode() {
    const words = new Uint32Array(this.cells.length * 3)
    this.cells.forEach((c, i) => words.set(c, i * 3))
    return toBase64(new Uint8Array(words.buffer))
  }
}

// Standard padded base64, as a Raster's cells are packed; written out because
// the typings this module is checked against do not know Uint8Array.toBase64
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    s += B64[(n >> 18) & 63] ?? ''
    s += B64[(n >> 12) & 63] ?? ''
    s += i + 1 < bytes.length ? (B64[(n >> 6) & 63] ?? '') : '='
    s += i + 2 < bytes.length ? (B64[n & 63] ?? '') : '='
  }
  return s
}
function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '')
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let n = 0
  let bits = 0
  let at = 0
  for (const ch of clean) {
    n = (n << 6) | B64.indexOf(ch)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes[at++] = (n >> bits) & 255
    }
  }
  return bytes
}

// ---------- colour ----------

const hex = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
const mix = (a: number[], b: number[], m: number) => a.map((v, i) => Math.round(v + ((b[i] ?? 0) - v) * m))
const pack = (c: number[]) => ((c[0] ?? 0) << 16) | ((c[1] ?? 0) << 8) | (c[2] ?? 0)
const LEVELS = 8
const q = (m: number) => Math.round(Math.max(0, Math.min(1, m)) * LEVELS) / LEVELS

// ---------- the fill's wave and flicker ----------

const BRAILLE_BITS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
]
const STREAM_COLS = 233 // the wave's pattern in columns, prime and long, so its loop does not show
const STREAM_SPEED = 20 // columns a second; a plan at rest (waiting, failed, done) streams at half that
const STREAM_LEVELS = [0.3, 0.37, 0.44, 0.51] // the dots' brightness at each step of the wave
const FLICKER_CLASSES = 24
const FLICKER_LIFTS = [0, 0.35, 0.6, 0.9]
const FLICKER_TICK = 0.05
// the share of cells that show one bright dot instead of their grid at the top of their flicker
const SPARK_SHARE = 0.35
// [share of the fill, opacity]: the grid fades in to full at two thirds; the flicker later and steeper
const STREAM_FADE: [number, number][] = [
  [0, 0],
  [0.67, 1],
  [1, 1],
]
const FLICKER_FADE: [number, number][] = [
  [0, 0],
  [0.15, 0],
  [0.5, 0.45],
  [0.8, 0.9],
  [1, 1],
]

const streamHash = (a: number, b: number, k: number) => {
  let x = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(k, 1442695041)) | 0
  x = Math.imul(x ^ (x >>> 13), 1274126177)
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296
}
// Where a bar starts dealing its dots, from its id (FNV-1a), so no two bars show the same dots
const seedOf = (id: string) => {
  let x = 2166136261
  for (let i = 0; i < id.length; i++) x = Math.imul(x ^ id.charCodeAt(i), 16777619)
  return (x >>> 0) % 9973
}
// The wave: noise over STREAM_COLS columns, smoothed to blobs and cut into steps
const STREAM_STEPS = (() => {
  const raw = Array.from({ length: STREAM_COLS }, (_, i) => streamHash(i, 0, 5))
  const smooth = raw.map((_, i) => {
    let sum = 0
    let weight = 0
    for (let d = -5; d <= 5; d++) {
      const k = Math.exp(-(d * d) / 12.5)
      sum += (raw[(i + d + STREAM_COLS) % STREAM_COLS] ?? 0) * k
      weight += k
    }
    return sum / weight
  })
  const lo = Math.min(...smooth)
  const hi = Math.max(...smooth)
  return smooth.map(v => Math.min(STREAM_LEVELS.length - 1, Math.floor(((v - lo) / (hi - lo)) * STREAM_LEVELS.length)))
})()
// The flicker: each cell is dealt one class, each class a timeline of lifts
// (a random walk over FLICKER_LIFTS) of its own length and start
const FLICKER = Array.from({ length: FLICKER_CLASSES }, (_, k) => {
  const length = Math.round((2.3 + 2.4 * streamHash(k, 1, 11)) / FLICKER_TICK)
  const lifts: [number, number][] = []
  let level = 0
  let shown = -1
  for (let t = 0, i = 0; t < length - 1; i++) {
    if (level !== shown) lifts.push([t, level])
    shown = level
    t += Math.max(1, Math.round((0.07 + 0.23 * streamHash(k, i, 13)) / FLICKER_TICK))
    const u = streamHash(k, i, 15)
    level = u < 0.4 ? Math.max(0, level - 1) : u < 0.8 ? Math.min(3, level + 1) : 0
  }
  return { lifts, length, delay: Math.round(streamHash(k, 2, 16) * length) }
})
function liftStep(k: number, ms: number): number {
  const f = FLICKER[k]
  if (!f) return 0
  const at = (((Math.floor(ms / (FLICKER_TICK * 1000)) + f.delay) % f.length) + f.length) % f.length
  let level = 0
  for (const [t, l] of f.lifts) {
    if (t > at) break
    level = l
  }
  return level
}
function fadeAt(stops: [number, number][], u: number): number {
  for (let i = 1; i < stops.length; i++) {
    const [a, oa] = stops[i - 1] ?? [0, 0]
    const [b, ob] = stops[i] ?? [1, 1]
    if (u <= b) return b === a ? ob : oa + ((ob - oa) * (u - a)) / (b - a)
  }
  return stops.at(-1)?.[1] ?? 1
}

// The moment each bar was last drawn moving, kept while it stands, so a redraw
// of a standing bar rewrites none of its cells
const stillPhase = new Map<string, number>()

export type TrackOptions = {
  // Now, in ms
  now: number
  // Claude works on this plan and it runs: the wave and the flicker move with the clock
  isMoving: boolean
  // The terminal draws Powerline's half circles (U+E0B6, U+E0B4): the track and the pill get round ends
  hasRoundEnds: boolean
}

// The pill's words: the stage the head is in, the step it is at and how much of the plan is done
function pillLabel(p: Plan, room: number): string {
  const pct = ` · ${percentOf(p)}%`
  if (p.state === 'done') return fit(`✓ Concluído${pct}`, room)
  const w = atHead(p)
  const icon = p.state === 'error' ? '✕ ' : p.state === 'needs_input' ? '? ' : ''
  const isSingle = p.stages.length === 1
  const count = isSingle ? `${Math.min(w.total, w.pos + 1)}/${w.total}` : `${w.step}/${w.stageSize}`
  const name = p.stages[w.stage]?.name ?? ''
  const nameRoom = room - cellsOf(icon) - cellsOf(` ${count}${pct}`)
  if (nameRoom < 3) return fit(`${icon}${count}${pct}`, room)
  return `${icon}${fit(name, nameRoom)} ${count}${pct}`
}

export function trackCells(p: Plan, W: number, o: TrackOptions): string {
  const g = new Grid(W)
  const w = atHead(p)
  const isDone = p.state === 'done'
  const fx = (isDone ? 1 : Math.min(1, w.pos / Math.max(1, w.total))) * W
  const phase = o.isMoving ? o.now : (stillPhase.get(p.id) ?? p.startedAt)
  stillPhase.set(p.id, phase)
  const acc = hex(PLAN_COLORS[p.state])
  const light = mix(acc, [255, 255, 255], 0.35)
  const track = mix(TERM_BG, [128, 128, 128], 0.18)
  // the fill's ground: the accent rising out of the track from the start to the head
  const ground = (x: number) => mix(track, acc, (isDone ? 0.14 : 0.05) + (isDone ? 0.18 : 0.27) * q((x + 0.5) / Math.max(1, fx)))
  const under = (x: number) => (x + 0.5 < fx ? ground(x) : track)
  // where the terminal draws round ends the track is a capsule: its first and last cells are the ends
  const isCapsule = o.hasRoundEnds && W >= 6
  const isEnd = (x: number) => isCapsule && (x === 0 || x === W - 1)
  const backAt = (x: number) => (isEnd(x) ? DEFAULT : pack(under(x)))
  for (let x = 0; x < W; x++) {
    g.set(x, isEnd(x) ? (x === 0 ? '' : '') : ' ', isEnd(x) ? pack(under(x)) : DEFAULT, backAt(x))
  }

  // the fill: braille dots dealt sparse at the start and all but full at the
  // head, the same ones on every frame; a wave of brightness streams from the
  // head towards the start, and cells flicker, a lone bright dot at their top
  const ms = Math.max(0, phase - p.startedAt)
  const speed = p.state === 'running' ? STREAM_SPEED : STREAM_SPEED / 2
  const shift = Math.floor((ms / 1000) * speed)
  const spark = mix(light, [255, 255, 255], 0.55)
  const seed = seedOf(p.id)
  for (let col = 0; col < Math.min(W, Math.ceil(fx)); col++) {
    if (isEnd(col)) continue
    const u = Math.min(1, (col + 0.5) / Math.max(1, fx))
    const fade = fadeAt(STREAM_FADE, u)
    const at = col + seed
    const level = STREAM_LEVELS[STREAM_STEPS[(at * 2 + shift) % STREAM_COLS] ?? 0] ?? 0
    const step = liftStep(Math.floor(streamHash(at, 0, 302) * FLICKER_CLASSES), ms)
    const lift = fadeAt(FLICKER_FADE, u) * (FLICKER_LIFTS[step] ?? 0)
    const ground0 = ground(col)
    if (step === FLICKER_LIFTS.length - 1 && streamHash(at, 5, 53) < SPARK_SHARE) {
      const dot = Math.floor(streamHash(at, 3, 41) * 8)
      g.set(col, 0x2800 + (BRAILLE_BITS[dot % 4]?.[dot >> 2] ?? 0), pack(mix(ground0, spark, q(0.45 + 0.55 * fade))), pack(ground0))
      continue
    }
    let bits = 0
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 2; c++) if (streamHash(at * 2 + c, r, 77) < 0.3 + 0.6 * fade) bits |= BRAILLE_BITS[r]?.[c] ?? 0
    }
    const grid = Math.min(1, (0.25 + 0.75 * fade) * level * 1.6 * (0.6 + 0.4 * streamHash(at, 1, 91)))
    const alpha = q(1 - (1 - grid) * (1 - lift))
    if (alpha === 0 || bits === 0) continue
    g.set(col, 0x2800 + bits, pack(mix(ground0, light, alpha)), pack(ground0))
  }

  // a stage boundary is a line, a step ahead a dot where the track leaves room for them
  const passedMark = mix(light, [255, 255, 255], 0.5)
  const aheadMark = mix(track, [255, 255, 255], 0.4)
  const isRoomy = W / Math.max(1, w.total) >= 3
  let k = 0
  for (const s of p.stages) {
    s.steps.forEach((_, j) => {
      const x = Math.round((k / Math.max(1, w.total)) * W)
      const passed = x < fx - 0.5
      if (k > 0 && x > 0 && x < W - 1 && (j === 0 || (isRoomy && !passed))) {
        g.set(x, j === 0 ? '│' : '·', pack(passed ? passedMark : aheadMark), pack(under(x)))
      }
      k++
    })
  }

  // the pill at the head, in the state's colour, a cell of room at each side
  const label = pillLabel(p, Math.max(1, W - 2))
  const kw = cellsOf(label) + 2
  const kx = Math.round(Math.max(0, Math.min(W - kw, fx - kw / 2)))
  const ink = pack(hex(PILL_INK))
  for (let x = kx; x < kx + kw; x++) g.set(x, ' ', DEFAULT, pack(acc))
  g.text(kx + 1, label, ink, pack(acc))
  if (o.hasRoundEnds) {
    g.set(kx, '', pack(acc), backAt(kx))
    g.set(kx + kw - 1, '', pack(acc), backAt(kx + kw - 1))
  }
  return g.encode()
}

// Forgets the standing phase of plans no longer drawn
export function forgetTracks(ids: ReadonlySet<string>) {
  for (const id of stillPhase.keys()) if (!ids.has(id)) stillPhase.delete(id)
}

// The pill's words as plain text, for a surface that draws no Raster
export const pillText = (p: Plan, room: number) => pillLabel(p, room)

// Reads a bar's cells back: the characters, a cell at a time (for tests and checks)
export function cellsText(cells: string): string {
  const bytes = fromBase64(cells)
  let s = ''
  // the code point is the first of each cell's three little-endian u32 words
  for (let i = 0; i + 3 < bytes.length; i += 12) {
    s += String.fromCodePoint((bytes[i] ?? 0) | ((bytes[i + 1] ?? 0) << 8) | ((bytes[i + 2] ?? 0) << 16))
  }
  return s
}
